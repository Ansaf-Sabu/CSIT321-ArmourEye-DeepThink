const Docker = require('dockerode');
const NmapScanner = require('./nmap');
const AIAnalyzer = require('../ai/analyzer');
const WebScanner = require('./webScanner');
const DatabaseScanner = require('./databaseScanner');
const AuthScanner = require('./authScanner');
const ResultAggregator = require('./resultAggregator');
const DockerScoutScanner = require('./dockerScoutScanner');
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

class ScanManager {
  constructor() {
    this.activeScans = {};
    this.scanHistory = [];
    this.runtimeScanHistory = []; // Separate history for runtime scans
    this.docker = getDockerClient();
    this.scannerContainer = null; // Reference to the running scanner container
    this.logFilePath = path.join(__dirname, '../../scans/logs'); // Base path for logs
    this.resultsFilePath = path.join(__dirname, '../../scans/results'); // Base path for results

    // Ensure log and results directories exist
    fs.mkdirSync(this.logFilePath, { recursive: true });
    fs.mkdirSync(this.resultsFilePath, { recursive: true });

    this.historyStorePath = path.join(__dirname, '../data/scan-history.json');
    fs.mkdirSync(path.dirname(this.historyStorePath), { recursive: true });
    this._loadPersistedHistory();
  }

