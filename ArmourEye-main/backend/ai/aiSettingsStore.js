const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '../data/ai-settings.json');

const defaultSettings = {
  mode: (process.env.AI_MODE === 'remote' ? 'remote' : 'local'),
  localUrl: process.env.AI_LOCAL_URL || 'http://localhost:8000',
  remoteUrl: process.env.AI_REMOTE_URL || process.env.MISTRAL_API_URL || '',
  lastHealthyEndpoint: null,
  updatedAt: new Date().toISOString()
};

class AISettingsStore {
  constructor(filePath = SETTINGS_PATH) {
    this.filePath = filePath;
    this.lastLoadedAt = 0;
    this.settings = this._load();
    // Path to Colab auto-update file (in Google Drive if synced)
    this.colabUpdatePath = path.join(__dirname, '../data/colab-remote-url.json');
    this.lastColabCheck = 0;
    this.colabCheckInterval = 5000; // Check every 5 seconds
    this._startColabWatcher();
  }

  _startColabWatcher() {
    // Check for Colab updates periodically
    setInterval(() => {
      this._checkColabUpdate();
    }, this.colabCheckInterval);
    
    // Also check on startup
    setTimeout(() => this._checkColabUpdate(), 2000);
  }

  _checkColabUpdate() {
    try {
      if (!fs.existsSync(this.colabUpdatePath)) {
        return; // No update file
      }

      const stats = fs.statSync(this.colabUpdatePath);
      const mtime = stats.mtimeMs;
      
      // Only check if file was modified recently (avoid old updates)
      if (mtime <= this.lastColabCheck) {
        return; // File hasn't changed
      }

      this.lastColabCheck = mtime;

      const raw = fs.readFileSync(this.colabUpdatePath, 'utf-8');
      const colabData = JSON.parse(raw);
      
      if (colabData.remoteUrl && colabData.remoteUrl !== this.settings.remoteUrl) {
        console.log(`[ai-settings] Auto-updating remote URL from Colab: ${colabData.remoteUrl}`);
        this.update({ remoteUrl: colabData.remoteUrl });
        
        // Optionally switch to remote mode if requested
        if (colabData.autoSwitchToRemote) {
          try {
            this.setMode('remote');
            console.log('[ai-settings] Auto-switched to Remote mode');
          } catch (err) {
            // Mode switch might fail if URL validation fails, that's ok
          }
        }
      }
    } catch (error) {
      // Silently ignore - file might not exist or be accessible
      // This is expected if Google Drive isn't synced locally
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.lastLoadedAt = stats.mtimeMs;
        return {
          ...defaultSettings,
          ...parsed,
          updatedAt: parsed.updatedAt || defaultSettings.updatedAt
        };
      }
    } catch (error) {
      console.warn('[ai-settings] Failed to load settings file, using defaults:', error.message);
    }
    this.lastLoadedAt = Date.now();
    return { ...defaultSettings };
  }

  _reloadFromDiskIfNeeded() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }
      const stats = fs.statSync(this.filePath);
      if (!this.lastLoadedAt || stats.mtimeMs > this.lastLoadedAt) {
        // Only log once per reload (avoid spam)
        if (!this._lastReloadLogTime || Date.now() - this._lastReloadLogTime > 5000) {
          console.log('[ai-settings] Detected external settings update, reloading.');
          this._lastReloadLogTime = Date.now();
        }
        this.settings = this._load();
      }
    } catch (error) {
      // Ignore failures - we'll retry next call
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
      this.lastLoadedAt = Date.now();
    } catch (error) {
      console.error('[ai-settings] Failed to persist settings:', error.message);
    }
  }

  getSettings() {
    this._reloadFromDiskIfNeeded();
    return { ...this.settings };
  }

  setMode(mode) {
    this._reloadFromDiskIfNeeded();
    if (!['local', 'remote'].includes(mode)) {
      throw new Error('Mode must be "local" or "remote"');
    }

    if (mode === 'remote' && !this.settings.remoteUrl) {
      throw new Error('Remote URL is not configured');
    }

    this.settings.mode = mode;
    this.settings.updatedAt = new Date().toISOString();
    this._save();
    return this.getSettings();
  }

  update(partial = {}) {
    this._reloadFromDiskIfNeeded();
    this.settings = {
      ...this.settings,
      ...partial,
      updatedAt: new Date().toISOString()
    };
    this._save();
    return this.getSettings();
  }

  setLastHealthyEndpoint(url) {
    if (!url) return;
    this._reloadFromDiskIfNeeded();
    this.settings.lastHealthyEndpoint = url;
    this.settings.lastHealthyAt = new Date().toISOString();
    this._save();
  }
}

module.exports = new AISettingsStore();

