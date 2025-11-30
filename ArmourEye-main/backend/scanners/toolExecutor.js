const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

// Helper function to get Docker client based on platform
function getDockerClient() {
  if (process.platform === 'win32') {
    // Windows uses named pipe
    return new Docker({ socketPath: '//./pipe/docker_engine' });
  }
  // Linux/Mac uses Unix socket
  return new Docker({ socketPath: '/var/run/docker.sock' });
}

/**
 * Base class for executing security tools in the scanner container
 * Provides common functionality for Docker exec, output handling, and error management
 */
class ToolExecutor {
  constructor(scanId, targetIp) {
    this.scanId = scanId;
    this.targetIp = targetIp;
    this.docker = getDockerClient();
    this.scannerContainerName = 'armoureye-scanner';
    this.resultsDir = `/scans/results/${scanId}`;
    this.container = null;
  }

  /**
   * Get or create scanner container
   * @returns {Promise<Object>} Docker container instance
   */
  async getScannerContainer() {
    try {
      if (this.container) {
        // Check if container is still running
        const info = await this.container.inspect();
        if (info.State.Running) {
          return this.container;
        }
      }

      // Try to find existing scanner container
      const containers = await this.docker.listContainers({ all: true });
      const scannerContainer = containers.find(container => 
        container.Names && container.Names.includes(`/${this.scannerContainerName}`)
      );

      if (scannerContainer) {
        const container = this.docker.getContainer(scannerContainer.Id);
        
        // If container is running, return it
        if (scannerContainer.State === 'running') {
          this.container = container;
          return this.container;
        }
        
        // If container exists but is stopped, remove it first
        console.log('Found stopped scanner container, removing it...');
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
      // Bridge network allows containers to communicate with each other by IP
      const networkMode = process.platform === 'win32' ? 'bridge' : 'host';
      
      // Mount Docker socket so Trivy can access Docker daemon
      // Docker Desktop on Windows handles the socket translation automatically
      // We use /var/run/docker.sock which Docker Desktop exposes
      const hostConfig = {
        NetworkMode: networkMode,
        Privileged: true,
        // Ensure container can communicate with other containers on bridge network
        // This is important for runtime scanners (Nmap, Nikto, etc.) to reach target containers
        ExtraHosts: [] // Can add host mappings if needed
      };
      
      // Mount Docker socket and Docker credentials for Docker Scout
      const binds = ['/var/run/docker.sock:/var/run/docker.sock:ro'];
      
      // Mount Docker credentials from host to container (for Docker Scout login)
      // This allows Docker Scout to use the host's Docker Hub credentials
      const os = require('os');
      const hostDockerConfigDir = path.join(os.homedir(), '.docker');
      const hostDockerConfigPath = path.join(hostDockerConfigDir, 'config.json');
      let dockerConfigDirToMount = null;
      
      try {
        if (fs.existsSync(hostDockerConfigPath)) {
          const sanitizedConfigDir = path.join(__dirname, '../../.scanner-docker-config');
          fs.mkdirSync(sanitizedConfigDir, { recursive: true });
          const sanitizedConfigPath = path.join(sanitizedConfigDir, 'config.json');
          
          let parsedConfig = {};
          try {
            const rawConfig = fs.readFileSync(hostDockerConfigPath, 'utf8');
            parsedConfig = rawConfig.trim() ? JSON.parse(rawConfig) : {};
          } catch (parseError) {
            console.warn('Could not parse host Docker config; mounting original config directory instead');
            dockerConfigDirToMount = hostDockerConfigDir;
          }
          
          if (!dockerConfigDirToMount) {
            const allowedKeys = ['auths', 'HttpHeaders', 'stackOrchestrator', 'currentContext', 'experimental'];
            const sanitizedConfig = {};
            allowedKeys.forEach(key => {
              if (parsedConfig[key] !== undefined) {
                sanitizedConfig[key] = parsedConfig[key];
              }
            });
            if (!sanitizedConfig.auths) {
              sanitizedConfig.auths = {};
            }
            
            fs.writeFileSync(sanitizedConfigPath, JSON.stringify(sanitizedConfig, null, 2), 'utf8');
            dockerConfigDirToMount = sanitizedConfigDir;
            
            if (parsedConfig.credsStore || (parsedConfig.credHelpers && Object.keys(parsedConfig.credHelpers).length > 0)) {
              console.log('Prepared sanitized Docker config without credential helper references for scanner container');
            } else {
              console.log('Mounted Docker credentials using sanitized config for scanner container');
            }
          }
        } else {
          console.warn('Docker config not found on host. Docker Scout may require manual login.');
          console.warn(`Expected path: ${hostDockerConfigPath}`);
        }
      } catch (credError) {
        console.warn('Could not prepare Docker credentials:', credError.message);
        console.warn('Docker Scout may require manual login inside the container.');
      }
      
      if (dockerConfigDirToMount) {
        let dockerConfigVolume = dockerConfigDirToMount;
        if (process.platform === 'win32') {
          dockerConfigVolume = dockerConfigVolume.replace(/\\/g, '/');
          if (dockerConfigVolume.match(/^[A-Z]:/)) {
            const drive = dockerConfigVolume[0].toLowerCase();
            dockerConfigVolume = `/${drive}${dockerConfigVolume.substring(2)}`;
          }
        }
        
        binds.push(`${dockerConfigVolume}:/root/.docker:ro`);
      } else {
        console.warn('Docker config not mounted; Docker Scout may require manual login inside the container.');
      }
      
      try {
        hostConfig.Binds = binds;
      } catch (bindError) {
        console.warn('Could not configure Docker socket/credentials bind:', bindError.message);
      }
      
      const container = await this.docker.createContainer({
        Image: 'armoureye-scanner:latest',
        name: this.scannerContainerName,
        HostConfig: hostConfig,
        Cmd: ['/bin/bash', '-c', 'tail -f /dev/null'] // Keep container running
      });

      await container.start();
      this.container = container;
      
      // Ensure results directory exists
      await this.ensureResultsDirectory();
      
      return container;
    } catch (error) {
      console.error('Error getting scanner container:', error);
      throw error;
    }
  }

  /**
   * Ensure results directory exists in container
   */
  async ensureResultsDirectory() {
    try {
      console.log(`[${this.scanId}] Ensuring results directory exists: ${this.resultsDir}`);
      const container = await this.getScannerContainer();
      console.log(`[${this.scanId}] Got scanner container, creating directory...`);
      
      const exec = await container.exec({
        Cmd: ['mkdir', '-p', this.resultsDir],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          stream.destroy();
          console.warn(`[${this.scanId}] Directory creation timeout, continuing anyway...`);
          resolve(); // Don't fail on timeout, just continue
        }, 5000);
        
        stream.on('end', () => {
          clearTimeout(timeout);
          console.log(`[${this.scanId}] Results directory created: ${this.resultsDir}`);
          resolve();
        });
        stream.on('error', (err) => {
          clearTimeout(timeout);
          console.error(`[${this.scanId}] Error creating results directory:`, err);
          // Don't reject, just log and continue (directory might already exist)
          resolve();
        });
      });
    } catch (error) {
      console.error(`[${this.scanId}] Error ensuring results directory:`, error);
      // Non-fatal, continue anyway
    }
  }

  /**
   * Execute a command in the scanner container
   * @param {Array<string>} command - Command and arguments as array
   * @param {Object} options - Execution options
   * @param {number} options.timeout - Timeout in milliseconds (default: 300000 = 5 minutes)
   * @param {boolean} options.returnOutput - Whether to return output (default: true)
   * @returns {Promise<Object>} Execution result with output, error, and exitCode
   */
  async executeCommand(command, options = {}) {
    const {
      timeout = 300000, // 5 minutes default (set <=0 to disable)
      returnOutput = true
    } = options;
    const hasTimeout = typeof timeout === 'number' && timeout > 0;
    
    // Ensure results directory exists before executing
    console.log(`[${this.scanId}] Step 1: Ensuring results directory...`);
    await this.ensureResultsDirectory();
    console.log(`[${this.scanId}] Step 2: Results directory ensured, getting container...`);

    try {
      console.log(`[${this.scanId}] Step 3: Getting scanner container...`);
      const container = await this.getScannerContainer();
      console.log(`[${this.scanId}] Step 4: Got container, preparing command execution...`);
      
      console.log(`[${this.scanId}] Executing: ${command.join(' ')}`);
      if (hasTimeout) {
        console.log(`[${this.scanId}] Timeout: ${timeout}ms (${Math.round(timeout / 1000)}s)`);
      } else {
        console.log(`[${this.scanId}] Timeout: disabled (no limit)`);
      }

      // Execute command in container
      const exec = await container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      
      // Collect output
      let output = '';
      let error = '';
      let hasOutput = false;
      let lastActivityTime = Date.now();
      let streamEnded = false;

      // Add progress logging for long-running commands
      const progressInterval = setInterval(() => {
        const timeSinceLastActivity = Date.now() - lastActivityTime;
        const elapsed = Math.round((Date.now() - lastActivityTime) / 1000);
        if (timeSinceLastActivity > 30000 && !streamEnded) { // Log every 30 seconds if no activity
          console.log(`[${this.scanId}] Still running... (${elapsed}s elapsed, no output in last 30s)`);
        }
      }, 30000);

      return new Promise((resolve, reject) => {
        let timeoutId = null;
        if (hasTimeout) {
          timeoutId = setTimeout(async () => {
            clearInterval(progressInterval);
            if (!streamEnded) {
              stream.destroy();
              console.error(`[${this.scanId}] Command timeout after ${timeout}ms`);
              // Try to get exit code before rejecting
              try {
                const execInfo = await exec.inspect();
                console.log(`[${this.scanId}] Exec exit code: ${execInfo.ExitCode}`);
              } catch (e) {
                // Ignore inspect errors on timeout
              }
              reject(new Error(`Command timeout after ${timeout}ms: ${command.join(' ')}`));
            }
          }, timeout);
        }

        stream.on('data', (chunk) => {
          const data = chunk.toString();
          hasOutput = true;
          lastActivityTime = Date.now();
          
          if (returnOutput) {
            output += data;
          }
          
          // Log output in real-time (but filter out empty lines to reduce noise)
          const lines = data.split('\n').filter(line => line.trim());
          if (lines.length > 0) {
            lines.forEach(line => {
              console.log(`[${this.scanId}] ${line.trim()}`);
            });
          }
        });

        stream.on('error', (err) => {
          clearInterval(progressInterval);
          if (timeoutId) clearTimeout(timeoutId);
          const errorMsg = err.toString();
          error += errorMsg;
          console.error(`[${this.scanId}] Stream error:`, errorMsg);
          reject(err);
        });

        stream.on('end', async () => {
          clearInterval(progressInterval);
          if (timeoutId) clearTimeout(timeoutId);
          streamEnded = true;
          
          // Wait a moment for the process to fully exit, then check exit code
          await new Promise(resolve => setTimeout(resolve, 100));
          
          let exitCode = 0;
          try {
            const execInfo = await exec.inspect();
            exitCode = execInfo.ExitCode || 0;
            console.log(`[${this.scanId}] Process exited with code: ${exitCode}`);
          } catch (inspectError) {
            console.warn(`[${this.scanId}] Could not inspect exec instance:`, inspectError.message);
            // Assume success if we can't inspect
            exitCode = 0;
          }
          
          if (!hasOutput && !error) {
            console.warn(`[${this.scanId}] Command completed with no output`);
          }
          
          console.log(`[${this.scanId}] Command completed. Exit code: ${exitCode}, Output length: ${output.length} chars, Error length: ${error.length} chars`);
          
          // If exit code is non-zero, include it in the error
          if (exitCode !== 0 && !error) {
            error = `Process exited with code ${exitCode}`;
          }
          
          resolve({
            output: output,
            error: error,
            exitCode: exitCode,
            command: command.join(' '),
            hasOutput: hasOutput
          });
        });
      });
    } catch (error) {
      console.error('Command execution error:', error);
      throw error;
    }
  }

  /**
   * Read file from container
   * @param {string} filePath - Path to file in container
   * @returns {Promise<string>} File contents
   */
  async readFileFromContainer(filePath) {
    try {
      const container = await this.getScannerContainer();
      const exec = await container.exec({
        Cmd: ['cat', filePath],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start({ hijack: true, stdin: false });
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

      const stdoutChunks = [];
      const stderrChunks = [];

      return new Promise((resolve, reject) => {
        const handleError = (err) => {
          stream.destroy();
          reject(err);
        };

        stdoutStream.on('data', (chunk) => stdoutChunks.push(chunk));
        stderrStream.on('data', (chunk) => stderrChunks.push(chunk));

        stream.on('error', handleError);
        stdoutStream.on('error', handleError);
        stderrStream.on('error', handleError);

        stream.on('end', async () => {
          try {
            const stdoutBuffer = Buffer.concat(stdoutChunks);
            const stderrBuffer = Buffer.concat(stderrChunks);
            let content = stdoutBuffer.toString('utf8');
            
            if (content.charCodeAt(0) === 0xFEFF) {
              content = content.substring(1);
            }
            content = content.replace(/^[\x00-\x08\x0B-\x0C\x0E-\x1F\uFEFF]+/, '');

            const execInfo = await exec.inspect();
            if (execInfo.ExitCode && execInfo.ExitCode !== 0) {
              const errorMessage = stderrBuffer.toString('utf8').trim() || `Command exited with code ${execInfo.ExitCode}`;
              return reject(new Error(errorMessage));
            }

            resolve(content);
          } catch (inspectError) {
            reject(inspectError);
          }
        });
      });
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Check if file exists in container
   * @param {string} filePath - Path to file in container
   * @returns {Promise<boolean>} True if file exists
   */
  async fileExists(filePath) {
    try {
      const container = await this.getScannerContainer();
      const exec = await container.exec({
        Cmd: ['test', '-f', filePath],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      
      return new Promise((resolve) => {
        stream.on('end', () => {
          // If command succeeds (exit code 0), file exists
          resolve(true);
        });

        stream.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Get output file path for a tool
   * @param {string} toolName - Name of the tool
   * @param {string} extension - File extension (default: 'txt')
   * @returns {string} Full path to output file
   */
  getOutputPath(toolName, extension = 'txt') {
    return `${this.resultsDir}/${toolName}_${this.scanId}.${extension}`;
  }
}

module.exports = ToolExecutor;