  _log(scanId, level, source, message) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, source, message };
    
    if (this.activeScans[scanId]) {
      this.activeScans[scanId].logs.push(logEntry);
      // Trim logs to prevent excessive memory usage
      if (this.activeScans[scanId].logs.length > 1000) {
        this.activeScans[scanId].logs.shift();
      }
    }
    console.log(`[${timestamp}] [${scanId}] [${source.toUpperCase()}] ${level.toUpperCase()}: ${message}`);
  }

  async startScan(targetId, targetIp, profile, targetData, options = {}) {
    // Check if a scan for this image already exists (in history or active)
    const imageName = targetData?.image || 'unknown';
    let existingScanId = null;
    const normalizedTargetIp = targetIp || null;
    const displayTargetIp = normalizedTargetIp || 'N/A';
    const networkScanEnabled = options.networkScanEnabled !== false && !!normalizedTargetIp;
    
    // Check active scans first
    for (const [id, scan] of Object.entries(this.activeScans)) {
      if (scan.targetData?.image === imageName) {
        existingScanId = id;
        break;
      }
    }
    
    // If not in active scans, check history
    if (!existingScanId) {
      const existingScan = this.scanHistory.find(scan => scan.targetData?.image === imageName);
      if (existingScan) {
        existingScanId = existingScan.scanId;
        // Remove from history so we can overwrite it
        this.scanHistory = this.scanHistory.filter(s => s.scanId !== existingScanId);
      }
    }
    
    // Use existing scanId if found, otherwise create new one
    const scanId = existingScanId || `scan-${Date.now()}`;
    const startTime = new Date();
    const scanLogFile = path.join(this.logFilePath, `${scanId}.log`);
    const scanResultsDir = path.join(this.resultsFilePath, scanId);
    fs.mkdirSync(scanResultsDir, { recursive: true });

    // If overwriting, clear old data
    if (existingScanId && this.activeScans[scanId]) {
      delete this.activeScans[scanId];
    }

    this.activeScans[scanId] = {
      scanId,
      targetId,
      targetIp: normalizedTargetIp,
      profile,
      targetData,
      status: 'running',
      progress: 0,
      currentPhase: 'analysis',
      startTime,
      endTime: null,
      duration: null,
      logs: [],
      results: {},
      error: null,
      process: null // To hold child process or Docker exec reference
    };

    const targetName = targetData?.name || targetId;
    const targetImage = targetData?.image || null;
    const targetImageLabel = targetImage || 'N/A';
    this._log(scanId, 'info', 'scan-manager', `Starting scan ${scanId} | Target: ${targetName} (${displayTargetIp}) | Profile: ${profile} | Image: ${targetImageLabel}`);

    let nmapResults = null;
    let detectedServices = { web: [], database: [], ssh: [] };
    let recommendations = [];

    // Async scan execution
    (async () => {
      try {
        if (networkScanEnabled) {
        // Phase 1: AI Analysis (Initial assessment)
        this.activeScans[scanId].currentPhase = 'analysis';
        this.activeScans[scanId].progress = 10;
        this._log(scanId, 'info', 'ai-engine', 'Performing initial AI analysis - assessing target configuration and scan strategy...');
          await new Promise(resolve => setTimeout(resolve, 2000));

        // Phase 2: Reconnaissance (Nmap)
        this.activeScans[scanId].currentPhase = 'reconnaissance';
        this.activeScans[scanId].progress = 30;
        const nmapStartTime = Date.now();
          this._log(scanId, 'info', 'scan-manager', `Starting Nmap network reconnaissance on ${displayTargetIp} using ${profile} profile...`);
          const nmapScanner = new NmapScanner();
          nmapResults = await nmapScanner.scan(normalizedTargetIp, profile, scanId);
        this.activeScans[scanId].results.nmap = nmapResults;
        const nmapDuration = Math.round((Date.now() - nmapStartTime) / 1000);
        
        if (!nmapResults.success) {
          this._log(scanId, 'error', 'scan-manager', `Nmap scan failed after ${nmapDuration}s: ${nmapResults.error || 'Unknown error'}`);
          this._log(scanId, 'warn', 'scan-manager', 'Continuing scan with empty Nmap results - some tools may be skipped');
        } else if (nmapResults.results && nmapResults.results.error) {
          this._log(scanId, 'warn', 'scan-manager', `Nmap scan completed with warnings after ${nmapDuration}s: ${nmapResults.results.error}`);
        } else {
          const portCount = nmapResults.results?.ports?.length || 0;
          const hostCount = nmapResults.results?.hosts?.length || 0;
          const ports = nmapResults.results?.ports?.map(p => `${p.port}/${p.protocol}`).join(', ') || 'none';
          this._log(scanId, 'info', 'scan-manager', `Nmap reconnaissance complete in ${nmapDuration}s | Found ${hostCount} host(s) with ${portCount} open port(s): ${ports}`);
          
          if (nmapResults.results?.ports && nmapResults.results.ports.length > 0) {
            nmapResults.results.ports.forEach(port => {
              const service = port.service || 'unknown';
              const version = port.version ? ` (${port.version})` : '';
              const state = port.state || 'open';
              this._log(scanId, 'info', 'nmap', `Port ${port.port}/${port.protocol} - ${service}${version} [State: ${state}]`);
            });
          }
        }

        // Phase 3: AI Analysis (Post-Nmap, tool selection)
        this.activeScans[scanId].currentPhase = 'vulnerability_scanning';
        this.activeScans[scanId].progress = 60;
        this._log(scanId, 'info', 'ai-engine', 'Analyzing Nmap results and selecting appropriate security tools...');
          const aiAnalyzer = new AIAnalyzer((level, source, message) => this._log(scanId, level, source, message));
        const {
            detectedServices: detected = { web: [], database: [], ssh: [] },
          recommendations: initialRecommendations = []
        } = await aiAnalyzer.analyzeNmapResults(nmapResults, profile);
          detectedServices = detected;
          recommendations = Array.isArray(initialRecommendations)
          ? [...initialRecommendations]
          : [];
        if (targetImage) {
          const hasDockerScout = recommendations.some(rec => rec.tool === 'docker-scout');
          if (!hasDockerScout) {
            recommendations.push({
              tool: 'docker-scout',
              priority: profile === 'deeper' ? 'high' : 'medium',
              reason: 'Container image detected - software supply chain scanning recommended',
              description: `Analyze ${targetImage} with Docker Scout`,
              command: `docker-scout quickview ${targetImage} --format json`
            });
          }
        }
        this.activeScans[scanId].results.aiAnalysis = { detectedServices, recommendations };
        
        if (detectedServices.web && detectedServices.web.length > 0) {
          const webServices = detectedServices.web.map(s => `${s.port}/${s.service}`).join(', ');
          this._log(scanId, 'info', 'ai-engine', `Detected web services on ports: ${webServices}`);
        }
        if (detectedServices.database && detectedServices.database.length > 0) {
          const dbServices = detectedServices.database.map(s => `${s.port}/${s.service}`).join(', ');
          this._log(scanId, 'info', 'ai-engine', `Detected database services on ports: ${dbServices}`);
        }
        if (detectedServices.ssh && detectedServices.ssh.length > 0) {
          const sshServices = detectedServices.ssh.map(s => `${s.port}/${s.service}`).join(', ');
          this._log(scanId, 'info', 'ai-engine', `Detected SSH services on ports: ${sshServices}`);
        }
        
        this._log(scanId, 'info', 'ai-engine', `AI analysis complete - recommended ${recommendations.length} tool(s) for execution`);
        } else {
          this.activeScans[scanId].currentPhase = 'image_scanning';
          this.activeScans[scanId].progress = 40;
          nmapResults = {
            success: false,
            skipped: true,
            error: 'Target IP unavailable - network reconnaissance skipped'
          };
          this.activeScans[scanId].results.nmap = nmapResults;
          this.activeScans[scanId].results.aiAnalysis = { detectedServices, recommendations };
          this._log(scanId, 'warn', 'scan-manager', 'Skipping Nmap and runtime reconnaissance because target IP was not available.');
          this._log(scanId, 'info', 'scan-manager', 'Continuing with image-only scan (Trivy/Docker Scout).');
        }

        // Phase 3.5: Run Trivy FIRST as primary image scanner (before other tools)
        // Docker Scout will only run as fallback if Trivy fails
        let trivyResults = null;
        let trivySucceeded = false;
        try {
          const targetImage = this.activeScans[scanId]?.targetData?.image;
          if (targetImage) {
            this._log(scanId, 'info', 'trivy', `Running Trivy security scan on container image: ${targetImage}...`);
            const TrivyScanner = require('./trivyScanner');
            const trivyScanner = new TrivyScanner(scanId, targetImage);
            trivyResults = await trivyScanner.scanImage();
            trivySucceeded = trivyResults && trivyResults.success === true;
            
            this.activeScans[scanId].results.trivy = trivyResults;
            
            if (trivySucceeded) {
              this._log(scanId, 'info', 'trivy', `Trivy scan completed successfully - using as primary image scanner`);
            } else {
              this._log(scanId, 'warn', 'trivy', `Trivy scan failed: ${trivyResults?.error || 'Unknown error'} - will try Docker Scout as fallback`);
            }
          } else {
            this._log(scanId, 'warn', 'scan-manager', 'No image name available for Trivy scan; skipping.');
          }
        } catch (trivyInitError) {
          this._log(scanId, 'error', 'scan-manager', `Failed to initialize Trivy scan: ${trivyInitError.message}`);
          trivyResults = { success: false, error: trivyInitError.message };
          this.activeScans[scanId].results.trivy = trivyResults;
        }
        
        // Remove Docker Scout from recommendations if Trivy succeeded
        // Only run Docker Scout as fallback if Trivy failed
        if (trivySucceeded) {
          recommendations = recommendations.filter(rec => rec.tool !== 'docker-scout');
          this._log(scanId, 'info', 'scan-manager', 'Trivy succeeded - Docker Scout skipped (using Trivy as primary)');
        } else if (trivyResults && !trivySucceeded) {
          // Trivy failed - ensure Docker Scout is in recommendations as fallback
          const hasDockerScout = recommendations.some(rec => rec.tool === 'docker-scout');
          if (!hasDockerScout) {
            const targetImage = this.activeScans[scanId]?.targetData?.image;
            if (targetImage) {
              recommendations.push({
                tool: 'docker-scout',
                priority: 'high',
                reason: 'Trivy scan failed - using Docker Scout as fallback',
                description: 'Fallback image scanner after Trivy failure',
                command: `docker-scout cves registry://${targetImage}`
              });
              this._log(scanId, 'info', 'scan-manager', 'Trivy failed - added Docker Scout as fallback');
            }
          }
        }

        // Phase 4: Execute recommended tools
        const totalTools = recommendations.length || 1; // Avoid division by zero
        let completedTools = 0;
        
        if (recommendations.length === 0) {
          this._log(scanId, 'info', 'scan-manager', 'No additional tools recommended, proceeding to finalization...');
        }
        
        for (const rec of recommendations) {
          try {
            const toolStartTime = Date.now();
            this._log(scanId, 'info', 'scan-manager', `Executing tool: ${rec.tool.toUpperCase()} | Reason: ${rec.reason || rec.description} | Priority: ${rec.priority || 'medium'}`);
            
            // Execute tool based on type
            let toolResults = null;
            
            switch (rec.tool) {
              case 'gobuster':
                // Gobuster only in deeper profile
                if (profile === 'deeper') {
                  const webScanner = new WebScanner(scanId, targetIp);
                  toolResults = await webScanner.scanDirectories('common.txt', detectedServices.web);
                } else {
                  this._log(scanId, 'warn', 'scan-manager', 'Gobuster skipped - only available in deeper profile');
                  toolResults = { success: false, error: 'Gobuster only available in deeper scan profile' };
                }
                break;
              
              case 'nikto':
              case 'whatweb':
                // Basic web tools - available in both profiles
                const webScanner = new WebScanner(scanId, targetIp);
                if (rec.tool === 'nikto') {
                  toolResults = await webScanner.scanVulnerabilities(detectedServices.web);
                } else if (rec.tool === 'whatweb') {
                  toolResults = await webScanner.detectTechnologies(detectedServices.web);
                }
                break;
              
              case 'sqlmap':
                // SQLMap only in deeper profile
                if (profile === 'deeper') {
                  const dbScanner = new DatabaseScanner(scanId, targetIp);
                  toolResults = await dbScanner.testSQLInjection(null, detectedServices.web);
                } else {
                  this._log(scanId, 'warn', 'scan-manager', 'SQLMap skipped - only available in deeper profile');
                  toolResults = { success: false, error: 'SQLMap only available in deeper scan profile' };
                }
                break;
              
              case 'database-port-scan':
                // Direct database port scanning
                const dbPortScanner = new DatabaseScanner(scanId, targetIp);
                if (detectedServices.database && detectedServices.database.length > 0) {
                  toolResults = await dbPortScanner.scanDirectDatabase(detectedServices.database[0]);
                } else {
                  toolResults = { success: false, error: 'No database service detected' };
                }
                break;
              
              case 'hydra':
                // Hydra only in deeper profile
                if (profile === 'deeper') {
                  const authScanner = new AuthScanner(scanId, targetIp);
                  // Determine service type from detected services
                  if (detectedServices.ssh && detectedServices.ssh.length > 0) {
                    const sshService = detectedServices.ssh[0];
                    toolResults = await authScanner.bruteForce('ssh', { port: sshService.port });
                  } else {
                    this._log(scanId, 'warn', 'scan-manager', 'No SSH service detected for Hydra, skipping...');
                    toolResults = { success: false, error: 'No SSH service detected' };
                  }
                } else {
                  this._log(scanId, 'warn', 'scan-manager', 'Hydra skipped - only available in deeper profile');
                  toolResults = { success: false, error: 'Hydra only available in deeper scan profile' };
                }
                break;
              
              case 'docker-scout':
                {
                  const image = this.activeScans[scanId]?.targetData?.image;
                  if (image) {
                    this._log(scanId, 'info', 'docker-scout', `Scanning container image ${image} for vulnerabilities...`);
                    const dockerScout = new DockerScoutScanner(scanId, image);
                    toolResults = await dockerScout.scanImage();
                  } else {
                    this._log(scanId, 'warn', 'scan-manager', 'Docker Scout skipped - no container image available');
                    toolResults = { success: false, error: 'No container image available for Docker Scout' };
                  }
                }
                break;
              
              default:
                this._log(scanId, 'warn', 'scan-manager', `Unknown tool: ${rec.tool}, skipping...`);
                toolResults = { success: false, error: 'Unknown tool' };
            }
            
            // Store tool results
            if (toolResults) {
              const toolDuration = Math.round((Date.now() - toolStartTime) / 1000);
              this.activeScans[scanId].results[rec.tool] = toolResults;
              
              // Log detailed results based on tool type
              if (toolResults.success) {
                let resultDetails = '';
                if (toolResults.count !== undefined) {
                  resultDetails = ` | Found ${toolResults.count} item(s)`;
                } else if (toolResults.vulnerabilities && Array.isArray(toolResults.vulnerabilities)) {
                  resultDetails = ` | Found ${toolResults.vulnerabilities.length} vulnerability/vulnerabilities`;
                } else if (toolResults.directories && Array.isArray(toolResults.directories)) {
                  resultDetails = ` | Found ${toolResults.directories.length} directory/directories`;
                }
                this._log(scanId, 'info', rec.tool, `${rec.tool.toUpperCase()} completed successfully in ${toolDuration}s${resultDetails}`);
                
                // Log detailed findings based on tool type
                if (rec.tool === 'gobuster' && toolResults.directories && toolResults.directories.length > 0) {
                  const dirsToLog = toolResults.directories.slice(0, 10); // Log first 10 directories
                  const dirList = dirsToLog.map(d => `${d.path} (${d.statusCode})`).join(', ');
                  const moreDirs = toolResults.directories.length > 10 ? ` and ${toolResults.directories.length - 10} more` : '';
                  this._log(scanId, 'info', 'gobuster', `Found directories: ${dirList}${moreDirs}`);
                }
                
                if (rec.tool === 'nikto' && toolResults.vulnerabilities && toolResults.vulnerabilities.length > 0) {
                  const vulnsToLog = toolResults.vulnerabilities.slice(0, 5); // Log first 5 vulnerabilities
                  vulnsToLog.forEach(vuln => {
                    const path = vuln.path || 'N/A';
                    const desc = vuln.description || vuln.osvdb || 'Unknown issue';
                    this._log(scanId, 'warn', 'nikto', `Vulnerability: ${path} - ${desc} [Severity: ${vuln.severity || 'medium'}]`);
                  });
                  if (toolResults.vulnerabilities.length > 5) {
                    this._log(scanId, 'info', 'nikto', `... and ${toolResults.vulnerabilities.length - 5} more vulnerabilities found`);
                  }
                }
                
                if (rec.tool === 'whatweb' && toolResults.technologies && toolResults.technologies.length > 0) {
                  const techList = toolResults.technologies.map(t => `${t.name}${t.version ? ` ${t.version}` : ''}`).join(', ');
                  this._log(scanId, 'info', 'whatweb', `Detected technologies: ${techList}`);
                }
                
                if (rec.tool === 'sqlmap' && toolResults.injections && toolResults.injections.length > 0) {
                  toolResults.injections.forEach(injection => {
                    this._log(scanId, 'error', 'sqlmap', `SQL Injection found: Parameter "${injection.parameter}" - Type: ${injection.type} [Severity: ${injection.severity || 'high'}]`);
                  });
                  if (toolResults.databaseType) {
                    this._log(scanId, 'info', 'sqlmap', `Database type detected: ${toolResults.databaseType}`);
                  }
                }
                
                if (rec.tool === 'database-port-scan' && toolResults.vulnerabilities && toolResults.vulnerabilities.length > 0) {
                  const dbVulnsToLog = toolResults.vulnerabilities.slice(0, 5);
                  dbVulnsToLog.forEach(vuln => {
                    this._log(scanId, 'warn', 'database-scanner', `Database issue: ${vuln.description || vuln.type} [Severity: ${vuln.severity || 'medium'}]`);
                  });
                  if (toolResults.vulnerabilities.length > 5) {
                    this._log(scanId, 'info', 'database-scanner', `... and ${toolResults.vulnerabilities.length - 5} more database issues found`);
                  }
                }
                
                if (rec.tool === 'hydra' && toolResults.successfulLogins && toolResults.successfulLogins.length > 0) {
                  toolResults.successfulLogins.forEach(login => {
                    this._log(scanId, 'error', 'hydra', `Weak credentials found: ${login.service} - ${login.username}:${login.password} on port ${login.port}`);
                  });
                }
                
                if (rec.tool === 'docker-scout' && toolResults.vulnerabilities && toolResults.vulnerabilities.length > 0) {
                  const scoutVulns = toolResults.vulnerabilities;
                  const criticalScout = scoutVulns.filter(v => v.severity === 'critical');
                  const highScout = scoutVulns.filter(v => v.severity === 'high');
                  
                  if (criticalScout.length > 0) {
                    criticalScout.slice(0, 3).forEach(vuln => {
                      this._log(scanId, 'error', 'docker-scout', `CRITICAL: ${vuln.package || 'N/A'} ${vuln.version || ''} - ${vuln.cve || 'Unknown CVE'} - ${vuln.description || 'No description'}`);
                    });
                    if (criticalScout.length > 3) {
                      this._log(scanId, 'error', 'docker-scout', `... and ${criticalScout.length - 3} more critical vulnerabilities`);
                    }
                  }
                  
                  if (highScout.length > 0 && criticalScout.length === 0) {
                    highScout.slice(0, 3).forEach(vuln => {
                      this._log(scanId, 'warn', 'docker-scout', `HIGH: ${vuln.package || 'N/A'} ${vuln.version || ''} - ${vuln.cve || 'Unknown CVE'} - ${vuln.description || 'No description'}`);
                    });
                    if (highScout.length > 3) {
                      this._log(scanId, 'warn', 'docker-scout', `... and ${highScout.length - 3} more high severity vulnerabilities`);
                    }
                  }
                }
                
              } else {
                this._log(scanId, 'warn', rec.tool, `${rec.tool.toUpperCase()} completed with issues after ${toolDuration}s: ${toolResults.error || 'No results'}`);
              }
            }
            
            completedTools++;
            // Update progress: 60% (AI analysis) + 30% (tools) = 90% max
            this.activeScans[scanId].progress = 60 + Math.floor((completedTools / totalTools) * 30);
            
          } catch (toolError) {
            const toolDuration = Math.round((Date.now() - toolStartTime) / 1000);
            this._log(scanId, 'error', rec.tool, `${rec.tool.toUpperCase()} failed after ${toolDuration}s: ${toolError.message} | Stack: ${toolError.stack?.split('\n')[0] || 'N/A'}`);
            this.activeScans[scanId].results[rec.tool] = {
              success: false,
              error: toolError.message
            };
            // Continue with next tool even if one fails
            completedTools++;
            this.activeScans[scanId].progress = 60 + Math.floor((completedTools / totalTools) * 30);
          }
        }

        // Trivy already completed above (runs first, before other tools)
        // Log Trivy results if available (already logged above, but keep for consistency)
        if (trivyResults) {
          const trivyVulnCount = trivyResults.vulnerabilities?.length || 0;
          const trivyExitCode = trivyResults.exitCode !== undefined ? trivyResults.exitCode : 'N/A';
          
          // Log detailed Trivy findings if available
          if (trivyResults.vulnerabilities && trivyResults.vulnerabilities.length > 0) {
            const criticalVulns = trivyResults.vulnerabilities.filter(v => v.severity === 'critical');
            const highVulns = trivyResults.vulnerabilities.filter(v => v.severity === 'high');
            
            if (criticalVulns.length > 0) {
              criticalVulns.slice(0, 3).forEach(vuln => {
                this._log(scanId, 'error', 'trivy', `CRITICAL: ${vuln.package || 'N/A'} ${vuln.version || ''} - ${vuln.cve || vuln.id || 'Unknown CVE'} - ${vuln.description || 'No description'}`);
              });
              if (criticalVulns.length > 3) {
                this._log(scanId, 'error', 'trivy', `... and ${criticalVulns.length - 3} more critical vulnerabilities`);
              }
            }
            
            if (highVulns.length > 0 && criticalVulns.length === 0) {
              highVulns.slice(0, 3).forEach(vuln => {
                this._log(scanId, 'warn', 'trivy', `HIGH: ${vuln.package || 'N/A'} ${vuln.version || ''} - ${vuln.cve || vuln.id || 'Unknown CVE'} - ${vuln.description || 'No description'}`);
              });
              if (highVulns.length > 3) {
                this._log(scanId, 'warn', 'trivy', `... and ${highVulns.length - 3} more high severity vulnerabilities`);
              }
            }
          }
        }

        const dockerScoutResults = this.activeScans[scanId].results['docker-scout'];
        const imageScannerFailed =
          (!this.activeScans[scanId].results.trivy || !this.activeScans[scanId].results.trivy.success) &&
          (!dockerScoutResults || !dockerScoutResults.success);
        if (imageScannerFailed) {
          const warningMessage = 'Image scanners were unable to complete. Results may be incomplete.';
          this.activeScans[scanId].results.imageScannerWarning = warningMessage;
          if (!this.activeScans[scanId].error) {
            this.activeScans[scanId].error = warningMessage;
          }
          this._log(scanId, 'error', 'scan-manager', warningMessage);
        }

        // Finalizing: Aggregate results
        this.activeScans[scanId].currentPhase = 'finalizing';
        this.activeScans[scanId].progress = 90;
        this._log(scanId, 'info', 'scan-manager', 'Aggregating scan results from all tools and generating final report...');
        
        // Aggregate all results
        const aggregator = new ResultAggregator();
        const aggregatedResults = aggregator.aggregateResults(this.activeScans[scanId].results, profile);
        this.activeScans[scanId].results.aggregated = aggregatedResults;
        
        // Store allPackages at the top level of results for easy access
        if (aggregatedResults.allPackages) {
          this.activeScans[scanId].results.allPackages = aggregatedResults.allPackages;
        }
        
        // Extract and store runtime context separately for RAG/LLM
        const runtimeContext = aggregator.extractRuntimeContext(this.activeScans[scanId].results);
        this.activeScans[scanId].results.runtimeContext = runtimeContext;
        
        // Separate image scanner results from runtime scanner results
        this.activeScans[scanId].results.imageScannerResults = {
          trivy: this.activeScans[scanId].results.trivy,
          'docker-scout': this.activeScans[scanId].results['docker-scout'],
          allPackages: aggregatedResults.allPackages || [],
          warning: this.activeScans[scanId].results.imageScannerWarning || null
        };
        
        this.activeScans[scanId].results.runtimeScannerResults = {
          nmap: this.activeScans[scanId].results.nmap,
          nikto: this.activeScans[scanId].results.nikto,
          gobuster: this.activeScans[scanId].results.gobuster,
          sqlmap: this.activeScans[scanId].results.sqlmap,
          hydra: this.activeScans[scanId].results.hydra,
          'database-port-scan': this.activeScans[scanId].results['database-port-scan'],
          whatweb: this.activeScans[scanId].results.whatweb,
          runtimeContext: runtimeContext
        };
        
        // Generate report
        const report = aggregator.formatReport(aggregatedResults);
        
        // Log detailed summary
        const riskLevel = aggregatedResults.summary.riskLevel;
        const totalVulns = aggregatedResults.summary.totalVulnerabilities;
        const criticalVulns = aggregatedResults.vulnerabilities?.filter(v => v.severity === 'critical').length || 0;
        const highVulns = aggregatedResults.vulnerabilities?.filter(v => v.severity === 'high').length || 0;
        const mediumVulns = aggregatedResults.vulnerabilities?.filter(v => v.severity === 'medium').length || 0;
        const lowVulns = aggregatedResults.vulnerabilities?.filter(v => v.severity === 'low').length || 0;
        
        this._log(scanId, 'info', 'scan-manager', `Risk Assessment: ${aggregatedResults.riskScore}/100 (${riskLevel}) | Total Vulnerabilities: ${totalVulns}`);
        if (totalVulns > 0) {
          this._log(scanId, 'warn', 'scan-manager', `Vulnerability Breakdown: Critical: ${criticalVulns} | High: ${highVulns} | Medium: ${mediumVulns} | Low: ${lowVulns}`);
          
          // Log ALL aggregated vulnerabilities individually
          this._log(scanId, 'info', 'aggregator', 'Logging all discovered vulnerabilities...');
          
          // Group by severity for better organization
          const bySeverity = {
            critical: aggregatedResults.vulnerabilities.filter(v => v.severity === 'critical'),
            high: aggregatedResults.vulnerabilities.filter(v => v.severity === 'high'),
            medium: aggregatedResults.vulnerabilities.filter(v => v.severity === 'medium'),
            low: aggregatedResults.vulnerabilities.filter(v => v.severity === 'low')
          };
          
          // Log critical vulnerabilities (ALL of them)
          if (bySeverity.critical.length > 0) {
            this._log(scanId, 'error', 'aggregator', `=== CRITICAL VULNERABILITIES (${bySeverity.critical.length}) ===`);
            bySeverity.critical.forEach((vuln, idx) => {
              let message = `${idx + 1}. [${vuln.source || 'unknown'}] ${vuln.type || 'vulnerability'}: `;
              if (vuln.cve) message += `${vuln.cve} - `;
              message += vuln.description || 'No description';
              if (vuln.package) message += ` | Package: ${vuln.package}${vuln.version ? ` ${vuln.version}` : ''}`;
              if (vuln.port) message += ` | Port: ${vuln.port}`;
              if (vuln.path) message += ` | Path: ${vuln.path}`;
              if (vuln.parameter) message += ` | Parameter: ${vuln.parameter}`;
              if (vuln.service) message += ` | Service: ${vuln.service}`;
              if (vuln.username) message += ` | Username: ${vuln.username}`;
              this._log(scanId, 'error', vuln.source || 'aggregator', message);
            });
          }
          
          // Log high vulnerabilities (ALL of them)
          if (bySeverity.high.length > 0) {
            this._log(scanId, 'warn', 'aggregator', `=== HIGH SEVERITY VULNERABILITIES (${bySeverity.high.length}) ===`);
            bySeverity.high.forEach((vuln, idx) => {
              let message = `${idx + 1}. [${vuln.source || 'unknown'}] ${vuln.type || 'vulnerability'}: `;
              if (vuln.cve) message += `${vuln.cve} - `;
              message += vuln.description || 'No description';
              if (vuln.package) message += ` | Package: ${vuln.package}${vuln.version ? ` ${vuln.version}` : ''}`;
              if (vuln.port) message += ` | Port: ${vuln.port}`;
              if (vuln.path) message += ` | Path: ${vuln.path}`;
              if (vuln.parameter) message += ` | Parameter: ${vuln.parameter}`;
              if (vuln.service) message += ` | Service: ${vuln.service}`;
              this._log(scanId, 'warn', vuln.source || 'aggregator', message);
            });
          }
          
          // Log medium vulnerabilities (limit to first 30 to avoid excessive log spam)
          if (bySeverity.medium.length > 0) {
            const mediumToLog = bySeverity.medium.slice(0, 30);
            this._log(scanId, 'info', 'aggregator', `=== MEDIUM SEVERITY VULNERABILITIES (${bySeverity.medium.length} total, showing first ${mediumToLog.length}) ===`);
            mediumToLog.forEach((vuln, idx) => {
              let message = `${idx + 1}. [${vuln.source || 'unknown'}] ${vuln.type || 'vulnerability'}: `;
              if (vuln.cve) message += `${vuln.cve} - `;
              message += vuln.description || 'No description';
              if (vuln.package) message += ` | Package: ${vuln.package}${vuln.version ? ` ${vuln.version}` : ''}`;
              if (vuln.port) message += ` | Port: ${vuln.port}`;
              if (vuln.path) message += ` | Path: ${vuln.path}`;
              this._log(scanId, 'info', vuln.source || 'aggregator', message);
            });
            if (bySeverity.medium.length > 30) {
              this._log(scanId, 'info', 'aggregator', `... and ${bySeverity.medium.length - 30} more medium severity vulnerabilities (see full report for details)`);
            }
          }
          
          // Log low vulnerabilities (limit to first 20 to avoid excessive log spam)
          if (bySeverity.low.length > 0) {
            const lowToLog = bySeverity.low.slice(0, 20);
            this._log(scanId, 'info', 'aggregator', `=== LOW SEVERITY VULNERABILITIES (${bySeverity.low.length} total, showing first ${lowToLog.length}) ===`);
            lowToLog.forEach((vuln, idx) => {
              let message = `${idx + 1}. [${vuln.source || 'unknown'}] ${vuln.type || 'vulnerability'}: `;
              if (vuln.cve) message += `${vuln.cve} - `;
              message += vuln.description || 'No description';
              if (vuln.package) message += ` | Package: ${vuln.package}${vuln.version ? ` ${vuln.version}` : ''}`;
              if (vuln.port) message += ` | Port: ${vuln.port}`;
              this._log(scanId, 'info', vuln.source || 'aggregator', message);
            });
            if (bySeverity.low.length > 20) {
              this._log(scanId, 'info', 'aggregator', `... and ${bySeverity.low.length - 20} more low severity vulnerabilities (see full report for details)`);
            }
          }
        }
        
        // Check if critical tools failed
        const trivyFailed = !this.activeScans[scanId].results.trivy || !this.activeScans[scanId].results.trivy.success;
        const nmapResult = this.activeScans[scanId].results.nmap;
        const nmapFailed = !nmapResult || !nmapResult.success;
        const nmapSkipped = !!nmapResult?.skipped;
        const hasFailures = trivyFailed || (nmapFailed && !nmapSkipped);
        
        this.activeScans[scanId].status = hasFailures ? 'completed_with_errors' : 'completed';
        this.activeScans[scanId].progress = 100;
        this.activeScans[scanId].endTime = new Date();
        this.activeScans[scanId].duration = this.activeScans[scanId].endTime.getTime() - startTime.getTime();
        const totalDuration = Math.round(this.activeScans[scanId].duration / 1000);
        
        if (hasFailures) {
          const failures = [];
          if (trivyFailed) failures.push('Trivy');
          if (nmapFailed) failures.push('Nmap');
          this._log(scanId, 'warn', 'scan-manager', `Scan ${scanId} completed with errors in ${totalDuration}s | Failed tools: ${failures.join(', ')} | Target: ${targetName} (${displayTargetIp}) | Profile: ${profile}`);
        } else {
          this._log(scanId, 'success', 'scan-manager', `Scan ${scanId} completed successfully in ${totalDuration}s | Target: ${targetName} (${displayTargetIp}) | Profile: ${profile}`);
        }
        
        this._addToHistory(this.activeScans[scanId]);
      } catch (error) {
        // Check if scan still exists (might have been stopped/deleted)
        if (this.activeScans[scanId]) {
          this.activeScans[scanId].status = 'error';
          this.activeScans[scanId].error = error.message;
          this.activeScans[scanId].endTime = new Date();
          this.activeScans[scanId].duration = this.activeScans[scanId].endTime.getTime() - startTime.getTime();
          const errorDuration = Math.round((this.activeScans[scanId].endTime.getTime() - startTime.getTime()) / 1000);
          this._log(scanId, 'error', 'scan-manager', `Scan ${scanId} failed after ${errorDuration}s: ${error.message} | Target: ${targetName} (${displayTargetIp})`);
          
          this._addToHistory(this.activeScans[scanId]);
        } else {
          // Scan was already removed, just log the error
          console.error(`[${scanId}] Scan error but scan was already removed:`, error.message);
        }
      } finally {
        // Clean up if necessary
      }
    })();

    return { scanId: scanId, status: this.activeScans[scanId].status };
  }

  getScanStatus(scanId) {
    // Check active scans first
    if (this.activeScans[scanId]) {
      return this.activeScans[scanId];
    }
    // If not in active scans, check scan history
    return this.scanHistory.find(scan => scan.scanId === scanId) || null;
  }

  getScanLogs(scanId) {
    return this.activeScans[scanId] ? this.activeScans[scanId].logs : [];
  }

  pauseScan(scanId) {
    if (this.activeScans[scanId] && this.activeScans[scanId].status === 'running') {
      this.activeScans[scanId].status = 'paused';
      this._log(scanId, 'info', 'scan-manager', 'Scan paused.');
      // In a real scenario, you would send a signal to pause the running process
      return true;
    }
    return false;
  }

  resumeScan(scanId) {
    if (this.activeScans[scanId] && this.activeScans[scanId].status === 'paused') {
      this.activeScans[scanId].status = 'running';
      this._log(scanId, 'info', 'scan-manager', 'Scan resumed.');
      // In a real scenario, you would send a signal to resume the paused process
      return true;
    }
    return false;
  }

  stopScan(scanId) {
    if (this.activeScans[scanId]) {
      this.activeScans[scanId].status = 'stopped';
      this.activeScans[scanId].endTime = new Date();
      this.activeScans[scanId].duration = this.activeScans[scanId].endTime.getTime() - this.activeScans[scanId].startTime.getTime();
      this._log(scanId, 'warn', 'scan-manager', 'Scan stopped by user.');
      // In a real scenario, you would terminate the running process
      
      this._addToHistory(this.activeScans[scanId]);
      
      delete this.activeScans[scanId];
      return true;
    }
    return false;
  }

  getActiveScans() {
    return Object.values(this.activeScans);
  }

  getScanHistory(limit = 15) {
    // Already limited to 15 in push operations, but return last N if requested
    return this.scanHistory.slice(-limit);
  }

  /**
   * Get the latest scan entry for a specific target ID.
   * Prefers completed scans with aggregated results, but will fall back to active scans.
   * @param {string} targetId
   * @returns {Object|null}
   */
  getLatestScanForTarget(targetId) {
    if (!targetId) return null;

    const historyMatch = [...this.scanHistory]
      .reverse()
      .find(scan => scan.targetId === targetId && scan.results && Object.keys(scan.results).length > 0);

    if (historyMatch) {
      return historyMatch;
    }

    const activeMatch = Object.values(this.activeScans || {}).find(scan => scan.targetId === targetId);
    return activeMatch || null;
  }

  _loadPersistedHistory() {
    try {
      if (fs.existsSync(this.historyStorePath)) {
        const raw = fs.readFileSync(this.historyStorePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.scanHistory = parsed.slice(-15);
          console.log(`[scan-manager] Restored ${this.scanHistory.length} completed scan(s) from disk`);
        }
      }
    } catch (error) {
      console.warn('[scan-manager] Failed to load persisted history:', error.message);
      this.scanHistory = [];
    }
  }

  _persistHistory() {
    try {
      fs.writeFileSync(this.historyStorePath, JSON.stringify(this.scanHistory, null, 2));
    } catch (error) {
      console.warn('[scan-manager] Failed to persist history:', error.message);
    }
  }

  _addToHistory(scan) {
    if (!scan) return;
    const sanitized = { ...scan };
    delete sanitized.process;
    this.scanHistory.push(sanitized);
    if (this.scanHistory.length > 15) {
      const removed = this.scanHistory.shift();
      console.log(`[scan-manager] Removed oldest scan from history: ${removed?.scanId} (keeping last 15 scans)`);
    }
    this._persistHistory();
  }
}

module.exports = ScanManager;

