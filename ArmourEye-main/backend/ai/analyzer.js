/**
 * AI Decision Engine for ArmourEye
 * 
 * This module provides rule-based decision making for security scans
 * with hooks for future AI model integration (both custom team models and external LLMs)
 */

class AIAnalyzer {
  constructor() {
    this.customModel = null; // Will be loaded when team's AI model is ready
    this.llmIntegration = null; // Will be loaded for external LLM integration
    this.ruleEngine = new RuleBasedEngine();
  }

  /**
   * Main analysis method - decides what tools to run based on target information
   * @param {Object} targetData - Target information (IP, ports, services, etc.)
   * @param {string} scanProfile - Scan profile (quick, standard, deep)
   * @returns {Promise<Object>} Analysis results and tool recommendations
   */
  async analyze(targetData, scanProfile = 'misconfigs') {
    try {
      console.log(`AI Analyzer: Analyzing target ${targetData.ip} with profile ${scanProfile}`);
      
      // Start with rule-based analysis
      const ruleBasedAnalysis = this.ruleEngine.analyze(targetData, scanProfile);
      
      // TODO: Integrate team's custom AI model when ready
      // const customAnalysis = await this.analyzeWithCustomModel(targetData);
      
      // TODO: Integrate external LLM for advanced reasoning when needed
      // const llmAnalysis = await this.analyzeWithLLM(targetData, ruleBasedAnalysis);
      
      // Combine results (for now, just use rule-based)
      const finalAnalysis = {
        ...ruleBasedAnalysis,
        aiModel: 'rule-based', // Will change to 'custom' or 'llm' when integrated
        confidence: 0.8, // Rule-based confidence
        recommendations: this.generateRecommendations(ruleBasedAnalysis, scanProfile)
      };

      console.log('AI Analysis complete:', finalAnalysis);
      return finalAnalysis;
    } catch (error) {
      console.error('AI Analysis error:', error);
      return {
        error: error.message,
        fallback: true,
        recommendations: this.getFallbackRecommendations(scanProfile)
      };
    }
  }

  /**
   * Generate actionable recommendations based on analysis
   * @param {Object} analysis - Analysis results
   * @returns {Array} List of recommended actions
   */
  generateRecommendations(analysis, scanProfile = 'misconfigs') {
    const recommendations = [];
    
    if (analysis.webServices.length > 0) {
      // Always recommend basic web tools
      recommendations.push({
        tool: 'nikto',
        priority: 'medium',
        reason: 'Web services detected - vulnerability scanning recommended',
        description: 'Web vulnerability scanning recommended',
        command: `nikto -h http://${analysis.target.ip}`
      });
      
      recommendations.push({
        tool: 'whatweb',
        priority: 'low',
        reason: 'Web services detected - technology detection recommended',
        description: 'Technology detection recommended',
        command: `whatweb http://${analysis.target.ip}`
      });
      
      // Only recommend aggressive tools in deeper profile
      if (scanProfile === 'deeper') {
        recommendations.push({
          tool: 'gobuster',
          priority: 'high',
          reason: 'Web services detected - directory enumeration recommended',
          description: 'Directory enumeration recommended',
          command: `gobuster dir -u http://${analysis.target.ip} -w /usr/share/wordlists/dirb/common.txt`
        });
      }
    }

    if (analysis.databaseServices.length > 0) {
      // Only recommend SQLMap in deeper profile
      if (scanProfile === 'deeper') {
        recommendations.push({
          tool: 'sqlmap',
          priority: 'high',
          reason: 'Database services detected - SQL injection testing recommended',
          description: 'SQL injection testing recommended',
          command: `sqlmap -u http://${analysis.target.ip} --batch`
        });
      }
      
      // Always recommend direct database port scanning
      recommendations.push({
        tool: 'database-port-scan',
        priority: 'medium',
        reason: 'Database services detected - direct port scanning recommended',
        description: 'Direct database port vulnerability scanning',
        command: `nmap --script mysql-vuln*,postgres-* -p ${analysis.databaseServices.map(s => s.port).join(',')} ${analysis.target.ip}`
      });
    }

    if (analysis.sshServices.length > 0 && scanProfile === 'deeper') {
      recommendations.push({
        tool: 'hydra',
        priority: 'medium',
        reason: 'SSH service detected - brute force testing recommended',
        description: 'Brute force testing recommended',
        command: `hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://${analysis.target.ip}`
      });
    }

    return recommendations;
  }

  /**
   * Fallback recommendations when analysis fails
   * @param {string} scanProfile - Scan profile
   * @returns {Array} Basic recommendations
   */
  getFallbackRecommendations(scanProfile) {
    return [];
  }

  /**
   * TODO: Integrate team's custom AI model
   * This method will be implemented when the team's AI model is ready
   * @param {Object} targetData - Target information
   * @returns {Promise<Object>} Custom model analysis
   */
  async analyzeWithCustomModel(targetData) {
    // TODO: Load and use team's custom AI model
    // Example integration:
    // if (this.customModel) {
    //   return await this.customModel.analyze(targetData);
    // }
    return null;
  }

