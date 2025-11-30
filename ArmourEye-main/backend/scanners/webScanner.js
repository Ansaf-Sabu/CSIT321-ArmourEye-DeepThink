const ToolExecutor = require('./toolExecutor');

/**
 * Web Application Scanner
 * Executes web scanning tools: Gobuster, Nikto, WhatWeb
 */
class WebScanner {
  constructor(scanId, targetIp) {
    this.scanId = scanId;
    this.targetIp = targetIp;
    this.executor = new ToolExecutor(scanId, targetIp);
  }

  /**
   * Determine HTTP/HTTPS URL based on target IP and detected ports
   * @param {Array} webServices - Array of web services from Nmap results
   * @returns {string} Base URL (http:// or https://)
   */
  getBaseUrl(webServices = []) {
    // Check if HTTPS port (443, 8443) is open
    const hasHttps = webServices.some(s => s.port === 443 || s.port === 8443);
    const httpsPort = webServices.find(s => s.port === 443 || s.port === 8443);
    const httpPort = webServices.find(s => s.port === 80 || s.port === 8080);
    
    if (hasHttps && httpsPort) {
      const port = httpsPort.port === 443 ? '' : `:${httpsPort.port}`;
      return `https://${this.targetIp}${port}`;
    }
    
    // Default to HTTP
    const port = httpPort && httpPort.port !== 80 ? `:${httpPort.port}` : '';
    return `http://${this.targetIp}${port}`;
  }

  /**
   * Execute Gobuster directory enumeration
   * @param {string} wordlist - Wordlist name (default: 'common.txt')
   * @param {Array} webServices - Web services from Nmap (for URL detection)
   * @returns {Promise<Object>} Parsed Gobuster results
   */
  async scanDirectories(wordlist = 'common.txt', webServices = []) {
    try {
      const baseUrl = this.getBaseUrl(webServices);
      const outputPath = this.executor.getOutputPath('gobuster', 'txt');
      
      // Try multiple wordlist locations (Kali Linux has different paths)
      // Priority: SecLists (most common), then dirbuster, then dirb
      const wordlistPaths = [
        `/usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt`, // SecLists raft medium (good size)
        `/usr/share/seclists/Discovery/Web-Content/common-and-portuguese.txt`, // SecLists common
        `/usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt`, // SecLists medium
        `/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt`, // DirBuster medium
        `/usr/share/wordlists/dirb/common.txt`, // DirB common
        `/usr/share/seclists/Discovery/Web-Content/raft-large-directories.txt`, // SecLists raft large (slower)
        `/usr/share/wordlists/rockyou.txt` // Fallback (very large, slow)
      ];
      
      // Find first available wordlist
      let wordlistPath = null;
      const container = await this.executor.getScannerContainer();
      
      for (const path of wordlistPaths) {
        try {
          // Use a simpler check: try to read the file
          const checkExec = await container.exec({
            Cmd: ['sh', '-c', `test -f "${path}" && echo "EXISTS" || exit 1`],
            AttachStdout: true,
            AttachStderr: true
          });
          
          const stream = await checkExec.start();
          let output = '';
          
          const exists = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              stream.destroy();
              resolve(false);
            }, 3000);
            
            stream.on('data', (chunk) => {
              output += chunk.toString();
            });
            
            stream.on('end', () => {
              clearTimeout(timeout);
              // If we got "EXISTS", file exists
              resolve(output.includes('EXISTS'));
            });
            
            stream.on('error', () => {
              clearTimeout(timeout);
              resolve(false);
            });
          });
          
