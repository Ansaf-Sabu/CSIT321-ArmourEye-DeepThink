import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Brain, 
  Sparkles, 
  AlertTriangle, 
  ShieldCheck, 
  Loader2, 
  ChevronRight,
  Target as TargetIcon,
  Network,
  Plug,
  Layers,
  Terminal,
  ScrollText,
  Square,
  Play,
  RotateCcw,
  Download,
  X
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import SaveAiResultsButton from '../components/ai/SaveAiResultsButton';

interface EndpointStatus {
  url: string | null;
  reachable: boolean;
  error?: string;
  info?: Record<string, unknown>;
}

interface AISettingsResponse {
  mode: 'local' | 'remote';
  localUrl?: string;
  remoteUrl?: string;
  endpoints?: {
    local?: EndpointStatus;
    remote?: EndpointStatus;
  };
}

interface RuntimeExposure {
  is_exposed?: boolean;
  exposed_ports?: number[];
  exposed_services?: string[];
  web_vulnerabilities?: Array<Record<string, unknown>>;
  database_issues?: Array<Record<string, unknown>>;
  auth_weaknesses?: Array<Record<string, unknown>>;
  exploitable_vulnerabilities?: string[];
}

interface PackageSummary {
  package: string;
  version: string;
  status: 'VULNERABLE' | 'CLEAN' | 'UNKNOWN';
  unique_vuln_count: number;
  severities_found: string[];
  runtime_exposure: RuntimeExposure;
  exploitable_count: number;
  llm_summary: string;
  structured_report: Record<string, unknown>;
}

interface AiMeta {
  scanId?: string | null;
  mode?: string;
  model?: Record<string, unknown>;
  completedAt?: string;
}

interface AITarget {
  id: string;
  scanId: string;
  name: string;
  image?: string | null;
  ip?: string | null;
  networks?: string[];
  ports?: string[];
  status?: string;
  profile?: string;
  lastScanAt?: string;
  vulns?: number;
  type?: string;
}

const STORAGE_KEY = 'aiInsightsState';
const RESULTS_CACHE_KEY = 'aiInsightsResultsCache';
const SERVER_START_KEY = 'aiInsightsServerStart';

// Cache structure: { [targetId]: { results, aiMeta, timestamp, logs, targetName } }
type LogEntry = { level: 'info' | 'error'; message: string; timestamp: string };
type ResultsCache = Record<string, { 
  results: PackageSummary[]; 
  aiMeta: AiMeta | null; 
  timestamp: number;
  logs?: LogEntry[];
  targetName?: string;
  serverStartTime?: number;
}>;

// Check if backend was restarted and clear cache if so
const checkAndClearCacheOnRestart = async (): Promise<void> => {
  try {
    const response = await fetch('http://localhost:3001/api/health');
    if (response.ok) {
      const data = await response.json();
      const serverStartTime = data.serverStartTime;
      const lastKnownStart = localStorage.getItem(SERVER_START_KEY);
      
      if (lastKnownStart && serverStartTime && String(serverStartTime) !== lastKnownStart) {
        // Backend was restarted - clear the AI cache
        console.log('[AI Insights] Backend restart detected, clearing cache');
        localStorage.removeItem(RESULTS_CACHE_KEY);
        localStorage.removeItem(STORAGE_KEY);
      }
      
      // Save current server start time
      if (serverStartTime) {
        localStorage.setItem(SERVER_START_KEY, String(serverStartTime));
      }
    }
  } catch {
    // Ignore errors - backend might not be running
  }
};

// Call on module load
checkAndClearCacheOnRestart();

const getResultsCache = (): ResultsCache => {
  try {
    const cached = localStorage.getItem(RESULTS_CACHE_KEY);
    if (!cached) return {};
    return JSON.parse(cached);
  } catch {
    return {};
  }
};

