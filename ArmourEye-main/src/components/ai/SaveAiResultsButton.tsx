import React, { useState, useEffect } from 'react';
import { Download, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface CachedResult {
  targetId: string;
  targetName: string;
  results: any[];
  aiMeta: Record<string, unknown> | null;
  timestamp: number;
}

interface SaveAiResultsButtonProps {
  currentTargetId?: string | null;
  currentTargetName?: string;
  currentResults?: any[];
  currentAiMeta?: Record<string, unknown> | null;
  targets?: Array<{ id: string; name: string }>;
  onReportGenerated?: () => void;
}

const RESULTS_CACHE_KEY = 'aiInsightsResultsCache';

const SaveAiResultsButton: React.FC<SaveAiResultsButtonProps> = ({ 
  currentTargetId,
  currentTargetName = 'Unknown',
  currentResults = [], 
  currentAiMeta = null,
  targets = [],
  onReportGenerated 
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [showOptions, setShowOptions] = useState(false);
  const [availableTargets, setAvailableTargets] = useState<CachedResult[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const { token } = useAuth();

  // Load cached AI results from localStorage
  useEffect(() => {
    try {
      const cached = localStorage.getItem(RESULTS_CACHE_KEY);
      
      if (cached) {
        const parsed = JSON.parse(cached);
        const loadedTargets: CachedResult[] = [];
        
        Object.entries(parsed).forEach(([targetId, data]: [string, any]) => {
          // Only include entries with actual results
          if (data.results && data.results.length > 0) {
            // Use stored targetName or try to find from targets prop
            const targetInfo = targets.find(t => t.id === targetId);
            loadedTargets.push({
              targetId,
              targetName: data.targetName || targetInfo?.name || targetId.substring(0, 12),
              results: data.results,
              aiMeta: data.aiMeta,
              timestamp: data.timestamp
            });
          }
        });
        
        // Sort by timestamp (most recent first)
        loadedTargets.sort((a, b) => b.timestamp - a.timestamp);
        setAvailableTargets(loadedTargets);
        
        // Set default selection to current target or first available
        if (currentTargetId && loadedTargets.some(t => t.targetId === currentTargetId)) {
          setSelectedTargetId(currentTargetId);
        } else if (loadedTargets.length > 0) {
          setSelectedTargetId(loadedTargets[0].targetId);
        }
      } else {
        // No cache - clear available targets
        setAvailableTargets([]);
        setSelectedTargetId(null);
      }
    } catch (e) {
      console.warn('Failed to load cached AI results:', e);
    }
  }, [currentTargetId, targets]);

  // Update available targets when current results change
  useEffect(() => {
    if (currentTargetId && currentResults.length > 0) {
      setAvailableTargets(prev => {
        const existing = prev.find(t => t.targetId === currentTargetId);
        if (existing) {
          // Update existing entry
          return prev.map(t => 
            t.targetId === currentTargetId 
              ? { ...t, results: currentResults, aiMeta: currentAiMeta, timestamp: Date.now() }
              : t
          );
        } else {
          // Add new entry
          return [{
            targetId: currentTargetId,
            targetName: currentTargetName,
            results: currentResults,
            aiMeta: currentAiMeta,
            timestamp: Date.now()
          }, ...prev];
        }
      });
      setSelectedTargetId(currentTargetId);
    }
  }, [currentTargetId, currentResults, currentTargetName, currentAiMeta]);

  const handleSave = async () => {
    if (!selectedTargetId || !token) {
      setSaveStatus('error');
      setMessage('No target selected');
      setTimeout(() => setSaveStatus('idle'), 3000);
      return;
    }

    const target = availableTargets.find(t => t.targetId === selectedTargetId);
    if (!target || target.results.length === 0) {
      setSaveStatus('error');
      setMessage('No AI results for selected target');
      setTimeout(() => setSaveStatus('idle'), 3000);
      return;
    }

    setIsSaving(true);
    setSaveStatus('idle');
    setMessage('');
    setShowOptions(false);

    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const safeName = target.targetName.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 30);

      const dataToDownload = {
        reportType: 'AI Security Analysis Report',
        generatedAt: new Date().toISOString(),
        targetId: target.targetId,
        targetName: target.targetName,
        meta: target.aiMeta,
        summary: {
          totalPackages: target.results.length,
          vulnerable: target.results.filter(r => r.status === 'VULNERABLE').length,
          clean: target.results.filter(r => r.status === 'CLEAN').length,
          unknown: target.results.filter(r => r.status === 'UNKNOWN').length,
        },
        packages: target.results.map(r => ({
          package: r.package,
          version: r.version,
          status: r.status,
          vulnCount: r.unique_vuln_count,
          exploitableCount: r.exploitable_count,
          severities: r.severities_found,
          llmSummary: r.llm_summary,
          runtimeExposure: r.runtime_exposure,
          networkInfo: r.network_info,
          structuredReport: r.structured_report
        }))
      };

      const filename = `ai-report-${safeName}-${timestamp}.json`;

      // Create blob and trigger download
      const blob = new Blob([JSON.stringify(dataToDownload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Track report generation
      if (onReportGenerated) {
        onReportGenerated();
      }

      // Also notify backend to increment report count
      try {
        await fetch('http://localhost:3001/api/reports/generated', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ targetId: target.targetId, reportType: 'full-report' })
        });
      } catch (e) {
        // Non-critical, ignore errors
      }

      setSaveStatus('success');
      setMessage('Report downloaded successfully');
      
      setTimeout(() => {
        setSaveStatus('idle');
        setMessage('');
      }, 3000);
    } catch (error: any) {
      console.error('Error saving AI results:', error);
      setSaveStatus('error');
      setMessage(error.message || 'Failed to download report');
      
      setTimeout(() => {
        setSaveStatus('idle');
        setMessage('');
      }, 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedTarget = availableTargets.find(t => t.targetId === selectedTargetId);
  const isDisabled = !token || availableTargets.length === 0;

  return (
    <div className="bg-secondary rounded-xl border border-gray-700 p-4">
      {/* Target Selector Dropdown */}
      <div className="relative w-full mb-3">
        <button
          onClick={() => !isDisabled && setShowOptions(!showOptions)}
          className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm w-full transition-colors ${
            isDisabled
              ? 'bg-gray-800 border border-gray-700 cursor-not-allowed text-gray-500'
              : 'bg-gray-850 border border-gray-600 text-white hover:border-accent'
          }`}
          disabled={isSaving || isDisabled}
        >
          <span className="truncate">
            {selectedTarget 
              ? `${selectedTarget.targetName} (${selectedTarget.results.length} packages)`
              : 'Select target to download'}
          </span>
          <ChevronDown className={`w-4 h-4 ml-2 flex-shrink-0 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
        </button>
        
        {showOptions && !isDisabled && (
          <>
            <div 
              className="fixed inset-0 z-10" 
              onClick={() => setShowOptions(false)}
            ></div>
            <div className="absolute z-20 w-full mt-1 bg-gray-850 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {availableTargets.map((target) => (
                <button
                  key={target.targetId}
                  onClick={() => {
                    setSelectedTargetId(target.targetId);
                    setShowOptions(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                    selectedTargetId === target.targetId
                      ? 'bg-accent/20 text-accent'
                      : 'text-white hover:bg-gray-700'
                  }`}
                >
                  <div className="font-medium truncate">{target.targetName}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {target.results.length} packages • {target.results.filter(r => r.status === 'VULNERABLE').length} vulnerable
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      
      {/* Download Button - Full Width Below */}
      <button
        onClick={handleSave}
        disabled={isSaving || isDisabled || !selectedTargetId}
        className={`w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
          isDisabled || !selectedTargetId
            ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
            : isSaving
            ? 'bg-gray-700 text-gray-400 cursor-wait'
            : saveStatus === 'success'
            ? 'bg-success hover:bg-success/80 text-white'
            : saveStatus === 'error'
            ? 'bg-error hover:bg-error/80 text-white'
            : 'bg-accent hover:bg-accent-dark text-white'
        }`}
      >
        {isSaving ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Downloading...</span>
          </>
        ) : saveStatus === 'success' ? (
          <>
            <CheckCircle className="w-4 h-4" />
            <span>Downloaded</span>
          </>
        ) : saveStatus === 'error' ? (
          <>
            <AlertCircle className="w-4 h-4" />
            <span>Failed</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            <span>Download Full Report</span>
          </>
        )}
      </button>
      
      {message && (
        <p className={`text-sm mt-3 text-center ${
          saveStatus === 'success' ? 'text-success' : 
          saveStatus === 'error' ? 'text-error' : 
          'text-gray-400'
        }`}>
          {message}
        </p>
      )}
      
      {availableTargets.length === 0 && (
        <p className="text-xs mt-2 text-center text-gray-500">
          Run AI analysis to enable report downloads.
        </p>
      )}
    </div>
  );
};

export default SaveAiResultsButton;
