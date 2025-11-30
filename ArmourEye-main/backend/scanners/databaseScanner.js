const ToolExecutor = require('./toolExecutor');

/**
 * Database Scanner
 * Executes SQLMap for SQL injection testing
 */
class DatabaseScanner {
  constructor(scanId, targetIp) {
    this.scanId = scanId;
    this.targetIp = targetIp;
    this.executor = new ToolExecutor(scanId, targetIp);
  }

  /**
   * Get base URL for database testing
   * @param {Array} webServices - Web services from Nmap
   * @returns {string} Base URL
   */
  getBaseUrl(webServices = []) {
    const hasHttps = webServices.some(s => s.port === 443 || s.port === 8443);
    const httpsPort = webServices.find(s => s.port === 443 || s.port === 8443);
    const httpPort = webServices.find(s => s.port === 80 || s.port === 8080);
    
    if (hasHttps && httpsPort) {
      const port = httpsPort.port === 443 ? '' : `:${httpsPort.port}`;
      return `https://${this.targetIp}${port}`;
    }
    
    const port = httpPort && httpPort.port !== 80 ? `:${httpPort.port}` : '';
    return `http://${this.targetIp}${port}`;
  }

  /**
   * Execute SQLMap SQL injection testing
   * @param {string} url - Target URL (optional, will auto-detect if not provided)
   * @param {Array} webServices - Web services from Nmap
   * @param {Object} options - SQLMap options
   * @returns {Promise<Object>} Parsed SQLMap results
   */
  async testSQLInjection(url = null, webServices = [], options = {}) {
    try {
      const targetUrl = url || this.getBaseUrl(webServices);
      const outputDir = `${this.executor.resultsDir}/sqlmap`;
      
      // Ensure output directory exists
      await this.executor.ensureResultsDirectory();
      
      const command = [
        'sqlmap',
        '-u', targetUrl,
        '--batch', // Non-interactive mode
        '--crawl', '2', // Crawl depth
        '--forms', // Test forms
        '--level', '2', // Test level (1-5)
        '--risk', '2', // Risk level (1-3)
        '--output-dir', outputDir,
        '--dump-all' // Dump all data if injection found
      ];

      // Add custom options
      if (options.level) {
        command[command.indexOf('--level') + 1] = String(options.level);
      }
      if (options.risk) {
        command[command.indexOf('--risk') + 1] = String(options.risk);
      }

      await this.executor.executeCommand(command, { timeout: 1800000 }); // 30 minutes
      
      // Read SQLMap output files
      const results = await this.parseSQLMapResults(outputDir);
      return results;
    } catch (error) {
      console.error('SQLMap scan error:', error);
      return {
        success: false,
        injections: [],
        error: error.message
      };
    }
  }

  /**
   * Parse SQLMap results from output directory
   * @param {string} outputDir - SQLMap output directory
   * @returns {Promise<Object>} Parsed results
   */
  async parseSQLMapResults(outputDir) {
    const injections = [];
    let databaseType = null;
    const vulnerabilities = [];

    try {
      // Try to read log file
      const logFile = `${outputDir}/log`;
      if (await this.executor.fileExists(logFile)) {
        const logContent = await this.executor.readFileFromContainer(logFile);
        const parsed = this.parseSQLMapLog(logContent);
        injections.push(...parsed.injections);
        if (parsed.databaseType) {
          databaseType = parsed.databaseType;
        }
        vulnerabilities.push(...parsed.vulnerabilities);
      }

      // Try to read target file
      const targetFile = `${outputDir}/target.txt`;
      if (await this.executor.fileExists(targetFile)) {
        const targetContent = await this.executor.readFileFromContainer(targetFile);
        const targetInfo = this.parseSQLMapTarget(targetContent);
        if (targetInfo.databaseType) {
          databaseType = targetInfo.databaseType;
        }
      }

      return {
        success: true,
        injections: injections,
        databaseType: databaseType,
        vulnerabilities: vulnerabilities,
        count: injections.length
      };
    } catch (error) {
      console.error('Error parsing SQLMap results:', error);
      return {
        success: false,
        injections: [],
        databaseType: null,
        vulnerabilities: [],
        error: error.message
      };
    }
  }

