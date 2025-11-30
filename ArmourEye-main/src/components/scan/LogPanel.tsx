import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Terminal, Download, X, ArrowDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface LogPanelProps {
  scanId?: string | null; // Allow null
  className?: string;
}

const LogPanel: React.FC<LogPanelProps> = ({ scanId, className }) => {
  const logRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<Array<{ id: number; timestamp: string; level: string; source: string; message: string; uniqueKey: string }>>([]);
  const [filter, setFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const seenLogKeysRef = useRef<Set<string>>(new Set());
  const isAtBottomRef = useRef(true); // Track if user is at bottom
  const { token } = useAuth();

  // Track previous scanId to detect when it changes
  const previousScanIdRef = useRef<string | null>(null);

  // Fetch real logs from API
  useEffect(() => {
    if (!scanId || !token) {
      // Don't clear logs immediately if scanId becomes null to prevent "disappearing" effect
      // only clear if we explicitly want to reset (handled by parent usually or on new scan)
      return;
    }

    // If scanId changed to a NEW ID, reset logs and seen keys
    if (previousScanIdRef.current !== null && previousScanIdRef.current !== scanId) {
      setLogs([]);
      seenLogKeysRef.current.clear();
    }
    previousScanIdRef.current = scanId;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let isMounted = true;

    const fetchLogs = async () => {
      if (!isMounted) return;
      
      // Don't set global loading on every poll to prevent UI flickering
      // setIsLoading(true); 
      
      try {
        const response = await fetch(`http://localhost:3001/api/scan/${scanId}/logs`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          if (isMounted && data.logs && data.logs.length > 0) {
             
            const newLogs: any[] = [];
            
            data.logs.forEach((log: any, index: number) => {
              const uniqueKey = `${log.timestamp}-${log.level}-${log.source}-${index}`;
              if (!seenLogKeysRef.current.has(uniqueKey)) {
                seenLogKeysRef.current.add(uniqueKey);
                newLogs.push({
                  id: index,
                  timestamp: new Date(log.timestamp).toLocaleTimeString(),
                  level: log.level || 'info',
                  source: log.source || 'unknown',
                  message: log.message,
                  uniqueKey: uniqueKey
                });
              }
            });

            if (newLogs.length > 0) {
              setLogs(prev => [...prev, ...newLogs]);
            }
          }
        } 
      } catch (error) {
        console.error('Error fetching logs:', error);
      }
    };

    fetchLogs();
    intervalId = setInterval(fetchLogs, 2000); // Poll every 2 seconds
    
    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [scanId, token]);

  // Smart Scroll Logic
  useEffect(() => {
    const div = logRef.current;
    if (div && isAtBottomRef.current) {
       // Only auto-scroll if the user was already at the bottom
       div.scrollTop = div.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    const div = logRef.current;
    if (!div) return;
    // Check if user is near bottom (within 50px)
    const isNearBottom = div.scrollHeight - div.scrollTop - div.clientHeight < 50;
    isAtBottomRef.current = isNearBottom;
  };

  const getLogColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'info': return 'text-gray-300';
      case 'warn':
      case 'warning': return 'text-warning';
      case 'error': return 'text-error';
      case 'success': return 'text-success';
      default: return 'text-gray-300';
    }
  };

  const getLogBg = (level: string) => {
    switch (level.toLowerCase()) {
      case 'info': return 'bg-gray-850/60 border-gray-700';
      case 'warn':
      case 'warning': return 'bg-warning/5 border-warning/30';
      case 'error': return 'bg-error/5 border-error/30';
      case 'success': return 'bg-success/5 border-success/30';
      default: return 'bg-gray-850/60 border-gray-700';
    }
  };

  const filteredLogs = useMemo(() => 
    logs.filter(log => {
      if (filter === 'all') return true;
      const logLevel = log.level.toLowerCase();
      if (filter === 'warn') return logLevel === 'warn' || logLevel === 'warning';
      return logLevel === filter.toLowerCase();
    }),
    [logs, filter]
  );

  const clearLogs = () => {
    setLogs([]);
    seenLogKeysRef.current.clear();
  };

  const downloadLogs = () => {
    const logText = logs.map(log => 
      `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`
    ).join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan-logs-${scanId || 'unknown'}-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`bg-secondary rounded-xl border border-gray-700 p-6 h-[600px] flex flex-col ${className || ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Terminal className="w-5 h-5 text-accent" />
          <h2 className="text-xl font-semibold text-white">Live Logs</h2>
        </div>
        
        <div className="flex items-center space-x-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-1 bg-gray-850 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-accent"
          >
            <option value="all">All Logs</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="success">Success</option>
          </select>
          
          <button onClick={clearLogs} className="p-2 text-gray-400 hover:text-white transition-colors" title="Clear logs">
            <X className="w-4 h-4" />
          </button>
          
          <button onClick={downloadLogs} className="p-2 text-gray-400 hover:text-white transition-colors" title="Download logs">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div 
        ref={logRef}
        className="flex-1 bg-gray-900 rounded-lg p-4 overflow-y-auto text-sm space-y-3 custom-scrollbar"
        onScroll={handleScroll}
      >
        {isLoading && logs.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50 animate-pulse" />
            <p>Connecting to log stream...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{scanId ? 'Waiting for output...' : 'Ready to scan'}</p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.uniqueKey} className={`p-3 rounded-lg border ${getLogBg(log.level)}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-500 font-mono">{log.timestamp}</span>
                <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${getLogColor(log.level)} bg-white/5`}>
                  {log.level}
                </span>
                <span className="text-cyan-200 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cyan/10 uppercase tracking-wide">
                  {log.source}
                </span>
              </div>
              <p className={`mt-2 text-[13px] leading-relaxed tracking-tight whitespace-pre-wrap break-words ${getLogColor(log.level)}`}>
                {log.message}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default React.memo(LogPanel);