          if (exists) {
            wordlistPath = path;
            console.log(`[${this.scanId}] Found wordlist: ${wordlistPath}`);
            break;
          }
        } catch (e) {
          // File doesn't exist, try next
          continue;
        }
      }
      
      if (!wordlistPath) {
        console.warn(`[${this.scanId}] No wordlists found, skipping directory enumeration`);
        return {
          success: true,
          directories: [],
          count: 0,
          warning: 'No wordlists available - directory enumeration skipped. Install seclists or dirbuster wordlists.'
        };
      }
      
      console.log(`[${this.scanId}] Gobuster will use wordlist: ${wordlistPath}`);
      
      const command = [
        'gobuster',
        'dir',
        '-u', baseUrl,
        '-w', wordlistPath,
        '-o', outputPath,
        '--no-progress' // Avoid progress bar to keep logs clean
      ];
      
      console.log(`[${this.scanId}] Starting Gobuster directory enumeration...`);
      console.log(`[${this.scanId}] Target: ${baseUrl}`);
      console.log(`[${this.scanId}] Wordlist: ${wordlistPath}`);
      console.log(`[${this.scanId}] Output: ${outputPath}`);
      console.log(`[${this.scanId}] About to call executeCommand...`);

      try {
        console.log(`[${this.scanId}] Calling executeCommand now...`);
        const result = await this.executor.executeCommand(command, { timeout: 300000 }); // 5 minutes (reduced from 10)
        console.log(`[${this.scanId}] executeCommand returned, exit code: ${result.exitCode}`);
        
        // Check if command failed
        if (result.exitCode !== 0) {
          console.warn(`[${this.scanId}] Gobuster exited with non-zero code: ${result.exitCode}`);
          // Still try to read output file - Gobuster might have found directories before failing
        }
        
        // Try to read output file, but also check stdout if file is empty
        let output = '';
        try {
          output = await this.executor.readFileFromContainer(outputPath);
          console.log(`[${this.scanId}] Read ${output.length} chars from output file`);
        } catch (fileError) {
          console.warn(`[${this.scanId}] Could not read Gobuster output file:`, fileError.message);
          // Fall back to stdout/stderr
          output = result.output || result.error || '';
          console.log(`[${this.scanId}] Using stdout/stderr (${output.length} chars)`);
        }
        
        // If output file is empty but we have stdout, use that
        if (!output.trim() && result.output) {
          output = result.output;
        }
        
        // If we still have no output and there was an error, include it
        if (!output.trim() && result.error) {
          output = result.error;
        }
        
        const parsed = this.parseGobusterOutput(output);
        
        // If exit code was non-zero, mark as partial success
        if (result.exitCode !== 0 && parsed.directories.length === 0) {
          parsed.warning = `Gobuster exited with code ${result.exitCode}. ${result.error || 'No directories found.'}`;
        }
        
        return parsed;
      } catch (error) {
        // Check if error is due to missing wordlist
        if (error.message && error.message.includes('wordlist') && error.message.includes('does not exist')) {
          console.warn(`[${this.scanId}] Wordlist not found, trying alternative...`);
          
          // Try with a smaller built-in wordlist or skip directory enumeration
          // For now, return empty result but mark as partial success
          return {
            success: true,
            directories: [],
            count: 0,
            warning: 'Wordlist not found - directory enumeration skipped. Install wordlists for full scan.'
          };
        }
        
        throw error; // Re-throw other errors
      }
    } catch (error) {
      console.error('Gobuster scan error:', error);
      return {
        success: false,
        directories: [],
        error: error.message
      };
    }
  }

  /**
   * Parse Gobuster output
   * @param {string} output - Gobuster output text
   * @returns {Object} Parsed results
   */
  parseGobusterOutput(output) {
    const directories = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Gobuster output format: /path/to/dir (Status: 200) [Size: 1234]
      const match = line.match(/^(\S+)\s+\(Status:\s+(\d+)\)\s+\[Size:\s+(\d+)\]/);
      if (match) {
        directories.push({
          path: match[1],
          statusCode: parseInt(match[2]),
          size: parseInt(match[3])
        });
      }
    }

    return {
      success: true,
      directories: directories,
      count: directories.length
    };
  }

  /**
   * Execute Nikto web vulnerability scanner
   * @param {Array} webServices - Web services from Nmap (for URL detection)
   * @returns {Promise<Object>} Parsed Nikto results
   */
  async scanVulnerabilities(webServices = []) {
    try {
      const baseUrl = this.getBaseUrl(webServices);
      const outputPath = this.executor.getOutputPath('nikto', 'txt');
      
      const command = [
        'nikto',
        '-h', baseUrl,
        '-output', outputPath,
        '-Format', 'txt'
      ];

      const result = await this.executor.executeCommand(command, { timeout: 600000 }); // 10 minutes (reduced from 15)
      console.log(`[${this.scanId}] Nikto command returned, exit code: ${result.exitCode}`);
      
      // Check if command failed
      if (result.exitCode !== 0) {
        console.warn(`[${this.scanId}] Nikto exited with non-zero code: ${result.exitCode}`);
      }
      
      // Try to read output file, but also check stdout if file is empty
      let output = '';
      try {
        output = await this.executor.readFileFromContainer(outputPath);
        console.log(`[${this.scanId}] Read ${output.length} chars from Nikto output file`);
      } catch (fileError) {
        console.warn(`[${this.scanId}] Could not read Nikto output file:`, fileError.message);
        // Fall back to stdout/stderr
        output = result.output || result.error || '';
        console.log(`[${this.scanId}] Using stdout/stderr (${output.length} chars)`);
      }
      
      // If output file is empty but we have stdout, use that
      if (!output.trim() && result.output) {
        output = result.output;
      }
      
      // If we still have no output and there was an error, include it
      if (!output.trim() && result.error) {
        output = result.error;
      }
      
      const parsed = this.parseNiktoOutput(output);
      
      // If exit code was non-zero, mark as partial success
      if (result.exitCode !== 0 && parsed.vulnerabilities.length === 0) {
        parsed.warning = `Nikto exited with code ${result.exitCode}. ${result.error || 'No vulnerabilities found.'}`;
      }
      
      return parsed;
    } catch (error) {
      console.error('Nikto scan error:', error);
      return {
        success: false,
        vulnerabilities: [],
        error: error.message
      };
    }
  }

  /**
   * Parse Nikto output
   * @param {string} output - Nikto output text
   * @returns {Object} Parsed results
   */
  parseNiktoOutput(output) {
    const vulnerabilities = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Nikto output format: + /path/to/file: Description of issue
      if (line.startsWith('+')) {
        const match = line.match(/^\+\s+(.+?):\s+(.+)$/);
        if (match) {
          vulnerabilities.push({
            path: match[1],
            description: match[2],
            severity: this.assessNiktoSeverity(match[2])
          });
        }
      }
      
      // Also capture OSVDB entries
      if (line.includes('OSVDB')) {
        const osvdbMatch = line.match(/OSVDB-(\d+)/);
        if (osvdbMatch) {
          vulnerabilities.push({
            osvdb: osvdbMatch[1],
            description: line.trim(),
            severity: 'medium'
          });
        }
      }
    }

    return {
      success: true,
      vulnerabilities: vulnerabilities,
      count: vulnerabilities.length
    };
  }

  /**
   * Assess severity from Nikto description
   * @param {string} description - Vulnerability description
   * @returns {string} Severity level
   */
  assessNiktoSeverity(description) {
    const desc = description.toLowerCase();
    
    if (desc.includes('xss') || desc.includes('sql injection') || desc.includes('rce') || desc.includes('remote code')) {
      return 'high';
    }
    if (desc.includes('csrf') || desc.includes('information disclosure') || desc.includes('directory listing')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Execute WhatWeb technology detection
   * @param {Array} webServices - Web services from Nmap (for URL detection)
   * @returns {Promise<Object>} Parsed WhatWeb results
   */
  async detectTechnologies(webServices = []) {
    try {
      const baseUrl = this.getBaseUrl(webServices);
      const outputPath = this.executor.getOutputPath('whatweb', 'txt');
      
      // WhatWeb has issues in some Kali images, try alternative approach
      // Use stdout instead of file output
      const command = [
        'whatweb',
        baseUrl,
        '--no-errors'
        // Removed --quiet to get output
      ];

      const result = await this.executor.executeCommand(command, { timeout: 120000 }); // 2 minutes
      
      // If command succeeded, parse from stdout instead of file
      if (result.output) {
        return this.parseWhatWebOutput(result.output);
      }
      
      // Read and parse output
      const output = await this.executor.readFileFromContainer(outputPath);
      return this.parseWhatWebOutput(output);
    } catch (error) {
      console.error('WhatWeb scan error:', error);
      return {
        success: false,
        technologies: [],
        error: error.message
      };
    }
  }

  /**
   * Parse WhatWeb output
   * @param {string} output - WhatWeb output text
   * @returns {Object} Parsed results
   */
  parseWhatWebOutput(output) {
    const technologies = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.trim() && !line.startsWith('[')) {
        // WhatWeb output format: Technology[Version] (Category)
        const parts = line.split(',').map(p => p.trim());
        for (const part of parts) {
          const match = part.match(/([^\[]+)(?:\[([^\]]+)\])?/);
          if (match) {
            technologies.push({
              name: match[1].trim(),
              version: match[2] || null,
              category: this.categorizeTechnology(match[1].trim())
            });
          }
        }
      }
    }

    return {
      success: true,
      technologies: technologies,
      count: technologies.length
    };
  }

  /**
   * Categorize detected technology
   * @param {string} techName - Technology name
   * @returns {string} Category
   */
  categorizeTechnology(techName) {
    const name = techName.toLowerCase();
    
    if (name.includes('apache') || name.includes('nginx') || name.includes('iis')) {
      return 'web-server';
    }
    if (name.includes('php') || name.includes('python') || name.includes('ruby') || name.includes('node')) {
      return 'programming-language';
    }
    if (name.includes('wordpress') || name.includes('joomla') || name.includes('drupal')) {
      return 'cms';
    }
    if (name.includes('jquery') || name.includes('bootstrap') || name.includes('react')) {
      return 'javascript-framework';
    }
    return 'other';
  }

  /**
   * Execute all web scans
   * @param {Array} webServices - Web services from Nmap
   * @param {string} wordlist - Wordlist for directory enumeration
   * @returns {Promise<Object>} Combined results from all tools
   */
  async scanAll(webServices = [], wordlist = 'common.txt') {
    const results = {
      directories: { success: false, directories: [] },
      vulnerabilities: { success: false, vulnerabilities: [] },
      technologies: { success: false, technologies: [] }
    };

    try {
      // Run scans in parallel for speed
      const [dirResults, vulnResults, techResults] = await Promise.allSettled([
        this.scanDirectories(wordlist, webServices),
        this.scanVulnerabilities(webServices),
        this.detectTechnologies(webServices)
      ]);

      if (dirResults.status === 'fulfilled') {
        results.directories = dirResults.value;
      }
      if (vulnResults.status === 'fulfilled') {
        results.vulnerabilities = vulnResults.value;
      }
      if (techResults.status === 'fulfilled') {
        results.technologies = techResults.value;
      }

      return results;
    } catch (error) {
      console.error('Web scan error:', error);
      return results;
    }
  }
}

module.exports = WebScanner;


