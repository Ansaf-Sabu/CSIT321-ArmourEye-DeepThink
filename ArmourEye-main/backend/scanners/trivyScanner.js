const ToolExecutor = require('./toolExecutor');
const fs = require('fs');
const path = require('path');

class TrivyScanner {
  constructor(scanId, imageName) {
    this.scanId = scanId;
    this.imageName = imageName;
    this.executor = new ToolExecutor(scanId, null);
    this.logFilePath = path.join(__dirname, '../../scans/logs', `trivy_${scanId}.log`);
    
    // Ensure log directory exists
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  _sanitizeJsonString(raw) {
    let result = '';
    let inString = false;
    let escapeNext = false;
    let sanitizedCount = 0;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      const code = ch.charCodeAt(0);

      if (inString) {
        if (escapeNext) {
          result += ch;
          escapeNext = false;
          continue;
        }

        if (ch === '\\') {
          result += ch;
          escapeNext = true;
          continue;
        }

        if (ch === '"') {
          result += ch;
          inString = false;
          continue;
        }

        if ((code >= 0 && code <= 0x1F) || code === 0x2028 || code === 0x2029) {
          const hex = code.toString(16).padStart(4, '0');
          result += `\\u${hex}`;
          sanitizedCount++;
          continue;
        }

        if (code === 0xFFFD) {
          result += '?';
          sanitizedCount++;
          continue;
        }

        result += ch;
      } else {
        if (ch === '"') {
          inString = true;
        }
        result += ch;
      }
    }

    if (sanitizedCount > 0) {
      this._writeLog('info', `Sanitized ${sanitizedCount} control characters inside JSON strings`);
    }

    if (inString) {
      this._writeLog('warn', 'Detected unterminated string while sanitizing JSON');
    }

    return result;
  }

  _writeLog(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    const dataEntry = data ? `\nData: ${JSON.stringify(data, null, 2)}` : '';
    
    console.log(`[${this.scanId}] Trivy: ${message}`);
    
    try {
      fs.appendFileSync(this.logFilePath, logEntry + dataEntry + '\n', 'utf8');
    } catch (err) {
      console.error(`[${this.scanId}] Failed to write to log file:`, err.message);
    }
  }

  async scanImage() {
    this._writeLog('info', `Starting Trivy scan for image: ${this.imageName}`);
    
    try {
      const outputPath = this.executor.getOutputPath('trivy_image', 'json');
      this._writeLog('info', `Output path: ${outputPath}`);

      // Use the exact same command that works manually
      // trivy image --format json --output <file> <image>
      const command = [
        'trivy',
        'image',
        '--format', 'json',
        '-o', outputPath,
        this.imageName
      ];

      this._writeLog('info', `Executing command: ${command.join(' ')}`);
      const result = await this.executor.executeCommand(command, { timeout: 900000 }); // 15 minutes
      this._writeLog('info', `Command completed. Exit code: ${result.exitCode || 'N/A'}`);

      // Try to read the output file with retries
      let json = '';
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        json = await this.executor.readFileFromContainer(outputPath);
          if (!json || json.trim().length === 0) {
            throw new Error('Output file is empty');
          }
          this._writeLog('info', `Read ${json.length} bytes from file ${outputPath}`);
          break;
        } catch (readError) {
          this._writeLog('warn', `Attempt ${attempt} to read Trivy output failed: ${readError.message}`);
          if (attempt === maxAttempts) {
            this._writeLog('error', `Failed to read Trivy output after ${maxAttempts} attempts`);
            throw new Error(`Failed to read Trivy output: ${readError.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      
      // Validate we have data
      if (!json || json.trim().length === 0) {
        throw new Error('Trivy returned empty output');
      }
      
      // Minimal cleanup: remove BOM, trim, then sanitize problematic control characters
      json = json.replace(/^\uFEFF/, '').trim();
        const firstBrace = json.indexOf('{');
      if (firstBrace > 0) {
        this._writeLog('warn', `Found leading characters before JSON, removing ${firstBrace} chars`);
        json = json.substring(firstBrace);
      }
      json = this._sanitizeJsonString(json);
      
      // Parse JSON - this should work since Trivy outputs valid JSON
      let parsedJson;
      try {
        parsedJson = JSON.parse(json);
        this._writeLog('info', `Successfully parsed JSON`);
        this._writeLog('info', `Has SchemaVersion: ${!!parsedJson.SchemaVersion}`);
        this._writeLog('info', `Has Results: ${!!parsedJson.Results}`);
        this._writeLog('info', `Results count: ${parsedJson.Results ? parsedJson.Results.length : 0}`);
        
        if (parsedJson.Results && parsedJson.Results.length > 0) {
          const firstResult = parsedJson.Results[0];
          this._writeLog('info', `First result Target: ${firstResult.Target || 'N/A'}`);
          this._writeLog('info', `First result has Packages: ${!!firstResult.Packages}`);
          this._writeLog('info', `First result Packages count: ${firstResult.Packages ? firstResult.Packages.length : 0}`);
            }
      } catch (parseError) {
        this._writeLog('error', `JSON parse failed: ${parseError.message}`);
        this._writeLog('error', `JSON length: ${json.length}`);
        this._writeLog('error', `First 200 chars: ${json.substring(0, 200)}`);
        this._writeLog('error', `Last 200 chars: ${json.substring(Math.max(0, json.length - 200))}`);
        throw new Error(`Failed to parse Trivy JSON: ${parseError.message}`);
      }
      
      // Validate essential structure
      if (!parsedJson.Results) {
        this._writeLog('warn', `Parsed JSON but missing Results array`);
        this._writeLog('warn', `Available keys: ${Object.keys(parsedJson).join(', ')}`);
      } else {
        this._writeLog('info', `Validation passed - Results array found with ${parsedJson.Results.length} entries`);
      }

      // Return the parsed JSON as a string (will be parsed again when needed)
      // Store as string to match existing interface
      this._writeLog('info', `Scan completed successfully. Returning ${JSON.stringify(parsedJson).length} bytes of JSON`);

      return {
        success: true,
        exitCode: result.exitCode || 0,
        raw: JSON.stringify(parsedJson) // Store as string to match existing interface
      };
    } catch (error) {
      this._writeLog('error', `Scan failed: ${error.message}`);
      this._writeLog('error', `Stack trace: ${error.stack}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = TrivyScanner;