  /**
   * Parse SQLMap log file
   * @param {string} logContent - Log file content
   * @returns {Object} Parsed data
   */
  parseSQLMapLog(logContent) {
    const injections = [];
    let databaseType = null;
    const vulnerabilities = [];

    const lines = logContent.split('\n');
    for (const line of lines) {
      // Detect injection points
      if (line.includes('is vulnerable') || line.includes('injection found')) {
        const match = line.match(/parameter '([^']+)' is vulnerable/);
        if (match) {
          injections.push({
            parameter: match[1],
            type: this.extractInjectionType(line),
            severity: 'high'
          });
        }
      }

      // Detect database type
      if (line.includes('back-end DBMS:')) {
        const match = line.match(/back-end DBMS:\s*(.+)/);
        if (match) {
          databaseType = match[1].trim();
        }
      }

      // Extract vulnerabilities
      if (line.includes('CVE') || line.includes('vulnerable')) {
        vulnerabilities.push({
          description: line.trim(),
          severity: 'high'
        });
      }
    }

    return { injections, databaseType, vulnerabilities };
  }

  /**
   * Extract injection type from log line
   * @param {string} line - Log line
   * @returns {string} Injection type
   */
  extractInjectionType(line) {
    if (line.includes('boolean-based')) return 'boolean-based';
    if (line.includes('time-based')) return 'time-based';
    if (line.includes('error-based')) return 'error-based';
    if (line.includes('union')) return 'union-based';
    return 'unknown';
  }

  /**
   * Parse SQLMap target file
   * @param {string} targetContent - Target file content
   * @returns {Object} Target information
   */
  parseSQLMapTarget(targetContent) {
    let databaseType = null;
    
    const lines = targetContent.split('\n');
    for (const line of lines) {
      if (line.includes('database') || line.includes('DBMS')) {
        const match = line.match(/(?:database|DBMS)[:\s]+(.+)/i);
        if (match) {
          databaseType = match[1].trim();
        }
      }
    }

    return { databaseType };
  }

  /**
   * Detect database type from service information
   * @param {Object} service - Database service from Nmap
   * @returns {string} Database type (mysql, postgres, mongodb, mssql)
   */
  detectDatabaseType(service) {
    const port = service.port || 0;
    const serviceName = (service.service || '').toLowerCase();
    const product = (service.product || '').toLowerCase();

    if (port === 3306 || serviceName.includes('mysql') || product.includes('mysql')) {
      return 'mysql';
    }
    if (port === 5432 || serviceName.includes('postgres') || product.includes('postgres')) {
      return 'postgres';
    }
    if (port === 27017 || serviceName.includes('mongodb') || product.includes('mongodb')) {
      return 'mongodb';
    }
    if (port === 1433 || serviceName.includes('mssql') || product.includes('mssql') || product.includes('sql server')) {
      return 'mssql';
    }

    return 'unknown';
  }

  /**
   * Get Nmap scripts for database type
   * @param {string} dbType - Database type
   * @returns {Array} Array of Nmap script names
   */
  getDatabaseScripts(dbType) {
    const scripts = {
      mysql: ['mysql-vuln-cve2012-2122', 'mysql-enum', 'mysql-info', 'mysql-brute'],
      postgres: ['postgres-brute', 'postgres-enum', 'postgres-version'],
      mongodb: ['mongodb-info', 'mongodb-brute'],
      mssql: ['ms-sql-info', 'ms-sql-brute', 'ms-sql-empty-password']
    };

    return scripts[dbType] || [];
  }

  /**
   * Scan database port directly using Nmap scripts
   * @param {Object} service - Database service from Nmap
   * @returns {Promise<Object>} Scan results
   */
  async scanDirectDatabase(service) {
    try {
      const dbType = this.detectDatabaseType(service);
      const port = service.port || 3306;
      const scripts = this.getDatabaseScripts(dbType);

      if (scripts.length === 0) {
        return {
          success: false,
          vulnerabilities: [],
          error: `No Nmap scripts available for database type: ${dbType}`
        };
      }

      console.log(`[${this.scanId}] Scanning database port ${port} (${dbType}) with Nmap scripts`);

      const outputPath = this.executor.getOutputPath('nmap_db', 'xml');
      const command = [
        'nmap',
        '-p', String(port),
        '--script', scripts.join(','),
        '--script-timeout', '30s',
        '-oX', outputPath,
        this.targetIp
      ];

      const result = await this.executor.executeCommand(command, { timeout: 300000 }); // 5 minutes

      // Parse Nmap XML output
      const vulnerabilities = await this.parseNmapDatabaseOutput(outputPath, dbType);

      return {
        success: true,
        databaseType: dbType,
        port: port,
        vulnerabilities: vulnerabilities,
        count: vulnerabilities.length,
        high: vulnerabilities.filter(v => v.severity === 'high').length,
        medium: vulnerabilities.filter(v => v.severity === 'medium').length,
        low: vulnerabilities.filter(v => v.severity === 'low').length
      };
    } catch (error) {
      console.error(`[${this.scanId}] Database port scan error:`, error);
      return {
        success: false,
        vulnerabilities: [],
        error: error.message
      };
    }
  }

  /**
   * Parse Nmap XML output for database vulnerabilities
   * @param {string} xmlPath - Path to Nmap XML output
   * @param {string} dbType - Database type
   * @returns {Promise<Array>} Array of vulnerabilities
   */
  async parseNmapDatabaseOutput(xmlPath, dbType) {
    const vulnerabilities = [];

    try {
      const xmlContent = await this.executor.readFileFromContainer(xmlPath);
      const xml2js = require('xml2js');
      const parser = new xml2js.Parser({ mergeAttrs: true });
      const xmlData = await parser.parseStringPromise(xmlContent);

      if (!xmlData.nmaprun || !xmlData.nmaprun.host) {
        return vulnerabilities;
      }

      const hostData = Array.isArray(xmlData.nmaprun.host) ? xmlData.nmaprun.host[0] : xmlData.nmaprun.host;
      const ports = hostData.ports?.[0]?.port || [];
      const portList = Array.isArray(ports) ? ports : [ports];

      for (const portData of portList) {
        const scripts = portData.script || [];
        const scriptList = Array.isArray(scripts) ? scripts : [scripts];

        for (const script of scriptList) {
          if (!script || !script.id) continue;

          const scriptId = script.id;
          const scriptOutput = script.output || script.$?.output || '';

          // Parse vulnerability findings
          if (scriptId.includes('vuln') || scriptId.includes('cve')) {
            vulnerabilities.push({
              name: scriptId,
              description: scriptOutput,
              severity: this.assessDatabaseVulnSeverity(scriptId, scriptOutput),
              type: 'vulnerability',
              databaseType: dbType
            });
          }

          // Parse brute force results (weak passwords)
          if (scriptId.includes('brute') && scriptOutput.includes('Valid credentials')) {
            vulnerabilities.push({
              name: 'Weak Database Credentials',
              description: scriptOutput,
              severity: 'high',
              type: 'authentication',
              databaseType: dbType
            });
          }

          // Parse empty password findings
          if (scriptOutput.includes('empty password') || scriptOutput.includes('no password')) {
            vulnerabilities.push({
              name: 'Empty Database Password',
              description: scriptOutput,
              severity: 'critical',
              type: 'authentication',
              databaseType: dbType
            });
          }
        }
      }
    } catch (error) {
      console.error(`[${this.scanId}] Error parsing Nmap database output:`, error);
    }

    return vulnerabilities;
  }

  /**
   * Assess severity of database vulnerability
   * @param {string} scriptId - Nmap script ID
   * @param {string} output - Script output
   * @returns {string} Severity level
   */
  assessDatabaseVulnSeverity(scriptId, output) {
    const outputLower = output.toLowerCase();

    if (scriptId.includes('cve') || outputLower.includes('critical') || outputLower.includes('rce')) {
      return 'high';
    }
    if (outputLower.includes('vulnerable') || outputLower.includes('exploit')) {
      return 'medium';
    }
    if (outputLower.includes('info') || outputLower.includes('version')) {
      return 'low';
    }

    return 'medium';
  }
}

module.exports = DatabaseScanner;




