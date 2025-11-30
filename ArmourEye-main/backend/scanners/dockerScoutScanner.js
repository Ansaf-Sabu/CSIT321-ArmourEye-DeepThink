const ToolExecutor = require('./toolExecutor');

/**
 * Docker Scout Scanner
 * Executes Docker Scout CLI inside the scanner container to analyze container images.
 */
class DockerScoutScanner {
  constructor(scanId, imageName) {
    this.scanId = scanId;
    this.imageName = imageName;
    this.executor = new ToolExecutor(scanId, null);
  }

  mapSeverity(level) {
    if (!level) return 'medium';
    const normalized = String(level).toLowerCase();
    if (['critical', 'crit'].includes(normalized)) return 'critical';
    if (['high', 'h'].includes(normalized)) return 'high';
    if (['medium', 'med', 'm'].includes(normalized)) return 'medium';
    if (['low', 'l'].includes(normalized)) return 'low';
    return 'medium';
  }

  collectGenericFindings(parsed) {
    const findings = [];

    const addFinding = (finding = {}, fallbackPackage) => {
      const severity = this.mapSeverity(
        finding.severity ||
        finding.priority ||
        finding.level ||
        finding.score?.severity
      );

      const description =
        finding.title ||
        finding.description ||
        finding.message ||
        `Docker Scout reported ${finding.cve || finding.id || 'a vulnerability'}`;

      findings.push({
        source: 'docker-scout',
        type: 'package_vulnerability',
        severity,
        description,
        cve: finding.cve || finding.id || null,
        package: finding.package?.name || finding.package || finding.component || fallbackPackage || null,
        version: finding.package?.version || finding.currentVersion || finding.version || null,
        fixedVersion: finding.fixVersion || finding.fixedVersion || finding.remediation || null,
        cvss: finding.cvss || finding.score || {},
        locations: finding.locations || finding.path || null
      });
    };

    const inspectEntry = (entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }

      if (Array.isArray(entry)) {
        entry.forEach(item => inspectEntry(item));
        return;
      }

      if (Array.isArray(entry.vulnerabilities)) {
        entry.vulnerabilities.forEach(v => addFinding(v, entry.package || entry.name));
      }

      if (entry.packages && typeof entry.packages === 'object') {
        Object.values(entry.packages).forEach(pkg => {
          if (Array.isArray(pkg.vulnerabilities)) {
            pkg.vulnerabilities.forEach(v => addFinding(v, pkg.name || pkg.package || pkg.id));
          }
        });
      }

      if (Array.isArray(entry.findings)) {
        entry.findings.forEach(f => addFinding(f, entry.package || entry.name));
      }

      if (Array.isArray(entry.issues)) {
        entry.issues.forEach(issue => addFinding(issue, entry.package || entry.name));
      }

      // Some outputs nest inside "results" or "data"
      if (Array.isArray(entry.results)) {
        entry.results.forEach(result => inspectEntry(result));
      }
      if (Array.isArray(entry.data)) {
        entry.data.forEach(result => inspectEntry(result));
      }
      if (entry.summary && Array.isArray(entry.summary.vulnerabilities)) {
        entry.summary.vulnerabilities.forEach(v => addFinding(v));
      }
    };

    inspectEntry(parsed);
    return findings;
  }

  collectSarifFindings(parsed) {
    const findings = [];
    if (!parsed || !Array.isArray(parsed.runs)) {
      return findings;
    }

    parsed.runs.forEach(run => {
      const ruleMap = {};
      if (run.tool?.driver?.rules) {
        run.tool.driver.rules.forEach(rule => {
          if (rule && rule.id) {
            ruleMap[rule.id] = rule;
          }
        });
      }

      if (Array.isArray(run.results)) {
        run.results.forEach(result => {
          const rule = result.ruleId ? ruleMap[result.ruleId] : null;
          const properties = result.properties || {};

          findings.push({
            source: 'docker-scout',
            type: 'package_vulnerability',
            severity: this.mapSeverity(result.level || properties.severity || rule?.properties?.severity),
            description: result.message?.text || rule?.shortDescription?.text || 'Docker Scout reported a vulnerability',
            cve: properties.cve || result.ruleId || rule?.id || null,
            package: properties.package || rule?.properties?.package || null,
            version: properties.version || null,
            fixedVersion: properties.fixVersion || properties.fix_version || rule?.properties?.fixVersion || null,
            cvss: properties.cvss || rule?.properties?.cvss || {},
            locations: result.locations || [],
            references: rule?.helpUri ? [rule.helpUri] : []
          });
        });
      }
    });

    return findings;
  }

  extractFindings(parsed) {
    if (parsed && Array.isArray(parsed.runs)) {
      return this.collectSarifFindings(parsed);
    }
    return this.collectGenericFindings(parsed);
  }

  resolveImageReference() {
    if (!this.imageName) {
      return null;
    }
    const lower = this.imageName.toLowerCase();
    if (lower.startsWith('registry://') || lower.startsWith('image://') ||
        lower.startsWith('local://') || lower.startsWith('oci-dir://') ||
        lower.startsWith('archive://') || lower.startsWith('fs://') ||
        lower.startsWith('sbom://')) {
      return this.imageName;
    }
    // Default to pulling from registry to avoid requiring a local Docker daemon
    return `registry://${this.imageName}`;
  }

  async scanImage() {
    if (!this.imageName) {
      return {
        success: false,
        error: 'No container image provided for Docker Scout scan'
      };
    }

    try {
      const resolvedImage = this.resolveImageReference();
      if (!resolvedImage) {
        throw new Error('Invalid image reference provided for Docker Scout scan');
      }

      const command = [
        'docker-scout',
        'cves',
        resolvedImage,
        '--format',
        'sarif'
      ];

      const result = await this.executor.executeCommand(command, {
        timeout: 0,
        returnOutput: true
      });

      if (result.exitCode && result.exitCode !== 0) {
        const lowerOutput = (result.output || '').toLowerCase();
        if (lowerOutput.includes('log in with your docker id')) {
          throw new Error('Docker Scout requires a Docker Hub login inside the scanner container (run "docker login").');
        }
        throw new Error((result.output || result.error || 'Docker Scout execution failed').trim());
      }

      if (!result.output || !result.output.trim()) {
        throw new Error('Docker Scout returned empty output');
      }

      let parsedOutput = null;
      const raw = result.output.trim();

      try {
        parsedOutput = JSON.parse(raw);
      } catch (parseError) {
        console.warn(`[${this.scanId}] Failed to parse Docker Scout JSON, attempting to recover...`);
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          parsedOutput = JSON.parse(raw.substring(jsonStart, jsonEnd + 1));
        } else {
          throw parseError;
        }
      }

      const vulnerabilities = this.extractFindings(parsedOutput);

      return {
        success: true,
        image: this.imageName,
        vulnerabilities,
        raw
      };
    } catch (error) {
      console.error(`[${this.scanId}] Docker Scout scan error:`, error);
      return {
        success: false,
        image: this.imageName,
        vulnerabilities: [],
        error: error.message
      };
    }
  }
}

module.exports = DockerScoutScanner;