  /**
   * TODO: Integrate external LLM for advanced reasoning
   * This method will be implemented for LLM integration
   * @param {Object} targetData - Target information
   * @param {Object} ruleBasedAnalysis - Rule-based analysis results
   * @returns {Promise<Object>} LLM analysis
   */
  async analyzeWithLLM(targetData, ruleBasedAnalysis) {
    // TODO: Integrate external LLM (OpenAI, Claude, etc.)
    // Example integration:
    // if (this.llmIntegration) {
    //   return await this.llmIntegration.analyze(targetData, ruleBasedAnalysis);
    // }
    return null;
  }

  /**
   * Load custom AI model (to be called when team's model is ready)
   * @param {Object} model - Custom AI model instance
   */
  loadCustomModel(model) {
    this.customModel = model;
    console.log('Custom AI model loaded');
  }

  /**
   * Load LLM integration (to be called when LLM integration is needed)
   * @param {Object} llm - LLM integration instance
   */
  loadLLMIntegration(llm) {
    this.llmIntegration = llm;
    console.log('LLM integration loaded');
  }

  /**
   * Analyze Nmap scan results and generate recommendations
   * @param {Object} nmapResults - Nmap scan results object
   * @param {string} scanProfile - Scan profile (misconfigs/deeper)
   * @returns {Promise<Object>} Analysis with detected services and recommendations
   */
  async analyzeNmapResults(nmapResults, scanProfile = 'misconfigs') {
    try {
      // Extract target information from Nmap results
      const hosts = nmapResults.results?.hosts || [];
      const ports = nmapResults.results?.ports || [];
      
      // Get first host (primary target)
      const host = hosts.length > 0 ? hosts[0] : { ip: 'unknown', hostname: null };
      
      // Convert Nmap results format to targetData format expected by analyze()
      const targetData = {
        ip: host.ip || 'unknown',
        hostname: host.hostname || null,
        ports: ports.map(port => ({
          number: port.number,
          protocol: port.protocol || 'tcp',
          state: port.state,
          service: port.service,
          version: port.version,
          product: port.product,
          extraInfo: port.extraInfo
        }))
      };

      // Use existing analyze method with converted data
      const analysis = await this.analyze(targetData, scanProfile);
      
      // Extract detected services in the format expected by scanManager
      const detectedServices = {
        web: analysis.webServices || [],
        database: analysis.databaseServices || [],
        ssh: analysis.sshServices || [],
        other: analysis.otherServices || []
      };

      // Get recommendations with scan profile context
      const recommendations = this.generateRecommendations(analysis, scanProfile);

      return {
        detectedServices,
        recommendations
      };
    } catch (error) {
      console.error('Error analyzing Nmap results:', error);
      // Return fallback structure
      return {
        detectedServices: {
          web: [],
          database: [],
          ssh: [],
          other: []
        },
        recommendations: this.getFallbackRecommendations('misconfigs')
      };
    }
  }
}

/**
 * Rule-based decision engine
 * Implements basic security scanning logic based on common patterns
 */
class RuleBasedEngine {
  /**
   * Analyze target using rule-based logic
   * @param {Object} targetData - Target information
   * @param {string} scanProfile - Scan profile
   * @returns {Object} Analysis results
   */
  analyze(targetData, scanProfile) {
    const analysis = {
      target: {
        ip: targetData.ip,
        hostname: targetData.hostname || null
      },
      webServices: [],
      databaseServices: [],
      sshServices: [],
      otherServices: [],
      riskLevel: 'low',
      scanStrategy: {
        phases: [],
        estimatedDuration: 0,
        tools: []
      }
    };

    // Analyze ports and services
    if (targetData.ports && Array.isArray(targetData.ports)) {
      targetData.ports.forEach(port => {
        this.analyzePort(port, analysis);
      });
    }

    // Determine overall risk level
    analysis.riskLevel = this.calculateRiskLevel(analysis);
    
    // Generate scan strategy
    analysis.scanStrategy = this.determineScanStrategy(analysis, scanProfile);

    return analysis;
  }

