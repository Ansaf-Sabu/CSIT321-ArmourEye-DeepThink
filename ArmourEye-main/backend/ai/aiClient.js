const http = require('http');
const https = require('https');
const { URL } = require('url');

class AIClient {
  constructor(settingsStore) {
    this.settingsStore = settingsStore;
    // Default timeout for AI requests (ms). Increased to handle slow local LLMs.
    const defaultTimeout = 3600000; // 1 hour
    const fromEnv = process.env.AI_CLIENT_TIMEOUT || process.env.AI_CLIENT_RPCTIMEOUT;
    this.timeoutMs = Number(fromEnv || defaultTimeout);
  }

  _buildUrl(baseUrl, pathSuffix = '') {
    if (!baseUrl) {
      throw new Error('AI endpoint is not configured');
    }
    const trimmedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL(pathSuffix.replace(/^\//, ''), trimmedBase);
  }

  _requestJson(method, url, body) {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const options = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(raw ? JSON.parse(raw) : {});
            } catch (error) {
              reject(new Error(`Failed to parse AI response: ${error.message}`));
            }
          } else {
            reject(new Error(`AI server responded with ${res.statusCode}: ${raw}`));
          }
        });
      });

      req.on('error', reject);

      if (this.timeoutMs > 0) {
        req.setTimeout(this.timeoutMs, () => {
          req.destroy(new Error(`AI request timed out after ${this.timeoutMs}ms`));
        });
      }

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  _getEndpointOrder() {
    const settings = this.settingsStore.getSettings();
    const endpoints = [];
    if (settings.mode === 'local') {
      endpoints.push(settings.localUrl);
    } else if (settings.mode === 'remote') {
      endpoints.push(settings.remoteUrl);
    } else {
      endpoints.push(settings.localUrl, settings.remoteUrl);
    }
    return endpoints.filter(Boolean);
  }

  /**
   * Analyze a single package via the FastAPI /analyze endpoint.
   * This is used by the AI Insights page to integrate with the simpler RAG service.
   * @param {string} packageName
   * @param {string} version
   * @param {{ summarizeWithLLM?: boolean }} options
   * @returns {Promise<Object>} FastAPI analysis response
   */
  async analyzePackage(packageName, version, options = {}) {
    const endpoints = this._getEndpointOrder();
    if (endpoints.length === 0) {
      throw new Error('No AI endpoints configured');
    }

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const targetUrl = this._buildUrl(endpoint, '/analyze');
        const body = {
          package_name: packageName,
          version
        };
        if (typeof options.summarizeWithLLM === 'boolean') {
          body.summarize_with_llm = options.summarizeWithLLM;
        }
        const response = await this._requestJson('POST', targetUrl, body);
        this.settingsStore.setLastHealthyEndpoint(endpoint);
        return response;
      } catch (error) {
        lastError = error;
        console.warn(`[ai-client] Package analyze via ${endpoint} failed: ${error.message}`);
      }
    }

    throw lastError || new Error('All AI endpoints failed for package analyze');
  }

  async analyze(payload) {
    const endpoints = this._getEndpointOrder();
    if (endpoints.length === 0) {
      throw new Error('No AI endpoints configured');
    }

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const targetUrl = this._buildUrl(endpoint, '/v1/analyze');
        const response = await this._requestJson('POST', targetUrl, payload);
        this.settingsStore.setLastHealthyEndpoint(endpoint);
        return response;
      } catch (error) {
        lastError = error;
        console.warn(`[ai-client] Endpoint ${endpoint} failed: ${error.message}`);
      }
    }

    throw lastError || new Error('All AI endpoints failed');
  }

  async checkEndpoint(endpoint) {
    if (!endpoint) {
      return {
        url: null,
        reachable: false,
        error: 'Not configured'
      };
    }

    try {
      const healthUrl = this._buildUrl(endpoint, '/health');
      const response = await this._requestJson('GET', healthUrl);
      this.settingsStore.setLastHealthyEndpoint(endpoint);
      return {
        url: endpoint,
        reachable: true,
        info: response
      };
    } catch (error) {
      return {
        url: endpoint,
        reachable: false,
        error: error.message
      };
    }
  }
}

module.exports = AIClient;

