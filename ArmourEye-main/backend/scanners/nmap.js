const Docker = require('dockerode');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

// Helper function to get Docker client based on platform
function getDockerClient() {
  if (process.platform === 'win32') {
    // Windows uses named pipe
    return new Docker({ socketPath: '//./pipe/docker_engine' });
  }
  // Linux/Mac uses Unix socket
  return new Docker({ socketPath: '/var/run/docker.sock' });
}

class NmapScanner {
  constructor() {
    this.docker = getDockerClient();
    this.scannerContainerName = 'armoureye-scanner';
    this.lastScanOutput = ''; // Store last scan output for fallback parsing
  }

  /**
   * Execute Nmap scan on target
   * @param {string} target - IP address or hostname to scan
   * @param {string} profile - Scan profile (quick, standard, deep)
   * @param {string} scanId - Unique scan identifier
   * @returns {Promise<Object>} Scan results
   */
  async scan(target, profile = 'quick', scanId) {
    try {
      console.log(`Starting Nmap scan for target: ${target}, profile: ${profile}`);
      
      // Get scan parameters based on profile
      const scanParams = this.getScanParameters(profile);
      
      // Execute scan in scanner container
      const results = await this.executeScan(target, scanParams, scanId);
      
      // Store the text output for fallback parsing
      this.lastScanOutput = results.output || results.error || '';
      
      // Parse XML results
      let parsedResults;
      try {
        parsedResults = await this.parseResults(scanId);
      } catch (parseError) {
        console.warn(`[${scanId}] XML parsing failed, attempting text output fallback...`);
        // Try to parse from the text output we captured
        try {
          parsedResults = this.parseTextOutput(this.lastScanOutput);
          console.log(`[${scanId}] Successfully parsed ${parsedResults.ports.length} ports from text output`);
        } catch (fallbackError) {
          console.error(`[${scanId}] Fallback parsing also failed:`, fallbackError);
          parsedResults = {
            ports: [],
            hosts: [],
            error: parseError.message,
            scanInfo: { scanner: 'nmap', error: parseError.message }
          };
        }
      }
      
      return {
        success: true,
        target: target,
        profile: profile,
        scanId: scanId,
        results: parsedResults,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Nmap scan error:', error);
      return {
        success: false,
        target: target,
        profile: profile,
        scanId: scanId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get scan parameters based on profile
   * @param {string} profile - Scan profile
   * @returns {Object} Scan parameters
   */
  getScanParameters(profile) {
    const profiles = {
      misconfigs: {
        args: ['-sV', '-sC', '--top-ports', '1000'],
        timeout: 300000, // 5 minutes
        description: 'Configuration and package vulnerability scan'
      },
      deeper: {
        args: ['-sV', '-sC', '-A', '--script', 'vuln,exploit', '--script-args', 'unsafe=1'],
        timeout: 1800000, // 30 minutes
        description: 'Comprehensive penetration test with active exploitation'
      }
    };

    return profiles[profile] || profiles.misconfigs;
  }

  /**
   * Execute Nmap scan in scanner container
   * @param {string} target - Target to scan
   * @param {Object} params - Scan parameters
   * @param {string} scanId - Scan identifier
   * @returns {Promise<Object>} Execution result
   */
  async executeScan(target, params, scanId) {
    try {
      // Find or create scanner container
      const container = await this.getScannerContainer();
      
      // Verify container is running
      const containerInfo = await container.inspect();
      if (!containerInfo.State.Running) {
        throw new Error('Scanner container is not running');
      }
      
      // Prepare Nmap command
      const nmapCmd = [
        'nmap',
        ...params.args,
        '-oX', `/scans/results/nmap_${scanId}.xml`,
        target
      ];

      console.log(`[${scanId}] Executing Nmap: ${nmapCmd.join(' ')}`);

      // Execute command in container
      const exec = await container.exec({
        Cmd: nmapCmd,
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      
      // Collect output
      let output = '';
      let error = '';
      let hasOutput = false;

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          stream.destroy();
          reject(new Error(`Nmap scan timeout after ${params.timeout}ms`));
        }, params.timeout);

        stream.on('data', (chunk) => {
          const data = chunk.toString();
          output += data;
          error += data; // Nmap outputs to stderr too
          hasOutput = true;
          // Only log non-empty lines to reduce noise
          const lines = data.split('\n').filter(line => line.trim());
          lines.forEach(line => {
            if (line.trim() && !line.startsWith('@')) {
              console.log(`[${scanId}] Nmap: ${line.trim()}`);
            }
          });
        });

        stream.on('error', (err) => {
          clearTimeout(timeout);
          const errorMsg = err.toString();
          console.error(`[${scanId}] Nmap stream error:`, errorMsg);
          error += errorMsg;
          reject(new Error(`Nmap execution failed: ${errorMsg}`));
        });

        stream.on('end', () => {
          clearTimeout(timeout);
          
          // Check if we got any output (Nmap should produce output)
          if (!hasOutput && !error) {
            console.warn(`[${scanId}] Nmap completed with no output - this might indicate a problem`);
          }
          
          // Log if there were errors
          if (error && !error.includes('Starting Nmap')) {
            console.warn(`[${scanId}] Nmap stderr output: ${error}`);
          }
          
          resolve({
            output: output,
            error: error,
            exitCode: 0,
            hasOutput: hasOutput
          });
        });
      });
    } catch (error) {
      console.error(`[${scanId}] Container execution error:`, error);
      throw error;
    }
  }

  /**
   * Get or create scanner container
   * @returns {Promise<Object>} Docker container
   */
  async getScannerContainer() {
    try {
      // First, try to get container by name directly (handles cases where listContainers doesn't find it)
      try {
        const existingContainer = this.docker.getContainer(this.scannerContainerName);
        const containerInfo = await existingContainer.inspect();
        
        // If container is running, return it
        if (containerInfo.State.Running) {
          console.log('Found existing running scanner container');
          return existingContainer;
        }
        
        // If container exists but is stopped, remove it
        console.log('Found stopped scanner container, removing it...');
        try {
          await existingContainer.remove({ force: true });
          console.log('Stopped container removed successfully');
        } catch (removeError) {
          console.warn('Could not remove stopped container:', removeError.message);
          // Try to remove by ID if name removal fails
          try {
            await this.docker.getContainer(containerInfo.Id).remove({ force: true });
            console.log('Removed container by ID');
          } catch (idError) {
            console.warn('Could not remove by ID either:', idError.message);
          }
        }
      } catch (notFoundError) {
        // Container doesn't exist by name, which is fine - we'll create it
        console.log('No existing scanner container found by name');
      }

      // Also check listContainers as backup
      const containers = await this.docker.listContainers({ all: true });
      const scannerContainer = containers.find(container => {
        const names = container.Names || [];
        return names.some(name => name.includes(this.scannerContainerName));
      });

      if (scannerContainer) {
        const container = this.docker.getContainer(scannerContainer.Id);
        
        // If container is running, return it
        if (scannerContainer.State === 'running') {
          return container;
        }
        
        // If container exists but is stopped, remove it
        console.log('Found stopped scanner container in list, removing it...');
        try {
          await container.remove({ force: true });
          console.log('Stopped container removed successfully');
        } catch (removeError) {
          console.warn('Could not remove stopped container:', removeError.message);
        }
      }

      // Check if image exists, if not try to build it
      try {
        await this.docker.getImage('armoureye-scanner:latest').inspect();
        console.log('Scanner image found: armoureye-scanner:latest');
      } catch (imageError) {
        console.log('Scanner image not found. Attempting to build...');
        try {
          const { buildScannerImage } = require('../build-scanner');
          await buildScannerImage();
          console.log('Scanner image built successfully');
        } catch (buildError) {
          console.error('Failed to build scanner image:', buildError.message);
          throw new Error(
            'Scanner image "armoureye-scanner:latest" not found and could not be built. ' +
            'Please run: node backend/build-scanner.js'
          );
        }
      }

      // Create new scanner container
      console.log('Creating new scanner container...');
      
      // On Windows, use bridge network instead of host mode (host mode doesn't work on Windows)
      const networkMode = process.platform === 'win32' ? 'bridge' : 'host';
      
      // Mount Docker socket so tools can access Docker daemon
      const hostConfig = {
        NetworkMode: networkMode,
        Privileged: true
      };
      
      // Try to mount Docker socket (works on Linux/Mac, Docker Desktop handles Windows)
      try {
        hostConfig.Binds = ['/var/run/docker.sock:/var/run/docker.sock:ro'];
      } catch (bindError) {
        console.warn('Could not configure Docker socket bind:', bindError.message);
      }
      
      const container = await this.docker.createContainer({
        Image: 'armoureye-scanner:latest',
        name: this.scannerContainerName,
        HostConfig: hostConfig,
        Cmd: ['/bin/bash', '-c', 'tail -f /dev/null'] // Keep container running
      });

      await container.start();
      
      // Log container network info for debugging
      const containerInfo = await container.inspect();
      console.log(`Scanner container created with network mode: ${networkMode}`);
      console.log(`Container IP: ${containerInfo.NetworkSettings?.IPAddress || 'N/A'}`);
      
      return container;
    } catch (error) {
      console.error('Error getting scanner container:', error);
      
      // If it's a name conflict, try to remove the existing container and retry
      if (error.statusCode === 409 || (error.json && error.json.message && error.json.message.includes('already in use'))) {
        console.log('Container name conflict detected, attempting to remove existing container...');
        
        // Extract container ID from error message if available
        const errorMsg = error.json?.message || error.message || '';
        const containerIdMatch = errorMsg.match(/container "([a-f0-9]+)"/);
        
        if (containerIdMatch) {
          const containerId = containerIdMatch[1];
          console.log(`Attempting to remove container by ID: ${containerId}`);
          try {
            const container = this.docker.getContainer(containerId);
            await container.remove({ force: true });
            console.log('Removed conflicting container by ID, retrying...');
            
            // Retry creating the container
            return await this.getScannerContainer();
          } catch (removeError) {
            console.error('Failed to remove container by ID:', removeError.message);
          }
        }
        
        // Try to remove by name
        try {
          const container = this.docker.getContainer(this.scannerContainerName);
          await container.remove({ force: true });
          console.log('Removed conflicting container by name, retrying...');
          
          // Retry creating the container
          return await this.getScannerContainer();
        } catch (retryError) {
          console.error('Failed to remove conflicting container:', retryError.message);
        }
      }
      
      throw error;
    }
  }

  /**
   * Parse Nmap XML results
   * @param {string} scanId - Scan identifier
   * @returns {Promise<Object>} Parsed results
   */
  async parseResults(scanId) {
    try {
      const xmlPath = `/scans/results/nmap_${scanId}.xml`;
      
      // Read XML file from container
      const container = await this.getScannerContainer();
      
      // First check if file exists
      const checkExec = await container.exec({
        Cmd: ['test', '-f', xmlPath],
        AttachStdout: true
      });
      
      try {
        await checkExec.start();
      } catch (e) {
        // File doesn't exist (test returns non-zero)
        console.warn(`[${scanId}] Nmap XML file not found: ${xmlPath}`);
        return { 
          ports: [], 
          hosts: [], 
          error: 'Nmap XML output file not found - scan may have failed',
          scanInfo: { scanner: 'nmap', error: 'No output file generated' }
        };
      }
      
      const exec = await container.exec({
        Cmd: ['cat', xmlPath],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      let xmlContent = '';
      let stderr = '';

      return new Promise((resolve, reject) => {
        // Docker exec streams stdout and stderr together, need to handle both
        const decoder = new (require('stream').PassThrough)();
        
        stream.on('data', (chunk) => {
          const data = chunk.toString();
          // Try to filter out non-XML content (sometimes stderr gets mixed in)
          if (data.includes('<?xml') || data.includes('<nmaprun')) {
            xmlContent += data;
          } else if (!data.trim().startsWith('@')) {
            // Skip Docker exec metadata lines
            xmlContent += data;
          }
        });

        stream.on('end', async () => {
          try {
            // Clean up the XML content - remove any leading non-XML characters
            xmlContent = xmlContent.trim();
            
            // Find the XML start tag
            const xmlStart = xmlContent.indexOf('<?xml');
            if (xmlStart > 0) {
              console.log(`[${scanId}] Removing ${xmlStart} characters before XML declaration`);
              xmlContent = xmlContent.substring(xmlStart);
            }
            
            // Also try to find <nmaprun> if <?xml is missing
            if (xmlStart === -1) {
              const nmaprunStart = xmlContent.indexOf('<nmaprun');
              if (nmaprunStart > 0) {
                console.log(`[${scanId}] Removing ${nmaprunStart} characters before <nmaprun> tag`);
                xmlContent = xmlContent.substring(nmaprunStart);
              }
            }
            
            // Fix HTML entity encoding issues (e.g., -&#45; should be --)
            xmlContent = xmlContent.replace(/&#45;/g, '-');
            xmlContent = xmlContent.replace(/&amp;/g, '&');
            xmlContent = xmlContent.replace(/&lt;/g, '<');
            xmlContent = xmlContent.replace(/&gt;/g, '>');
            xmlContent = xmlContent.replace(/&quot;/g, '"');
            
            // Fix malformed XML comments (comments can't contain -- in the middle)
            // Replace problematic comment patterns
            xmlContent = xmlContent.replace(/<!--[\s\S]*?-->/g, (match) => {
              // Remove or fix comments that might cause issues
              return match.replace(/--/g, '- -'); // Space out double dashes in comments
            });
            
            if (!xmlContent.trim()) {
              console.warn(`[${scanId}] Nmap XML file is empty`);
              resolve({ 
                ports: [], 
                hosts: [], 
                error: 'Nmap XML output is empty',
                scanInfo: { scanner: 'nmap', error: 'Empty output file' }
              });
              return;
            }

            // Parse XML
            const parser = new xml2js.Parser({
              trim: true,
              explicitArray: false,
              mergeAttrs: true,
              ignoreAttrs: false
            });
            
            const result = await parser.parseStringPromise(xmlContent);
            
            // Extract useful information
            const parsed = this.extractScanData(result);
            
            // Log if no hosts/ports found
            if (parsed.hosts.length === 0 && parsed.ports.length === 0) {
              console.warn(`[${scanId}] Nmap XML parsing found no hosts or ports - trying text output fallback...`);
              // Try text output fallback
              try {
                const fallbackResult = this.parseTextOutput(this.lastScanOutput);
                if (fallbackResult.ports.length > 0 || fallbackResult.hosts.length > 0) {
                  console.log(`[${scanId}] Fallback parser found ${fallbackResult.ports.length} ports and ${fallbackResult.hosts.length} hosts`);
                  resolve(fallbackResult);
                  return;
                }
              } catch (fallbackError) {
                console.error(`[${scanId}] Fallback parsing also failed:`, fallbackError.message);
              }
              console.warn(`[${scanId}] Nmap found no hosts or ports - target may be unreachable or all ports filtered`);
            } else {
              console.log(`[${scanId}] XML parsing successful: found ${parsed.ports.length} ports and ${parsed.hosts.length} hosts`);
            }
            
            resolve(parsed);
          } catch (parseError) {
            console.error(`[${scanId}] XML parsing error:`, parseError.message);
            console.error(`[${scanId}] XML content preview (first 500 chars):`, xmlContent.substring(0, 500));
            
            // Try to parse from text output as fallback
            console.log(`[${scanId}] Attempting to parse from Nmap text output as fallback...`);
            try {
              // Use the actual text output from the scan, not the XML content
              const textOutput = this.lastScanOutput || xmlContent;
              const fallbackResult = this.parseTextOutput(textOutput);
              if (fallbackResult.ports.length > 0 || fallbackResult.hosts.length > 0) {
                console.log(`[${scanId}] Successfully parsed ${fallbackResult.ports.length} ports from text output`);
                resolve(fallbackResult);
                return;
              } else {
                console.warn(`[${scanId}] Text parser found 0 ports. Text output length: ${textOutput.length}`);
              }
            } catch (fallbackError) {
              console.error(`[${scanId}] Fallback parsing also failed:`, fallbackError.message);
            }
            
            reject(parseError);
          }
        });

        stream.on('error', (err) => {
          console.error(`[${scanId}] Error reading XML file:`, err);
          reject(err);
        });
      });
    } catch (error) {
      console.error(`[${scanId}] Error parsing results:`, error);
      return { 
        ports: [], 
        hosts: [], 
        error: error.message,
        scanInfo: { scanner: 'nmap', error: error.message }
      };
    }
  }

  /**
   * Parse Nmap text output as fallback when XML parsing fails
   * @param {string} textOutput - Nmap text output
   * @returns {Object} Parsed scan data
   */
  parseTextOutput(textOutput) {
    const hosts = [];
    const ports = [];
    
    // Try to extract IP from output - multiple patterns
    let ipMatch = textOutput.match(/Nmap scan report for ([\d.]+)/);
    if (!ipMatch) {
      ipMatch = textOutput.match(/scan report for ([\d.]+)/);
    }
    if (!ipMatch) {
      ipMatch = textOutput.match(/(\d+\.\d+\.\d+\.\d+)/);
    }
    
    const targetIp = ipMatch ? ipMatch[1] : 'unknown';
    
    if (ipMatch) {
      hosts.push({
        ip: targetIp,
        hostname: null,
        status: 'up',
        uptime: null
      });
    }
    
    // Extract port information from text output
    // Format examples:
    // "80/tcp open  http    Apache httpd 2.4.25"
    // "PORT   STATE SERVICE VERSION"
    // "80/tcp open  http"
    const lines = textOutput.split('\n');
    let inPortSection = false;
    
    for (const line of lines) {
      // Look for PORT header to know we're in the port section
      if (line.includes('PORT') && line.includes('STATE') && line.includes('SERVICE')) {
        inPortSection = true;
        continue;
      }
      
      // Stop at MAC Address line (end of port section)
      if (line.includes('MAC Address:')) {
        inPortSection = false;
      }
      
      if (inPortSection && line.trim()) {
        // Match port lines: "80/tcp open  http    Apache httpd 2.4.25"
        // Also handle lines like: "80/tcp open  http    Apache httpd 2.4.25 ((Debian))"
        // More flexible regex to handle variable spacing - match from start of line
        const portMatch = line.match(/^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)?\s*(.*?)$/);
        if (portMatch) {
          const portNum = parseInt(portMatch[1]);
          const protocol = portMatch[2];
          const state = portMatch[3];
          const service = portMatch[4] || 'unknown';
          let versionInfo = portMatch[5] ? portMatch[5].trim() : null;
          
          // Clean up version info (remove parentheses like "(Debian)")
          if (versionInfo) {
            versionInfo = versionInfo.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
          }
          
          if (state === 'open') {
            // Parse version info
            let product = null;
            let version = null;
            
            if (versionInfo) {
              // Try to extract product and version
              // e.g., "Apache httpd 2.4.25" -> product: "Apache", version: "httpd 2.4.25"
              const parts = versionInfo.split(/\s+/);
              if (parts.length > 0) {
                product = parts[0];
                version = parts.slice(1).join(' ') || null;
              }
            }
            
            ports.push({
              number: portNum,
              protocol: protocol,
              state: state,
              service: service,
              version: version || versionInfo,
              product: product,
              extraInfo: versionInfo
            });
          }
        }
      }
      
      // Also check if we're past the PORT header but before the MAC Address line
      // This handles cases where the port section doesn't have a clear header
      // Match port lines anywhere in the output (more aggressive parsing)
      if (line.trim() && !line.includes('MAC Address') && !line.includes('Device type') && !line.includes('Running:') && !line.includes('Nmap scan') && !line.includes('Host is up')) {
        // Try to match port lines anywhere in the output - more flexible regex
        const portMatch = line.match(/(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)?\s*(.*?)$/);
        if (portMatch && portMatch[3] === 'open') {
          const portNum = parseInt(portMatch[1]);
          const protocol = portMatch[2];
          const service = portMatch[4] || 'unknown';
          let versionInfo = portMatch[5] ? portMatch[5].trim() : null;
          
          // Avoid duplicates
          if (!ports.some(p => p.number === portNum && p.protocol === protocol)) {
            if (versionInfo) {
              versionInfo = versionInfo.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
            }
            
            let product = null;
            let version = null;
            
            if (versionInfo) {
              const parts = versionInfo.split(/\s+/);
              if (parts.length > 0) {
                product = parts[0];
                version = parts.slice(1).join(' ') || null;
              }
            }
            
            ports.push({
              number: portNum,
              protocol: protocol,
              state: 'open',
              service: service,
              version: version || versionInfo,
              product: product,
              extraInfo: versionInfo
            });
          }
        }
      }
    }
    
    // If we didn't find ports with the structured format, try a simpler regex
    // This is a more aggressive fallback that searches the entire output
    if (ports.length === 0) {
      // Try multiple regex patterns to catch different formats
      const patterns = [
        /(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)?\s*(.*?)(?:\n|$)/g,
        /PORT\s+STATE\s+SERVICE[\s\S]*?(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)?\s*(.*?)(?:\n|MAC|Device)/g
      ];
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(textOutput)) !== null) {
          // Adjust match indices based on pattern
          const portNum = parseInt(match[1] || match[2]);
          const protocol = (match[2] || match[3]) || 'tcp';
          const state = (match[3] || match[4]) || 'unknown';
          const service = (match[4] || match[5]) || 'unknown';
          const version = (match[5] || match[6]) ? (match[5] || match[6]).trim() : null;
          
          if (state === 'open' && portNum > 0) {
            // Avoid duplicates
            if (!ports.some(p => p.number === portNum && p.protocol === protocol)) {
              ports.push({
                number: portNum,
                protocol: protocol,
                state: state,
                service: service,
                version: version,
                product: version ? version.split(' ')[0] : null,
                extraInfo: version || null
              });
            }
          }
        }
      }
      
      // Last resort: very simple pattern matching - search entire text
      if (ports.length === 0) {
        // Try the simplest possible pattern: "80/tcp open"
        const simplePattern = /(\d+)\/(tcp|udp)\s+open/g;
        let match;
        const seenPorts = new Set();
        while ((match = simplePattern.exec(textOutput)) !== null) {
          const portNum = parseInt(match[1]);
          const portKey = `${portNum}/${match[2]}`;
          if (!seenPorts.has(portKey)) {
            seenPorts.add(portKey);
            ports.push({
              number: portNum,
              protocol: match[2],
              state: 'open',
              service: 'unknown',
              version: null,
              product: null,
              extraInfo: null
            });
          }
        }
      }
    }
    
    // Debug logging if still no ports found
    if (ports.length === 0 && textOutput.length > 0) {
      console.warn(`[parseTextOutput] Found 0 ports. Sample of text output:`, textOutput.substring(0, 500));
      // Try one more time with an even simpler pattern
      const ultraSimple = /(\d+)\/tcp.*open/i;
      const match = textOutput.match(ultraSimple);
      if (match) {
        const portNum = parseInt(match[1]);
        ports.push({
          number: portNum,
          protocol: 'tcp',
          state: 'open',
          service: 'unknown',
          version: null,
          product: null,
          extraInfo: null
        });
        console.log(`[parseTextOutput] Found port ${portNum} using ultra-simple pattern`);
      }
    }
    
    return {
      hosts: hosts,
      ports: ports,
      scanInfo: {
        scanner: 'nmap',
        version: 'unknown',
        parsedFrom: 'text-output'
      }
    };
  }

  /**
   * Extract useful data from Nmap XML
   * @param {Object} xmlData - Parsed XML data
   * @returns {Object} Extracted scan data
   */
  extractScanData(xmlData) {
    try {
      const hosts = [];
      const ports = [];

      // Handle both merged attributes (mergeAttrs: true) and separate $ attributes
      const getAttr = (obj, attr) => {
        if (!obj) return undefined;
        // Try merged attributes first (when mergeAttrs: true)
        if (obj[attr] !== undefined) return obj[attr];
        // Fall back to $ object (when mergeAttrs: false)
        if (obj.$ && obj.$[attr] !== undefined) return obj.$[attr];
        return undefined;
      };

      // Debug: log structure if no data found
      if (!xmlData.nmaprun) {
        console.warn('XML data missing nmaprun element');
        return { hosts: [], ports: [], error: 'Invalid XML structure: missing nmaprun' };
      }

      if (xmlData.nmaprun.host) {
        const hostData = Array.isArray(xmlData.nmaprun.host) 
          ? xmlData.nmaprun.host[0] 
          : xmlData.nmaprun.host;

        // Extract host information
        const addressData = Array.isArray(hostData.address) ? hostData.address[0] : hostData.address;
        const hostnameData = hostData.hostnames?.[0]?.hostname;
        const hostnameItem = Array.isArray(hostnameData) ? hostnameData[0] : hostnameData;
        const statusData = Array.isArray(hostData.status) ? hostData.status[0] : hostData.status;
        const uptimeData = Array.isArray(hostData.uptime) ? hostData.uptime[0] : hostData.uptime;

        const host = {
          ip: getAttr(addressData, 'addr') || 'unknown',
          hostname: getAttr(hostnameItem, 'name') || null,
          status: getAttr(statusData, 'state') || 'unknown',
          uptime: getAttr(uptimeData, 'seconds') || null
        };

        hosts.push(host);

        // Extract port information
        // Handle different XML structures
        let portList = [];
        
        if (hostData.ports) {
          const portsData = Array.isArray(hostData.ports) ? hostData.ports[0] : hostData.ports;
          
          if (portsData && portsData.port) {
            portList = Array.isArray(portsData.port) ? portsData.port : [portsData.port];
          }
        }

        if (portList.length === 0) {
          // Try alternative structure: hostData.port directly
          if (hostData.port) {
            portList = Array.isArray(hostData.port) ? hostData.port : [hostData.port];
          }
        }

        portList.forEach(portData => {
          try {
            const stateData = Array.isArray(portData.state) ? portData.state[0] : portData.state;
            const serviceData = Array.isArray(portData.service) ? portData.service[0] : portData.service;

            const portNum = parseInt(getAttr(portData, 'portid') || '0');
            const protocol = getAttr(portData, 'protocol') || 'tcp';
            const state = getAttr(stateData, 'state') || 'unknown';

            // Only add open ports
            if (state === 'open' && portNum > 0) {
              const port = {
                number: portNum,
                protocol: protocol,
                state: state,
                service: getAttr(serviceData, 'name') || 'unknown',
                version: getAttr(serviceData, 'version') || null,
                product: getAttr(serviceData, 'product') || null,
                extraInfo: getAttr(serviceData, 'extrainfo') || null
              };

              ports.push(port);
            }
          } catch (portError) {
            console.warn('Error parsing port data:', portError.message);
          }
        });
      }

      return {
        hosts: hosts,
        ports: ports,
        scanInfo: {
          scanner: 'nmap',
          version: getAttr(xmlData.nmaprun, 'version') || 'unknown',
          startTime: getAttr(xmlData.nmaprun, 'start') || null,
          endTime: getAttr(xmlData.nmaprun, 'endstr') || null
        }
      };
    } catch (error) {
      console.error('Error extracting scan data:', error);
      console.error('XML data structure:', JSON.stringify(xmlData, null, 2).substring(0, 1000));
      return { hosts: [], ports: [], error: error.message };
    }
  }

  /**
   * Get scan logs
   * @param {string} scanId - Scan identifier
   * @returns {Promise<string>} Log content
   */
  async getScanLogs(scanId) {
    try {
      const container = await this.getScannerContainer();
      const exec = await container.exec({
        Cmd: ['cat', `/scans/logs/scan_${scanId}.log`],
        AttachStdout: true
      });

      const stream = await exec.start();
      let logs = '';

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
          logs += chunk.toString();
        });

        stream.on('end', () => {
          resolve(logs);
        });

        stream.on('error', (err) => {
          reject(err);
        });
      });
    } catch (error) {
      console.error('Error getting scan logs:', error);
      return '';
    }
  }
}

module.exports = NmapScanner;

