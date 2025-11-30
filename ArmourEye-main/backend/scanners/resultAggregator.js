/**
 * Result Aggregator
 * Combines all scan results, calculates risk scores, and generates recommendations
 */
class ResultAggregator {
  /**
   * Aggregate all scan results from different tools
   * @param {Object} scanResults - All scan results from scanManager
   * @param {string} profile - Scan profile (misconfigs or deeper)
   * @returns {Object} Aggregated results with vulnerabilities, risk score, and recommendations
   */
  aggregateResults(scanResults, profile = 'misconfigs') {
    const vulnerabilities = this.extractVulnerabilities(scanResults);
    const allPackages = this.extractAllPackages(scanResults);
    const riskScore = this.calculateRiskScore(scanResults, vulnerabilities, profile);
    const recommendations = this.generateRecommendations(scanResults, vulnerabilities);
    
    return {
      vulnerabilities: vulnerabilities,
      allPackages: allPackages,
      riskScore: riskScore,
      recommendations: recommendations,
      summary: this.generateSummary(scanResults, vulnerabilities, riskScore)
    };
  }

  /**
   * Extract all packages (vulnerable and non-vulnerable) from all scanners
   * @param {Object} scanResults - All scan results
   * @returns {Array} Array of all packages in format { package: string, version: string }
   */
  extractAllPackages(scanResults) {
    const allPackages = [];
    const seenPackages = new Set(); // To deduplicate packages

    // Extract all packages from Trivy
    if (scanResults.trivy && scanResults.trivy.raw) {
      try {
        let trivyJson = scanResults.trivy.raw;
        
        // Clean up encoding issues - same cleanup as in extractVulnerabilities
        if (typeof trivyJson === 'string') {
          // Remove BOM and leading non-printable characters
          trivyJson = trivyJson.replace(/^\uFEFF/, '');
          trivyJson = trivyJson.replace(/^[^\x20-\x7E]+/, '');
          
          // Remove all non-printable characters except newlines, tabs, and carriage returns
          trivyJson = trivyJson.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
          
          // Find the JSON object boundaries
          const firstBrace = trivyJson.indexOf('{');
          if (firstBrace !== -1) {
            let braceCount = 0;
            let lastBrace = -1;
            let inString = false;
            let escapeNext = false;
            
            for (let i = firstBrace; i < trivyJson.length; i++) {
              const char = trivyJson[i];
              
              if (escapeNext) {
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                continue;
              }
              
              if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
              }
              
              if (!inString) {
                if (char === '{') braceCount++;
                if (char === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                    lastBrace = i;
                    break;
                  }
                }
              }
            }
            
            if (lastBrace !== -1 && lastBrace > firstBrace) {
              trivyJson = trivyJson.substring(firstBrace, lastBrace + 1);
            } else {
              const fallbackLastBrace = trivyJson.lastIndexOf('}');
              if (fallbackLastBrace > firstBrace) {
                trivyJson = trivyJson.substring(firstBrace, fallbackLastBrace + 1);
              }
            }
          }
          
          // Final cleanup
          trivyJson = trivyJson.replace(/([^\\])[\x00-\x1F]/g, (match, prefix) => {
            const charCode = match.charCodeAt(1);
            if (charCode === 0x09 || charCode === 0x0A || charCode === 0x0D) {
              return match;
            }
            return prefix;
          });
          
          trivyJson = trivyJson.replace(/[^\x20-\x7E\n\r\t]/g, '');
          trivyJson = trivyJson.trim();
        }
        
        const trivyData = typeof trivyJson === 'string' 
          ? JSON.parse(trivyJson) 
          : trivyJson;
        
        // Extract ALL packages from Packages[] array (not just Vulnerabilities[])
        if (trivyData && trivyData.Results) {
          trivyData.Results.forEach(result => {
            if (result.Packages && Array.isArray(result.Packages)) {
              result.Packages.forEach(pkg => {
                const packageName = pkg.Name || pkg.ID?.split('@')[0] || null;
                const packageVersion = pkg.Version || pkg.ID?.split('@')[1] || null;
                
                if (packageName && packageVersion) {
                  // Create unique key for deduplication
                  const uniqueKey = `${packageName}@${packageVersion}`;
                  
                  if (!seenPackages.has(uniqueKey)) {
                    seenPackages.add(uniqueKey);
                    allPackages.push({
                      package: packageName,
                      version: packageVersion
                    });
                  }
                }
              });
            }
          });
        }
      } catch (error) {
        console.error('Error extracting all packages from Trivy:', error);
      }
    }

    // Extract all packages from Docker Scout (if it provides package list)
    if (scanResults['docker-scout'] && scanResults['docker-scout'].raw) {
      try {
        let dockerScoutData = scanResults['docker-scout'].raw;
        
        // Parse if it's a string
        if (typeof dockerScoutData === 'string') {
          dockerScoutData = JSON.parse(dockerScoutData);
        }
        
        // Docker Scout SARIF format might have packages in different locations
        // Try to extract from runs[].artifacts[] or other locations
        if (dockerScoutData && Array.isArray(dockerScoutData.runs)) {
          dockerScoutData.runs.forEach(run => {
            // Check for artifacts (packages) in SARIF format
            if (run.artifacts && Array.isArray(run.artifacts)) {
              run.artifacts.forEach(artifact => {
                const packageName = artifact.name || artifact.location?.uri || null;
                const packageVersion = artifact.version || null;
                
                if (packageName && packageVersion) {
                  const uniqueKey = `${packageName}@${packageVersion}`;
                  if (!seenPackages.has(uniqueKey)) {
                    seenPackages.add(uniqueKey);
                    allPackages.push({
                      package: packageName,
                      version: packageVersion
                    });
                  }
                }
              });
            }
            
            // Also check results for package information
            if (run.results && Array.isArray(run.results)) {
              run.results.forEach(result => {
                const properties = result.properties || {};
                const packageName = properties.package || null;
                const packageVersion = properties.version || null;
                
                if (packageName && packageVersion) {
                  const uniqueKey = `${packageName}@${packageVersion}`;
                  if (!seenPackages.has(uniqueKey)) {
                    seenPackages.add(uniqueKey);
                    allPackages.push({
                      package: packageName,
                      version: packageVersion
                    });
                  }
                }
              });
            }
          });
        }
        
        // Also check if vulnerabilities array has package info (for packages not in artifacts)
        if (scanResults['docker-scout'].vulnerabilities && Array.isArray(scanResults['docker-scout'].vulnerabilities)) {
          scanResults['docker-scout'].vulnerabilities.forEach(vuln => {
            if (vuln.package && vuln.version) {
              const uniqueKey = `${vuln.package}@${vuln.version}`;
              if (!seenPackages.has(uniqueKey)) {
                seenPackages.add(uniqueKey);
                allPackages.push({
                  package: vuln.package,
                  version: vuln.version
                });
              }
            }
          });
        }
      } catch (error) {
        console.error('Error extracting all packages from Docker Scout:', error);
      }
    }

    return allPackages;
  }

  /**
   * Extract all vulnerabilities from all tool results
   * @param {Object} scanResults - All scan results
   * @returns {Array} Array of all vulnerabilities
   */
  extractVulnerabilities(scanResults) {
    const vulnerabilities = [];

    // From Nmap results
    if (scanResults.nmap && scanResults.nmap.results) {
      const ports = scanResults.nmap.results.ports || [];
      ports.forEach(port => {
        if (port.state === 'open' && this.isHighRiskPort(port.number)) {
          vulnerabilities.push({
            source: 'nmap',
            type: 'exposed_service',
            severity: this.assessPortSeverity(port),
            description: `Exposed ${port.service} service on port ${port.number}`,
            port: port.number,
            service: port.service,
            version: port.version
          });
        }
      });
    }

    // From Nikto results
    if (scanResults.nikto && scanResults.nikto.vulnerabilities) {
      scanResults.nikto.vulnerabilities.forEach(vuln => {
        vulnerabilities.push({
          source: 'nikto',
          type: 'web_vulnerability',
          severity: vuln.severity || 'medium',
          description: vuln.description,
          path: vuln.path,
          osvdb: vuln.osvdb
        });
      });
    }

    // From SQLMap results
    if (scanResults.sqlmap && scanResults.sqlmap.injections) {
      scanResults.sqlmap.injections.forEach(injection => {
        vulnerabilities.push({
          source: 'sqlmap',
          type: 'sql_injection',
          severity: 'critical',
          description: `SQL injection found in parameter: ${injection.parameter}`,
          parameter: injection.parameter,
          injectionType: injection.type,
          databaseType: scanResults.sqlmap.databaseType
        });
      });
    }

    // From Hydra results
    if (scanResults.hydra && scanResults.hydra.successfulLogins) {
      scanResults.hydra.successfulLogins.forEach(login => {
        vulnerabilities.push({
          source: 'hydra',
          type: 'weak_authentication',
          severity: 'critical',
          description: `Successful login found: ${login.username}@${login.service}`,
          service: login.service,
          port: login.port,
          username: login.username,
          // Note: Password should be stored securely, not in vulnerability report
        });
      });
    }

    // From Gobuster results (exposed directories)
    if (scanResults.gobuster && scanResults.gobuster.directories) {
      scanResults.gobuster.directories.forEach(dir => {
        // Include all directories, not just sensitive ones
        vulnerabilities.push({
          source: 'gobuster',
          type: 'exposed_directory',
          severity: this.assessPathSeverity(dir.path),
          description: `Exposed directory found: ${dir.path} (Status: ${dir.statusCode})`,
          path: dir.path,
          statusCode: dir.statusCode
        });
      });
    }
    
    // From Trivy results (container image vulnerabilities)
    if (scanResults.trivy && scanResults.trivy.raw) {
      try {
        let trivyJson = scanResults.trivy.raw;
        
        // Clean up encoding issues - aggressive cleanup to handle binary data
        if (typeof trivyJson === 'string') {
          // Remove BOM and leading non-printable characters
          trivyJson = trivyJson.replace(/^\uFEFF/, '');
          trivyJson = trivyJson.replace(/^[^\x20-\x7E]+/, '');
          
          // Remove all non-printable characters except newlines, tabs, and carriage returns
          trivyJson = trivyJson.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
          
          // Find the JSON object boundaries with proper string handling
          const firstBrace = trivyJson.indexOf('{');
          if (firstBrace !== -1) {
            let braceCount = 0;
            let lastBrace = -1;
            let inString = false;
            let escapeNext = false;
            
            for (let i = firstBrace; i < trivyJson.length; i++) {
              const char = trivyJson[i];
              
              if (escapeNext) {
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                continue;
              }
              
              if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
              }
              
              if (!inString) {
                if (char === '{') braceCount++;
                if (char === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                    lastBrace = i;
                    break;
                  }
                }
              }
            }
            
            if (lastBrace !== -1 && lastBrace > firstBrace) {
              trivyJson = trivyJson.substring(firstBrace, lastBrace + 1);
            } else {
              const fallbackLastBrace = trivyJson.lastIndexOf('}');
              if (fallbackLastBrace > firstBrace) {
                trivyJson = trivyJson.substring(firstBrace, fallbackLastBrace + 1);
              }
            }
          }
          
          // Final cleanup: remove any remaining problematic patterns
          // Replace control characters in strings with escaped versions or remove them
          trivyJson = trivyJson.replace(/([^\\])[\x00-\x1F]/g, (match, prefix) => {
            const charCode = match.charCodeAt(1);
            // Keep common whitespace characters
            if (charCode === 0x09 || charCode === 0x0A || charCode === 0x0D) {
              return match; // Keep tab, newline, carriage return
            }
            // Remove other control characters
            return prefix;
          });
          
          // Remove any remaining non-printable characters except whitespace
          trivyJson = trivyJson.replace(/[^\x20-\x7E\n\r\t]/g, '');
          trivyJson = trivyJson.trim();
        }
        
        const trivyData = typeof trivyJson === 'string' 
          ? JSON.parse(trivyJson) 
          : trivyJson;
        
        if (trivyData && trivyData.Results) {
          trivyData.Results.forEach(result => {
            if (result.Vulnerabilities) {
              result.Vulnerabilities.forEach(vuln => {
                vulnerabilities.push({
                  source: 'trivy',
                  type: 'package_vulnerability',
                  severity: this.mapTrivySeverity(vuln.Severity),
                  description: `${vuln.Title || vuln.VulnerabilityID}: ${vuln.Description || ''}`,
                  package: vuln.PkgName,
                  version: vuln.InstalledVersion,
                  fixedVersion: vuln.FixedVersion,
                  cve: vuln.VulnerabilityID,
                  cvss: vuln.CVSS || {}
                });
              });
            }
          });
        }
      } catch (error) {
        console.error('Error parsing Trivy results:', error);
      }
    }

    // From Docker Scout results
    if (scanResults['docker-scout'] && scanResults['docker-scout'].vulnerabilities) {
      scanResults['docker-scout'].vulnerabilities.forEach(vuln => {
        vulnerabilities.push({
          source: 'docker-scout',
          type: 'package_vulnerability',
          severity: vuln.severity || 'medium',
          description: vuln.description,
          package: vuln.package,
          version: vuln.version,
          fixedVersion: vuln.fixedVersion,
          cve: vuln.cve,
          cvss: vuln.cvss || {},
          locations: vuln.locations || null
        });
      });
    }

    // From database port scan results
    if (scanResults['database-port-scan'] && scanResults['database-port-scan'].vulnerabilities) {
      scanResults['database-port-scan'].vulnerabilities.forEach(vuln => {
        vulnerabilities.push({
          source: 'database-port-scan',
          type: vuln.type || 'database_vulnerability',
          severity: vuln.severity || 'medium',
          description: vuln.description || vuln.name,
          databaseType: vuln.databaseType,
          port: scanResults['database-port-scan'].port
        });
      });
    }

    return vulnerabilities;
  }

  /**
   * Map Trivy severity to standard severity levels
   * @param {string} trivySeverity - Trivy severity (CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN)
   * @returns {string} Standard severity level
   */
  mapTrivySeverity(trivySeverity) {
    const severityMap = {
      'CRITICAL': 'critical',
      'HIGH': 'high',
      'MEDIUM': 'medium',
      'LOW': 'low',
      'UNKNOWN': 'low'
    };
    return severityMap[trivySeverity?.toUpperCase()] || 'medium';
  }

  /**
   * Check if port is high risk
   * @param {number} port - Port number
   * @returns {boolean} True if high risk
   */
  isHighRiskPort(port) {
    const highRiskPorts = [21, 22, 23, 25, 53, 80, 110, 143, 443, 3306, 5432, 8080, 8443];
    return highRiskPorts.includes(port);
  }

  /**
   * Assess severity of exposed port
   * @param {Object} port - Port information
   * @returns {string} Severity level
   */
  assessPortSeverity(port) {
    const criticalPorts = [3306, 5432, 1433, 27017]; // Databases
    const highRiskPorts = [22, 21, 23]; // SSH, FTP, Telnet
    
    if (criticalPorts.includes(port.number)) return 'critical';
    if (highRiskPorts.includes(port.number)) return 'high';
    if (port.number === 80 || port.number === 443) return 'medium';
    return 'low';
  }

  /**
   * Check if path is sensitive
   * @param {string} path - Directory path
   * @returns {boolean} True if sensitive
   */
  isSensitivePath(path) {
    const sensitivePatterns = [
      'admin', 'backup', 'config', 'database', 'db', 'test', 'dev',
      'private', 'secret', 'internal', 'api', '.git', '.env', 'phpinfo',
      'wp-admin', 'wp-content', 'includes', 'logs', 'log'
    ];
    
    const lowerPath = path.toLowerCase();
    return sensitivePatterns.some(pattern => lowerPath.includes(pattern));
  }

  /**
   * Assess severity of exposed path
   * @param {string} path - Directory path
   * @returns {string} Severity level
   */
  assessPathSeverity(path) {
    const criticalPatterns = ['.env', '.git', 'backup', 'database', 'config'];
    const highPatterns = ['admin', 'api', 'private', 'secret'];
    
    const lowerPath = path.toLowerCase();
    if (criticalPatterns.some(p => lowerPath.includes(p))) return 'critical';
    if (highPatterns.some(p => lowerPath.includes(p))) return 'high';
    return 'medium';
  }

  /**
   * Calculate overall risk score (0-100)
   * @param {Object} scanResults - All scan results
   * @param {Array} vulnerabilities - Extracted vulnerabilities
   * @param {string} profile - Scan profile (misconfigs or deeper)
   * @returns {number} Risk score 0-100
   */
  calculateRiskScore(scanResults, vulnerabilities, profile = 'misconfigs') {
    let score = 0;

    // Count vulnerabilities by severity
    const critical = vulnerabilities.filter(v => v.severity === 'critical').length;
    const high = vulnerabilities.filter(v => v.severity === 'high').length;
    const medium = vulnerabilities.filter(v => v.severity === 'medium').length;
    const low = vulnerabilities.filter(v => v.severity === 'low').length;

    // Weighted scoring
    score += critical * 10; // Each critical = 10 points
    score += high * 5;      // Each high = 5 points
    score += medium * 2;    // Each medium = 2 points
    score += low * 0.5;     // Each low = 0.5 points

    // Additional factors - deeper scan tools contribute more
    if (scanResults.sqlmap && scanResults.sqlmap.injections && scanResults.sqlmap.injections.length > 0) {
      score += 20; // SQL injection is very serious
    }

    if (scanResults.hydra && scanResults.hydra.successfulLogins && scanResults.hydra.successfulLogins.length > 0) {
      score += 25; // Successful brute force is critical
    }
    
    // Docker Scout findings contribute to risk score
    if (scanResults['docker-scout'] && scanResults['docker-scout'].vulnerabilities) {
      scanResults['docker-scout'].vulnerabilities.forEach(vuln => {
        if (vuln.severity === 'critical') score += 6;
        else if (vuln.severity === 'high') score += 3;
        else if (vuln.severity === 'medium') score += 1;
        else if (vuln.severity === 'low') score += 0.25;
      });
    }
    
    // Gobuster findings (exposed directories) contribute to risk
    if (scanResults.gobuster && scanResults.gobuster.directories && scanResults.gobuster.directories.length > 0) {
      const sensitiveDirs = scanResults.gobuster.directories.filter(d => 
        d.path && (d.path.includes('admin') || d.path.includes('config') || d.path.includes('backup') || d.path.includes('.git'))
      );
      score += sensitiveDirs.length * 2; // Each sensitive directory = 2 points
    }

    // Trivy vulnerabilities contribute to risk score
    if (scanResults.trivy && scanResults.trivy.raw) {
      try {
        let trivyJson = scanResults.trivy.raw;
        
        // Clean up encoding issues - same aggressive cleanup as in extractVulnerabilities
        if (typeof trivyJson === 'string') {
          // Remove BOM and leading non-printable characters
          trivyJson = trivyJson.replace(/^\uFEFF/, '');
          trivyJson = trivyJson.replace(/^[^\x20-\x7E]+/, '');
          
          // Remove all non-printable characters except newlines, tabs, and carriage returns
          trivyJson = trivyJson.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
          
          // Find the JSON object boundaries
          const firstBrace = trivyJson.indexOf('{');
          if (firstBrace !== -1) {
            let braceCount = 0;
            let lastBrace = -1;
            let inString = false;
            let escapeNext = false;
            
            for (let i = firstBrace; i < trivyJson.length; i++) {
              const char = trivyJson[i];
              
              if (escapeNext) {
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                continue;
              }
              
              if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
              }
              
              if (!inString) {
                if (char === '{') braceCount++;
                if (char === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                    lastBrace = i;
                    break;
                  }
                }
              }
            }
            
            if (lastBrace !== -1 && lastBrace > firstBrace) {
              trivyJson = trivyJson.substring(firstBrace, lastBrace + 1);
            } else {
              const fallbackLastBrace = trivyJson.lastIndexOf('}');
              if (fallbackLastBrace > firstBrace) {
                trivyJson = trivyJson.substring(firstBrace, fallbackLastBrace + 1);
              }
            }
          }
          
          // Final cleanup
          trivyJson = trivyJson.replace(/[^\x20-\x7E\n\r\t]/g, '');
          trivyJson = trivyJson.trim();
        }
        
        const trivyData = typeof trivyJson === 'string' 
          ? JSON.parse(trivyJson) 
          : trivyJson;
        
        if (trivyData && trivyData.Results) {
          trivyData.Results.forEach(result => {
            if (result.Vulnerabilities) {
              result.Vulnerabilities.forEach(vuln => {
                const severity = this.mapTrivySeverity(vuln.Severity);
                if (severity === 'critical') score += 5;
                else if (severity === 'high') score += 2;
                else if (severity === 'medium') score += 0.5;
              });
            }
          });
        }
      } catch (error) {
        console.error('Error parsing Trivy for risk score:', error);
      }
    }

    // Cap at 100
    return Math.min(100, Math.round(score));
  }

  /**
   * Generate prioritized remediation recommendations
   * @param {Object} scanResults - All scan results
   * @param {Array} vulnerabilities - Extracted vulnerabilities
   * @returns {Array} Prioritized recommendations
   */
  generateRecommendations(scanResults, vulnerabilities) {
    const recommendations = [];

    // Critical vulnerabilities first
    const criticalVulns = vulnerabilities.filter(v => v.severity === 'critical');
    criticalVulns.forEach(vuln => {
      recommendations.push({
        priority: 'critical',
        action: this.getRemediationAction(vuln),
        description: `Fix critical vulnerability: ${vuln.description}`,
        vulnerability: vuln
      });
    });

    // High severity vulnerabilities
    const highVulns = vulnerabilities.filter(v => v.severity === 'high');
    highVulns.forEach(vuln => {
      recommendations.push({
        priority: 'high',
        action: this.getRemediationAction(vuln),
        description: `Address high severity issue: ${vuln.description}`,
        vulnerability: vuln
      });
    });

    // Medium and low (limit to top 10)
    const otherVulns = vulnerabilities
      .filter(v => v.severity === 'medium' || v.severity === 'low')
      .slice(0, 10);
    
    otherVulns.forEach(vuln => {
      recommendations.push({
        priority: vuln.severity,
        action: this.getRemediationAction(vuln),
        description: `Consider addressing: ${vuln.description}`,
        vulnerability: vuln
      });
    });

    return recommendations;
  }

  /**
   * Get remediation action for vulnerability
   * @param {Object} vulnerability - Vulnerability object
   * @returns {string} Remediation action
   */
  getRemediationAction(vulnerability) {
    switch (vulnerability.type) {
      case 'sql_injection':
        return 'Implement parameterized queries and input validation';
      case 'weak_authentication':
        return 'Enforce strong password policies and enable MFA';
      case 'exposed_service':
        return 'Restrict access to service or disable if not needed';
      case 'exposed_directory':
        return 'Remove or restrict access to sensitive directories';
      case 'web_vulnerability':
        return 'Update software or apply security patches';
      default:
        return 'Review and remediate based on vulnerability type';
    }
  }

  /**
   * Generate summary of scan results
   * @param {Object} scanResults - All scan results
   * @param {Array} vulnerabilities - Extracted vulnerabilities
   * @param {number} riskScore - Calculated risk score
   * @returns {Object} Summary information
   */
  generateSummary(scanResults, vulnerabilities, riskScore) {
    const severityCounts = {
      critical: vulnerabilities.filter(v => v.severity === 'critical').length,
      high: vulnerabilities.filter(v => v.severity === 'high').length,
      medium: vulnerabilities.filter(v => v.severity === 'medium').length,
      low: vulnerabilities.filter(v => v.severity === 'low').length
    };

    const toolsExecuted = Object.keys(scanResults).filter(key => 
      key !== 'nmap' && scanResults[key] && scanResults[key].success !== false
    );

    return {
      totalVulnerabilities: vulnerabilities.length,
      severityCounts: severityCounts,
      riskScore: riskScore,
      riskLevel: this.getRiskLevel(riskScore),
      toolsExecuted: toolsExecuted,
      scanComplete: true
    };
  }

  /**
   * Get risk level from score
   * @param {number} score - Risk score
   * @returns {string} Risk level
   */
  getRiskLevel(score) {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'minimal';
  }

  /**
   * Format report as human-readable text
   * @param {Object} aggregatedResults - Aggregated results
   * @returns {string} Formatted report
   */
  formatReport(aggregatedResults) {
    const { vulnerabilities, riskScore, recommendations, summary } = aggregatedResults;
    
    let report = `\n=== ARMOUREYE SCAN REPORT ===\n\n`;
    report += `Risk Score: ${riskScore}/100 (${summary.riskLevel})\n`;
    report += `Total Vulnerabilities: ${summary.totalVulnerabilities}\n`;
    report += `  - Critical: ${summary.severityCounts.critical}\n`;
    report += `  - High: ${summary.severityCounts.high}\n`;
    report += `  - Medium: ${summary.severityCounts.medium}\n`;
    report += `  - Low: ${summary.severityCounts.low}\n\n`;
    
    report += `Tools Executed: ${summary.toolsExecuted.join(', ')}\n\n`;
    
    report += `=== TOP RECOMMENDATIONS ===\n\n`;
    recommendations.slice(0, 10).forEach((rec, index) => {
      report += `${index + 1}. [${rec.priority.toUpperCase()}] ${rec.description}\n`;
      report += `   Action: ${rec.action}\n\n`;
    });
    
    return report;
  }

  /**
   * Extract runtime scanner data for RAG/LLM analysis
   * @param {Object} scanResults - All scan results
   * @returns {Object} Structured runtime context data
   */
  extractRuntimeContext(scanResults) {
    const runtimeData = {
      network: {
        open_ports: [],
        services: {}
      },
      web_vulnerabilities: [],
      database_issues: [],
      auth_weaknesses: [],
      exposed_directories: []
    };

    // Extract Nmap data (network/ports)
    if (scanResults.nmap && scanResults.nmap.results) {
      const ports = scanResults.nmap.results.ports || [];
      ports.forEach(port => {
        if (port.state === 'open') {
          runtimeData.network.open_ports.push(port.number);
          runtimeData.network.services[port.number] = port.service || 'unknown';
        }
      });
    }

    // Extract Nikto web vulnerabilities
    if (scanResults.nikto && scanResults.nikto.vulnerabilities) {
      scanResults.nikto.vulnerabilities.forEach(vuln => {
        runtimeData.web_vulnerabilities.push({
          type: vuln.type || 'web_vulnerability',
          severity: vuln.severity || 'medium',
          description: vuln.description,
          path: vuln.path
        });
      });
    }

    // Extract Gobuster exposed directories
    if (scanResults.gobuster && scanResults.gobuster.directories) {
      scanResults.gobuster.directories.forEach(dir => {
        runtimeData.exposed_directories.push({
          path: dir.path,
          status_code: dir.statusCode
        });
      });
    }

    // Extract database issues
    if (scanResults['database-port-scan'] && scanResults['database-port-scan'].vulnerabilities) {
      scanResults['database-port-scan'].vulnerabilities.forEach(vuln => {
        runtimeData.database_issues.push({
          type: vuln.type || 'database_vulnerability',
          severity: vuln.severity || 'medium',
          description: vuln.description,
          database_type: vuln.databaseType
        });
      });
    }

    // Extract auth weaknesses (Hydra)
    if (scanResults.hydra && scanResults.hydra.successfulLogins) {
      scanResults.hydra.successfulLogins.forEach(login => {
        runtimeData.auth_weaknesses.push({
          service: login.service,
          port: login.port,
          severity: 'critical'
        });
      });
    }

    return runtimeData;
  }
}

module.exports = ResultAggregator;