const saveResultsCache = (cache: ResultsCache) => {
  try {
    // Keep only the 10 most recent targets to avoid localStorage bloat
    const entries = Object.entries(cache).sort((a, b) => b[1].timestamp - a[1].timestamp);
    const trimmed = Object.fromEntries(entries.slice(0, 10));
    localStorage.setItem(RESULTS_CACHE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('Failed to save results cache:', e);
  }
};

// Lightweight global handle so an in-flight AI analysis can survive page navigation
declare global {
  interface Window {
    __armourEyeAiJob?: {
      controller: AbortController;
      status: 'running' | 'completed' | 'error' | 'cancelled';
      startedAt: number;
      targetId: string;
    };
  }
}

const ScanResultsPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [results, setResults] = useState<PackageSummary[]>([]);
  const [stateHydrated, setStateHydrated] = useState(false);
  const [aiMode, setAiMode] = useState<'local' | 'remote'>('local');
  const [aiSettings, setAiSettings] = useState<AISettingsResponse | null>(null);
  const [aiMeta, setAiMeta] = useState<AiMeta | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [availableTargets, setAvailableTargets] = useState<AITarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [cancelledByUser, setCancelledByUser] = useState(false);
  const [aiLogs, setAiLogs] = useState<LogEntry[]>([]);
  const [hasRunAnalysisThisSession, setHasRunAnalysisThisSession] = useState(false);

  // Track mount state so background promises don't try to update unmounted components
  const [isMounted, setIsMounted] = useState(true);
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  const pushLog = useCallback(
    (message: string, level: 'info' | 'error' = 'info') => {
      const timestamp = new Date().toLocaleTimeString();
      setAiLogs(prev => {
        const next = [...prev, { level, message, timestamp }];
        // Keep only the latest 100 entries
        return next.slice(-100);
      });
      if (level === 'error') {
        console.error('[AI Insights]', timestamp, message);
      } else {
        console.log('[AI Insights]', timestamp, message);
      }
    },
    []
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.selectedTargetId) setSelectedTargetId(parsed.selectedTargetId);
        if (Array.isArray(parsed.results)) setResults(parsed.results);
        if (typeof parsed.analysisComplete === 'boolean') setAnalysisComplete(parsed.analysisComplete);
        if (parsed.aiMeta) setAiMeta(parsed.aiMeta);
        if (parsed.aiMode === 'local' || parsed.aiMode === 'remote') setAiMode(parsed.aiMode);
      }

      // If there is a globally running AI job, reflect that in the UI when we mount
      const globalJob = window.__armourEyeAiJob;
      if (globalJob && globalJob.status === 'running') {
        pushLog(
          `Reattached to running AI analysis for target ${globalJob.targetId} (started ${new Date(
            globalJob.startedAt
          ).toLocaleTimeString()})`
        );
        setIsAnalyzing(true);
        // Show at least some progress while we don't know exact percentage
        setAnalysisProgress(prev => (prev > 30 ? prev : 30));
      }
    } catch (error) {
      console.warn('Failed to restore AI Insights state:', error);
    } finally {
      setStateHydrated(true);
    }
  }, [pushLog]);

  useEffect(() => {
    if (!stateHydrated) return;
    try {
      const payload = {
        selectedTargetId,
        analysisComplete,
        results,
        aiMode,
        aiMeta
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist AI Insights state:', error);
    }
  }, [selectedTargetId, analysisComplete, results, aiMode, aiMeta, stateHydrated]);

  // Update cache with logs whenever they change (for the current target with results)
  useEffect(() => {
    if (!selectedTargetId || !analysisComplete || results.length === 0) return;
    
    try {
      const cache = getResultsCache();
      if (cache[selectedTargetId]) {
        const selectedTarget = availableTargets.find(t => t.id === selectedTargetId);
        cache[selectedTargetId] = {
          ...cache[selectedTargetId],
          logs: aiLogs,
          targetName: selectedTarget?.name || selectedTargetId.substring(0, 12)
        };
        saveResultsCache(cache);
      }
    } catch (e) {
      // Ignore cache update errors
    }
  }, [aiLogs, selectedTargetId, analysisComplete, results.length, availableTargets]);

  const fetchSettings = useCallback(async () => {
    if (!token) return;
    setSettingsLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/ai/settings', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data: AISettingsResponse = await response.json();
        setAiSettings(data);
        if (data.mode === 'local' || data.mode === 'remote') {
          setAiMode(data.mode);
        }
      } else {
        console.error('Failed to fetch AI settings:', await response.text());
      }
    } catch (error) {
      console.error('Failed to fetch AI settings:', error);
    } finally {
      setSettingsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!token) {
      setAvailableTargets([]);
      return;
    }
    let cancelled = false;
    const loadTargets = async () => {
      setTargetsLoading(true);
      setTargetsError(null);
      try {
        const response = await fetch('http://localhost:3001/api/ai/targets', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || 'Failed to load AI targets');
        }
        const data: AITarget[] = await response.json();
        if (!cancelled) {
          setAvailableTargets(data);
          setTargetsLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load AI targets:', error);
          setTargetsError(error instanceof Error ? error.message : 'Failed to load AI targets');
          setAvailableTargets([]);
          setTargetsLoaded(true); // Even on error, mark as loaded so we don't block
        }
      } finally {
        if (!cancelled) setTargetsLoading(false);
      }
    };

    loadTargets();
    const interval = setInterval(loadTargets, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  useEffect(() => {
    if (targetsLoaded && selectedTargetId && !availableTargets.some(target => target.id === selectedTargetId)) {
      console.warn('Selected target ID not found in available targets, resetting selection');
      setSelectedTargetId(null);
      setAnalysisComplete(false);
      setResults([]);
    }
  }, [availableTargets, selectedTargetId, targetsLoaded]);

  // When switching targets, check if we have cached results
  const handleSelectTarget = (id: string) => {
    setSelectedTargetId(id);
    setErrorMessage(null);
    
    // Check for cached results for this target
    const cache = getResultsCache();
    const cachedEntry = cache[id];
    
    if (cachedEntry && cachedEntry.results.length > 0) {
      // Restore cached results and logs
      setResults(cachedEntry.results);
      setAiMeta(cachedEntry.aiMeta);
      setAnalysisComplete(true);
      setAnalysisProgress(100);
      // Restore logs from cache if available
      if (cachedEntry.logs && cachedEntry.logs.length > 0) {
        setAiLogs(cachedEntry.logs);
        setHasRunAnalysisThisSession(true);
      }
    } else {
      // No cache - reset state
      setAnalysisComplete(false);
      setResults([]);
      setAnalysisProgress(0);
      setAiMeta(null);
      // Clear logs when switching to a target without cached results
      setAiLogs([]);
    }
  };

  const handleRunAI = async () => {
    if (!selectedTargetId || !token) return;
    const selectedTarget = availableTargets.find(target => target.id === selectedTargetId);
    setCancelledByUser(false);
    setHasRunAnalysisThisSession(true);
    
    // Clear logs for fresh analysis
    setAiLogs([]);

    pushLog(
      `Starting AI analysis for target ${selectedTarget?.name || selectedTargetId.substring(0, 12)} using ${aiMode.toUpperCase()} mode.`
    );
    if (!selectedTarget) {
      pushLog('Warning: Selected target details not found in available targets list.', 'error');
    }

    // Abort any previously running global AI job
    if (window.__armourEyeAiJob?.status === 'running') {
      try {
        window.__armourEyeAiJob.controller.abort();
      } catch {
        // ignore
      }
    }

    const controller = new AbortController();
    window.__armourEyeAiJob = {
      controller,
      status: 'running',
      startedAt: Date.now(),
      targetId: selectedTargetId
    };

    setIsAnalyzing(true);
    setAnalysisComplete(false);
    setResults([]);
    setErrorMessage(null);
    setAnalysisProgress(5);

    try {
      // Very long timeout (1 hour) to avoid cancelling slow local LLM runs
      const timeoutMs = 3600000;
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      setAnalysisProgress(20);
      pushLog('Sending /api/ai/analyze request to backend...');
      pushLog('Backend is checking packages against AI database (this may take a moment for large images)...');
      const response = await fetch('http://localhost:3001/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          targetId: selectedTargetId,
          target: selectedTarget,
          summarizeWithLLM: true
        }),
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to run AI analysis');
      }

      setAnalysisProgress(80);
      pushLog('Processing results...');
      const data = await response.json();
      const packages = Array.isArray(data.packages) ? data.packages : [];
      const meta: AiMeta = {
        scanId: data.scanId,
        model: data.model,
        mode: data.mode,
        completedAt: new Date().toISOString()
      };

      // Persist results so they survive navigation even if component is unmounted
      try {
        const existingRaw = localStorage.getItem(STORAGE_KEY);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        const payload = {
          ...existing,
          selectedTargetId,
          analysisComplete: true,
          results: packages,
          aiMode,
          aiMeta: meta
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        
        // Also save to per-target cache so switching targets doesn't lose results
        const cache = getResultsCache();
        const targetName = selectedTarget?.name || selectedTargetId.substring(0, 12);
        cache[selectedTargetId] = {
          results: packages,
          aiMeta: meta,
          timestamp: Date.now(),
          logs: aiLogs,
          targetName
        };
        saveResultsCache(cache);
      } catch (e) {
        console.warn('Failed to persist AI Insights results:', e);
      }

      if (isMounted) {
        setResults(packages);
        setAnalysisComplete(true);
        setAiMeta(meta);
        setAnalysisProgress(100);
      }

      if (window.__armourEyeAiJob) {
        window.__armourEyeAiJob.status = 'completed';
      }

      pushLog(
        `AI analysis completed successfully: ${packages.length} package(s) summarized (mode: ${meta.mode}).`
      );
    } catch (error: any) {
      // Differentiate between a manual cancel / timeout and real errors
      const isAbort =
        error?.name === 'AbortError' ||
        (error?.message && String(error.message).toLowerCase().includes('aborted'));

      if (window.__armourEyeAiJob) {
        window.__armourEyeAiJob.status = isAbort ? 'cancelled' : 'error';
      }

      console.error('AI analysis failed:', error);
      if (isMounted) {
        if (isAbort) {
          setErrorMessage(
            cancelledByUser
              ? 'AI analysis cancelled.'
              : 'AI analysis timed out while waiting for the AI service to respond.'
          );
          pushLog(
            cancelledByUser
              ? 'AI analysis cancelled by user.'
              : 'AI analysis aborted due to timeout while waiting for AI service.',
            'error'
          );
        } else {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to run AI analysis');
          pushLog(
            `AI analysis failed: ${
              error instanceof Error ? error.message : 'Unknown error (see console)'
            }`,
            'error'
          );
        }
        setAnalysisComplete(false);
        setAnalysisProgress(0);
      }
    } finally {
      if (isMounted) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleStopAI = () => {
    const job = window.__armourEyeAiJob;
    if (job && job.status === 'running') {
      try {
        job.controller.abort();
      } catch {
        // ignore
      }
      job.status = 'cancelled';
    }
    pushLog('User requested stop; cancelling in-flight AI analysis.', 'error');
    setCancelledByUser(true);
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    setAnalysisComplete(false);
    setErrorMessage('AI analysis cancelled.');
  };

  const handleModeChange = async (mode: 'local' | 'remote') => {
    if (aiMode === mode || !token) return;
    if (mode === 'remote' && !aiSettings?.remoteUrl) {
      setErrorMessage('Configure a remote endpoint before switching to Remote mode.');
      return;
    }

    setSettingsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch('http://localhost:3001/api/ai/settings/mode', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ mode })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to update AI mode');
      }

      const data = await response.json();
      if (data.mode === 'local' || data.mode === 'remote') {
        setAiMode(data.mode);
      }
      await fetchSettings();
    } catch (error) {
      console.error('Failed to update AI mode:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update AI mode');
    } finally {
      setSettingsLoading(false);
    }
  };

  const formatEndpointStatus = (status?: EndpointStatus) => {
    if (!status) return 'Not checked';
    if (!status.url) return 'Not configured';
    if (status.reachable) return 'Online';
    // Simplify error output so it just says Offline without leaking low-level network errors
    return 'Offline';
  };

  const aiModeLabel = aiMode === 'local' ? 'Local (this machine)' : 'Remote (Colab/Cloudflare)';

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-gradient-to-br from-gray-900 via-gray-850 to-gray-900 border border-gray-700 rounded-2xl p-8 shadow-2xl shadow-black/20">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
          <div>
            <div className="flex items-center space-x-3 text-accent mb-3">
              <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-sm font-semibold tracking-wide uppercase">AI Insights</span>
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold text-white mb-3">AI Analysis Command Center</h1>
            <p className="text-gray-300 text-base max-w-3xl">
              Correlate Trivy package results with live runtime intelligence. Feed the combined context into the local or
              remote Mistral service to produce prioritized, explainable remediation guidance.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-900/60 rounded-xl border border-gray-700 p-4 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-300">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wide">RAG Context</p>
                <p className="text-white font-semibold">Packages + Runtime</p>
              </div>
            </div>
            <div className="bg-gray-900/60 rounded-xl border border-gray-700 p-4 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-300">
                <ScrollText className="w-4 h-4" />
              </div>
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wide">LLM Output</p>
                <p className="text-white font-semibold">Actionable Summaries</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
        
        {/* --- LEFT COLUMN: Select Target & Run --- */}
        <div className="lg:col-span-1 space-y-6 flex flex-col">

          {/* AI Source Toggle */}
          <div className="bg-secondary rounded-xl border border-gray-700 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Model Source</h2>
                <p className="text-sm text-gray-400">Choose where the inference server runs.</p>
              </div>
              {settingsLoading && (
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleModeChange('local')}
                className={`p-3 rounded-lg border text-sm font-semibold transition-all ${
                  aiMode === 'local'
                    ? 'border-accent bg-accent/10 text-white shadow-lg shadow-accent/20'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                Local
              </button>
              <button
                onClick={() => handleModeChange('remote')}
                disabled={!aiSettings?.remoteUrl}
                className={`p-3 rounded-lg border text-sm font-semibold transition-all ${
                  aiMode === 'remote'
                    ? 'border-purple-500 bg-purple-500/10 text-white shadow-lg shadow-purple-500/20'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                } ${!aiSettings?.remoteUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Remote
              </button>
            </div>
            <div className="text-xs text-gray-400 space-y-1">
              <p>
                Local:&nbsp;
                <span className={aiSettings?.endpoints?.local?.reachable ? 'text-green-400' : 'text-yellow-400'}>
                  {formatEndpointStatus(aiSettings?.endpoints?.local)}
                </span>
              </p>
              <p>
                Remote:&nbsp;
                {aiSettings?.remoteUrl ? (
                  <span className={aiSettings?.endpoints?.remote?.reachable ? 'text-green-400' : 'text-yellow-400'}>
                    {formatEndpointStatus(aiSettings?.endpoints?.remote)}
                  </span>
                ) : (
                  <span className="text-gray-500">Not configured</span>
                )}
              </p>
            </div>
          </div>
          
          {/* Target Selection + Run Intelligence */}
          <div className="bg-secondary rounded-xl border border-gray-700 p-6 space-y-6 flex-1">
            <div>
              <h2 className="text-xl font-semibold text-white mb-4">Select Scanned Target</h2>
            
            {targetsLoading ? (
              <div className="text-center p-4 border border-dashed border-gray-700 rounded-lg text-gray-400">
                <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Loading scanned targets...</p>
              </div>
            ) : targetsError ? (
              <div className="text-center p-4 border border-dashed border-red-700 rounded-lg text-red-300">
                <p className="text-sm">Failed to load targets: {targetsError}</p>
                <p className="text-xs text-red-200 mt-1">Run a scan and refresh this page.</p>
              </div>
            ) : availableTargets.length === 0 ? (
              <div className="text-center p-4 border border-dashed border-gray-700 rounded-lg">
                <p className="text-gray-500 text-sm">No analyzed targets yet. Run a new scan from the Orchestrator.</p>
              </div>
            ) : (
              <div className="space-y-3 flex-1 min-h-[420px] overflow-y-auto pr-2 custom-scrollbar">
                {availableTargets.map(target => {
                  const isSelected = selectedTargetId === target.id;
                  const status = target.status || 'idle';
                  const idLabel = target.id ? target.id.slice(0, 8) : 'N/A';
                  const statusStyles = (() => {
                    switch (status) {
                      case 'completed':
                        return { dot: 'bg-green-400', badge: 'bg-green-900 text-green-200' };
                      case 'scanning':
                        return { dot: 'bg-yellow-400', badge: 'bg-yellow-900 text-yellow-200' };
                      case 'failed':
                        return { dot: 'bg-red-500', badge: 'bg-red-900 text-red-200' };
                      default:
                        return { dot: 'bg-gray-500', badge: 'bg-gray-800 text-gray-300' };
                    }
                  })();

                  const ports = target.ports || [];
                  const networks = target.networks || [];

                  return (
                    <button
                      key={target.id}
                      onClick={() => handleSelectTarget(target.id)}
                      className={`w-full text-left p-4 rounded-xl border transition-all ${
                        isSelected 
                          ? 'bg-accent/10 border-accent shadow-lg shadow-accent/20' 
                          : 'bg-gray-850 border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0 mt-1">
                          <TargetIcon className="w-5 h-5 text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full ${statusStyles.dot}`}></span>
                          <span className="text-white font-semibold break-words">{target.name || 'Unnamed Target'}</span>
                        </div>
                            <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusStyles.badge}`}>
                              {status}
                            </span>
                          </div>

                          <div className="space-y-2 text-sm break-words">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-gray-400">IP:</span>
                              <span className="text-white font-mono">{target.ip || 'No IP'}</span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                              <div className="flex items-center space-x-1">
                                <Sparkles className="w-3 h-3 text-accent" />
                                <span>{target.vulns ?? 0} findings</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <ShieldCheck className="w-3 h-3 text-green-400" />
                                <span className="capitalize">{target.type || 'image'}</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <AlertTriangle className="w-3 h-3 text-yellow-400" />
                                <span>ID: {idLabel}</span>
                              </div>
                            </div>

                            {networks.length > 0 && (
                              <div className="flex items-center space-x-2">
                                <Network className="w-3 h-3 text-cyan" />
                                <span className="text-gray-400">Networks:</span>
                                <div className="flex flex-wrap gap-1">
                                  {networks.map(network => (
                                    <span key={network} className="bg-cyan/20 text-cyan px-2 py-0.5 rounded text-[11px]">
                                      {network}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {ports.length > 0 && (
                              <div className="flex items-center space-x-2">
                                <Plug className="w-3 h-3 text-success" />
                                <span className="text-gray-400">Ports:</span>
                                <div className="flex flex-wrap gap-1">
                                  {ports.map((port, idx) => {
                                    let label: string | null = null;
                                    if (typeof port === 'string' || typeof port === 'number') {
                                      label = String(port);
                                    } else if (port && typeof port === 'object') {
                                      const number = port.number ?? port.port;
                                      if (number !== undefined) {
                                        label = `${number}/${port.protocol || 'tcp'}`;
                                      }
                                    }
                                    if (!label) {
                                      label = `Port ${idx + 1}`;
                                    }
                                    return (
                                      <span
                                        key={`${label}-${idx}`}
                                        className="bg-success/20 text-success px-2 py-0.5 rounded text-[11px] font-mono"
                                      >
                                        {label}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>

            <div className="border-t border-gray-700 pt-6">
              <h2 className="text-xl font-semibold text-white mb-4">Run Intelligence</h2>
              
              {/* Control Buttons - similar to scan page */}
              <div className="flex gap-3">
                {!isAnalyzing ? (
                  <>
                    {/* Start / Re-run button */}
                    <button
                      onClick={handleRunAI}
                      disabled={!selectedTargetId || !token}
                      className={`flex-1 py-3 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all ${
                        !selectedTargetId || !token
                          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg'
                      }`}
                    >
                      {analysisComplete ? (
                        <>
                          <RotateCcw className="w-5 h-5" />
                          <span>Re-run Analysis</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5" />
                          <span>Start Analysis</span>
                        </>
                      )}
                    </button>
                    
                    {/* Status indicator when complete */}
                    {analysisComplete && (
                      <div className="flex items-center px-4 py-3 bg-green-600/20 border border-green-600/40 rounded-lg">
                        <Sparkles className="w-5 h-5 text-green-400 mr-2" />
                        <span className="text-green-400 font-medium">Complete</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Running indicator */}
                    <div className="flex-1 py-3 rounded-lg font-bold flex items-center justify-center space-x-2 bg-purple-600/20 border border-purple-600/40 text-purple-300">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Analyzing via {aiMode === 'local' ? 'Local' : 'Remote'} AI...</span>
                    </div>
                    
                    {/* Stop button */}
                    <button
                      onClick={handleStopAI}
                      className="px-6 py-3 rounded-lg font-bold flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-500 text-white transition-all"
                    >
                      <Square className="w-4 h-4" />
                      <span>Stop</span>
                    </button>
                  </>
                )}
              </div>
              
              {isAnalyzing && (
                <div className="w-full bg-gray-700 rounded-full h-2 mt-4 overflow-hidden">
                  <div
                    className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(analysisProgress, 10)}%` }}
                  ></div>
                </div>
              )}

              {errorMessage && (
                <div className="mt-4 text-sm text-red-300 bg-red-900/20 border border-red-800 px-3 py-2 rounded">
                  {errorMessage}
                </div>
              )}

              {/* AI Logs - styled like scanning page LogPanel - only show when analysis has been run */}
              {hasRunAnalysisThisSession && aiLogs.length > 0 && (
                <div className="mt-4 bg-gray-900/80 border border-gray-700 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-850/50">
                    <div className="flex items-center space-x-2">
                      <Terminal className="w-4 h-4 text-accent" />
                      <span className="text-sm font-medium text-white">AI Analysis Log</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => setAiLogs([])} 
                        className="p-1 text-gray-400 hover:text-white transition-colors" 
                        title="Clear logs"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => {
                          const logText = aiLogs.map(l => `[${l.timestamp}] ${l.level.toUpperCase()}: ${l.message}`).join('\n');
                          const blob = new Blob([logText], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `ai-analysis-log-${new Date().toISOString().split('T')[0]}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }} 
                        className="p-1 text-gray-400 hover:text-white transition-colors" 
                        title="Download logs"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                    {[...aiLogs]
                      .slice()
                      .reverse()
                      .map((entry, idx) => {
                        const bgClass = entry.level === 'error' 
                          ? 'bg-error/5 border-error/30' 
                          : 'bg-gray-850/60 border-gray-700';
                        const textClass = entry.level === 'error' 
                          ? 'text-red-300' 
                          : 'text-gray-300';
                        return (
                          <div
                            key={idx}
                            className={`p-2 rounded-lg border ${bgClass}`}
                          >
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-gray-500 font-mono">{entry.timestamp}</span>
                              <span className={`font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${textClass} bg-white/5`}>
                                {entry.level}
                              </span>
                            </div>
                            <p className={`mt-1 text-xs leading-relaxed break-words ${textClass}`}>
                              {entry.message}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Download AI Report Button */}
            <div className="mt-6">
              <SaveAiResultsButton 
                currentTargetId={selectedTargetId} 
                currentTargetName={availableTargets.find(t => t.id === selectedTargetId)?.name || selectedTargetId?.substring(0, 12)}
                currentResults={results} 
                currentAiMeta={aiMeta}
                targets={availableTargets.map(t => ({ id: t.id, name: t.name }))}
              />
            </div>
          </div>
        </div>

        {/* --- RIGHT COLUMN: Results List --- */}
        <div className="lg:col-span-2 flex min-w-0">
           <div className="bg-secondary rounded-xl border border-gray-700 p-6 flex-1 flex flex-col min-w-0 overflow-hidden">
             <h2 className="text-xl font-semibold text-white mb-2">Analysis Results</h2>

             {analysisComplete && results.length > 0 && (
               <div className="mb-6 bg-gray-900/70 border border-accent/40 rounded-lg p-4">
                 <div className="flex items-center mb-2">
                   <Sparkles className="w-4 h-4 text-accent mr-2" />
                   <span className="text-sm font-semibold text-accent">AI Summary</span>
                 </div>
                 <p className="text-sm text-gray-300">
                   {(() => {
                     const total = results.length;
                     const vulnerable = results.filter(r => r.status === 'VULNERABLE').length;
                     const clean = results.filter(r => r.status === 'CLEAN').length;
                     const unknown = total - vulnerable - clean;
                     return `LLM analyzed ${total} packages: ${vulnerable} vulnerable, ${clean} clean, ${unknown} unknown. Review the highest‑risk packages first and follow the remediation notes in each card below.`;
                   })()}
                 </p>
               </div>
             )}

             {!analysisComplete ? (
               <div className="flex flex-col items-center justify-center h-64 text-gray-500 text-center px-6">
                 <Brain className="w-16 h-16 mb-4 opacity-20" />
                 <p className="text-white font-semibold">No AI run yet</p>
                 <p className="text-gray-400 text-sm mt-2">
                   Select a target that has completed a scan, choose the AI source, and click “Run Intelligence”.
                 </p>
               </div>
             ) : results.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-64 text-gray-500 text-center px-6">
                 <ShieldCheck className="w-16 h-16 mb-4 opacity-20" />
                 <p className="text-white font-semibold">No packages returned</p>
                 <p className="text-gray-400 text-sm mt-2">
                   The latest scan did not produce any package data to analyze. Confirm that Trivy completed successfully.
                 </p>
               </div>
             ) : (
               <div className="space-y-4">
                 {aiMeta && (
                   <div className="text-sm text-gray-400 flex flex-wrap gap-4 border border-gray-800 rounded-lg p-4 bg-gray-900/40">
                     <span>Source: <span className="text-white">{aiModeLabel}</span></span>
                     {aiMeta.model?.quantization && (
                       <span>Quantization: <span className="text-white">{String(aiMeta.model.quantization)}</span></span>
                     )}
                     {aiMeta.model?.model_path && (
                       <span>Model: <span className="text-white truncate max-w-[200px] inline-block align-bottom">{String(aiMeta.model.model_path)}</span></span>
                     )}
                     {aiMeta.scanId && (
                       <span>Scan ID: <span className="text-white">{aiMeta.scanId}</span></span>
                     )}
                   </div>
                 )}

                 <p className="text-gray-400 text-sm">
                   Found {results.length} packages from the latest scan. Click any card to open the detailed report.
                 </p>
                 
                 {results.map((item) => {
                   const isVulnerable = item.status === 'VULNERABLE';
                   const statusBadge = isVulnerable
                     ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                     : item.status === 'CLEAN'
                       ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                       : 'bg-gray-700 text-gray-200 border border-gray-600';
                   return (
                     <div 
                       key={`${item.package}-${item.version}`}
                       onClick={() => navigate('/analysis-detail', { state: { report: item.structured_report } })}
                       className="bg-gray-850 border border-gray-700 rounded-lg p-4 hover:border-accent cursor-pointer transition-all group overflow-hidden"
                     >
                       <div className="flex items-start justify-between gap-4 min-w-0">
                         <div className="flex items-start space-x-4 min-w-0 flex-1">
                           <div className={`mt-1 p-2 rounded-lg flex-shrink-0 ${isVulnerable ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                              {isVulnerable ? (
                                <AlertTriangle className="w-6 h-6 text-red-500" />
                              ) : (
                                <ShieldCheck className="w-6 h-6 text-green-500" />
                              )}
                           </div>
                           <div className="min-w-0 flex-1">
                             <div className="flex items-center flex-wrap gap-2">
                               <h3 className="text-lg font-bold text-white truncate max-w-[200px]">{item.package}</h3>
                               <span className="text-xs font-normal text-gray-400 bg-gray-800 px-2 py-1 rounded flex-shrink-0">
                                 v{item.version}
                               </span>
                               <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadge}`}>
                                 {item.status}
                               </span>
                             </div>
                             <p className="text-gray-300 text-sm mt-2 line-clamp-3">
                               {item.llm_summary || 'Summary unavailable. Open the detailed report for raw data.'}
                             </p>
                             <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                               <span className="flex items-center gap-1">
                                 <Sparkles className="w-3 h-3 text-accent" />
                                 {item.unique_vuln_count} findings
                               </span>
                               <span className="flex items-center gap-1">
                                 <AlertTriangle className="w-3 h-3 text-yellow-400" />
                                 {item.exploitable_count} exploitable
                               </span>
                               {item.runtime_exposure?.is_exposed && (
                                 <span className="flex items-center gap-1 text-red-300">
                                   <Plug className="w-3 h-3" />
                                   Ports: {item.runtime_exposure?.exposed_ports?.length
                                     ? item.runtime_exposure.exposed_ports.join(', ')
                                     : 'unknown'}
                                 </span>
                               )}
                             </div>
                           </div>
                         </div>
                         <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-accent transition-colors flex-shrink-0" />
                       </div>
                     </div>
                   );
                 })}
               </div>
             )}
           </div>
        </div>

      </div>
    </div>
  );
};

export default ScanResultsPage;