  /**
   * Analyze individual port
   * @param {Object} port - Port information
   * @param {Object} analysis - Analysis object to update
   */
  analyzePort(port, analysis) {
    const portNum = parseInt(port.number || port);
    const service = (port.service || '').toLowerCase();
    const product = (port.product || '').toLowerCase();

    // Web services
    const additionalWebPorts = [3000, 3001, 3002, 5000, 7000, 8000, 8008, 8888, 9000, 9080];

    if (portNum === 80 || portNum === 443 || portNum === 8080 || portNum === 8443 ||
        additionalWebPorts.includes(portNum) ||
        service.includes('http') || service.includes('apache') || service.includes('nginx')) {
      analysis.webServices.push({
        port: portNum,
        service: port.service,
        product: port.product,
        version: port.version,
        risk: this.assessWebRisk(port)
      });
    }

    // Database services
    if (portNum === 3306 || portNum === 5432 || portNum === 1433 || portNum === 27017 ||
        service.includes('mysql') || service.includes('postgres') || service.includes('mssql') || service.includes('mongodb')) {
      analysis.databaseServices.push({
        port: portNum,
        service: port.service,
        product: port.product,
        version: port.version,
        risk: this.assessDatabaseRisk(port)
      });
    }

    // SSH services
    if (portNum === 22 || service.includes('ssh')) {
      analysis.sshServices.push({
        port: portNum,
        service: port.service,
        product: port.product,
        version: port.version,
        risk: this.assessSSHRisk(port)
      });
    }

    // Other services
    if (!analysis.webServices.some(s => s.port === portNum) &&
        !analysis.databaseServices.some(s => s.port === portNum) &&
        !analysis.sshServices.some(s => s.port === portNum)) {
      analysis.otherServices.push({
        port: portNum,
        service: port.service,
        product: port.product,
        version: port.version
      });
    }
  }

  /**
   * Assess risk level for web services
   * @param {Object} port - Port information
   * @returns {string} Risk level
   */
  assessWebRisk(port) {
    let risk = 'low';
    
    // Check for outdated versions
    if (port.version && port.version.includes('2.2')) {
      risk = 'high';
    } else if (port.version && (port.version.includes('2.4') || port.version.includes('1.1'))) {
      risk = 'medium';
    }

    // Check for development servers
    if (port.product && port.product.includes('dev')) {
      risk = 'high';
    }

    return risk;
  }

  /**
   * Assess risk level for database services
   * @param {Object} port - Port information
   * @returns {string} Risk level
   */
  assessDatabaseRisk(port) {
    let risk = 'high'; // Databases are generally high risk if exposed
    
    // Check for default ports
    if (port.number === 3306 || port.number === 5432) {
      risk = 'critical';
    }

    return risk;
  }

  /**
   * Assess risk level for SSH services
   * @param {Object} port - Port information
   * @returns {string} Risk level
   */
  assessSSHRisk(port) {
    let risk = 'medium';
    
    // Check for outdated SSH versions
    if (port.version && port.version.includes('7.4')) {
      risk = 'high';
    }

    return risk;
  }

  /**
   * Calculate overall risk level
   * @param {Object} analysis - Analysis results
   * @returns {string} Overall risk level
   */
  calculateRiskLevel(analysis) {
    const risks = [];
    
    analysis.webServices.forEach(service => risks.push(service.risk));
    analysis.databaseServices.forEach(service => risks.push(service.risk));
    analysis.sshServices.forEach(service => risks.push(service.risk));

    if (risks.includes('critical')) return 'critical';
    if (risks.includes('high')) return 'high';
    if (risks.includes('medium')) return 'medium';
    return 'low';
  }

  /**
   * Determine scan strategy based on analysis
   * @param {Object} analysis - Analysis results
   * @param {string} scanProfile - Scan profile
   * @returns {Object} Scan strategy
   */
  determineScanStrategy(analysis, scanProfile) {
    const strategy = {
      phases: [],
      estimatedDuration: 0,
      tools: []
    };

    // Phase 1: Reconnaissance (always included)
    strategy.phases.push({
      name: 'reconnaissance',
      tools: ['nmap'],
      duration: scanProfile === 'misconfigs' ? 5 : 20
    });

    // Phase 2: Web application testing
    if (analysis.webServices.length > 0) {
      strategy.phases.push({
        name: 'web_enumeration',
        tools: scanProfile === 'misconfigs' ? ['nikto', 'whatweb'] : ['gobuster', 'nikto', 'whatweb'],
        duration: scanProfile === 'misconfigs' ? 10 : 40
      });
    }

    // Phase 3: Database testing
    if (analysis.databaseServices.length > 0) {
      strategy.phases.push({
        name: 'database_testing',
        tools: scanProfile === 'misconfigs' ? [] : ['sqlmap'],
        duration: scanProfile === 'misconfigs' ? 0 : 60
      });
    }

    // Phase 4: Authentication testing
    if (analysis.sshServices.length > 0) {
      strategy.phases.push({
        name: 'auth_testing',
        tools: scanProfile === 'misconfigs' ? [] : ['hydra'],
        duration: scanProfile === 'misconfigs' ? 0 : 40
      });
    }

    // Calculate total duration
    strategy.estimatedDuration = strategy.phases.reduce((total, phase) => total + phase.duration, 0);
    
    // Collect all tools
    strategy.tools = [...new Set(strategy.phases.flatMap(phase => phase.tools))];

    return strategy;
  }
}

module.exports = AIAnalyzer;

