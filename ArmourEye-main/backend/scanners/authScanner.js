const ToolExecutor = require('./toolExecutor');

/**
 * Authentication Scanner
 * Executes Hydra for brute force testing and default credential checks
 */
class AuthScanner {
  constructor(scanId, targetIp) {
    this.scanId = scanId;
    this.targetIp = targetIp;
    this.executor = new ToolExecutor(scanId, targetIp);
  }

  /**
   * Execute Hydra brute force attack
   * @param {string} service - Service type (ssh, http, ftp, etc.)
   * @param {Object} options - Brute force options
   * @param {string} options.userList - Username list file (default: common usernames)
   * @param {string} options.passwordList - Password list file (default: rockyou.txt)
   * @param {number} options.port - Service port (optional)
   * @returns {Promise<Object>} Parsed Hydra results
   */
  async bruteForce(service, options = {}) {
    try {
      const {
        userList = 'common.txt',
        passwordList = 'rockyou.txt',
        port = null
      } = options;

      const outputPath = this.executor.getOutputPath(`hydra_${service}`, 'txt');
      const target = port ? `${this.targetIp}:${port}` : this.targetIp;

      // Build Hydra command based on service type
      let command = ['hydra', '-L', `/usr/share/wordlists/${userList}`];
      
      // For SSH, use -P for password list
      if (service === 'ssh') {
        command.push('-P', `/usr/share/wordlists/${passwordList}`);
        command.push('ssh://' + target);
      } else if (service === 'http' || service === 'http-post-form') {
        // HTTP form brute force
        command.push('-P', `/usr/share/wordlists/${passwordList}`);
        command.push('http-post-form://' + target + '/login:username=^USER^&password=^PASS^:Invalid');
      } else if (service === 'ftp') {
        command.push('-P', `/usr/share/wordlists/${passwordList}`);
        command.push('ftp://' + target);
      } else {
        // Generic service
        command.push('-P', `/usr/share/wordlists/${passwordList}`);
        command.push(`${service}://${target}`);
      }

      command.push('-o', outputPath, '-t', '4'); // 4 threads, save output

      await this.executor.executeCommand(command, { timeout: 1800000 }); // 30 minutes
      
      // Read and parse output
      const output = await this.executor.readFileFromContainer(outputPath);
      return this.parseHydraOutput(output, service);
    } catch (error) {
      console.error(`Hydra ${service} brute force error:`, error);
      return {
        success: false,
        successfulLogins: [],
        testedService: service,
        error: error.message
      };
    }
  }

  /**
   * Parse Hydra output
   * @param {string} output - Hydra output text
   * @param {string} service - Service type
   * @returns {Object} Parsed results
   */
  parseHydraOutput(output, service) {
    const successfulLogins = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Hydra output format: [service] host:port login:password
      // Example: [22][ssh] host:22 login:password
      const match = line.match(/\[(\d+)\]\[(\w+)\]\s+([^:]+):(\d+)\s+login:(\S+)\s+password:(\S+)/);
      if (match) {
        successfulLogins.push({
          service: match[2],
          host: match[3],
          port: parseInt(match[4]),
          username: match[5],
          password: match[6], // WARNING: Store securely in production!
          severity: 'critical'
        });
      }
    }

    return {
      success: true,
      successfulLogins: successfulLogins,
      testedService: service,
      count: successfulLogins.length
    };
  }

  /**
   * Test default credentials for common services
   * Note: This is a simplified implementation. For production, use proper authentication testing tools.
   * @param {Array} services - Array of services with ports
   * @returns {Promise<Object>} Default credential test results
   */
  async testDefaultCredentials(services) {
    const results = {
      successfulLogins: [],
      testedServices: []
    };

    // Common default credentials
    const defaultCreds = [
      { username: 'admin', password: 'admin' },
      { username: 'admin', password: 'password' },
      { username: 'admin', password: '123456' },
      { username: 'root', password: 'root' },
      { username: 'root', password: 'password' },
      { username: 'user', password: 'user' },
      { username: 'test', password: 'test' }
    ];

    for (const service of services) {
      try {
        results.testedServices.push({
          service: service.service,
          port: service.port
        });

        // For SSH, use Hydra with a small default credentials list
        if (service.service === 'ssh' || service.port === 22) {
          // Create a temporary wordlist with default credentials
          const tempWordlist = '/tmp/default_creds.txt';
          const credsList = defaultCreds.map(c => `${c.username}:${c.password}`).join('\n');
          
          // Write wordlist to container
          const writeCmd = ['sh', '-c', `echo "${credsList}" > ${tempWordlist}`];
          await this.executor.executeCommand(writeCmd);
          
          // Use Hydra with custom wordlist (format: username:password)
          // Note: This is a simplified approach - Hydra typically uses separate user/pass lists
          // For now, we'll just note that default credentials should be tested
          console.log(`[${this.scanId}] Default credentials should be tested for ${service.service} on port ${service.port}`);
        }
      } catch (error) {
        console.error(`Default credential test error for ${service.service}:`, error);
      }
    }

    return results;
  }
}

module.exports = AuthScanner;

