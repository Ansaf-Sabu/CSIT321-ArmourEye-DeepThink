import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CheckCircle, Circle, Clock, Zap, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface ProgressTrackerProps {
  scanId?: string | null; // Allow null
  onStatusChange?: (status: string) => void; // NEW: Callback to notify parent
  className?: string;
}

const ProgressTracker: React.FC<ProgressTrackerProps> = ({ scanId, onStatusChange, className }) => {
  const [scanData, setScanData] = useState<any>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const previousDataRef = useRef<string>('');
  const { token } = useAuth();

  const defaultSteps = [
    { id: 1, name: 'Initial Assessment', status: 'pending', description: 'Analyzing target and planning scan strategy' },
    { id: 2, name: 'Network Scan', status: 'pending', description: 'Scanning ports and services with Nmap' },
    { id: 3, name: 'Tool Execution', status: 'pending', description: 'Running security scanners (Trivy, Docker Scout, Nikto, etc.)' },
    { id: 4, name: 'Finalizing', status: 'pending', description: 'Aggregating results and generating report' },
  ];

  useEffect(() => {
    if (!scanId || !token) {
      // Do not reset scanData immediately to keep the UI visible after stop
      // setScanData(null);
      setIsInitialLoading(false);
      return;
    }
    
    // Reset loading state when a new scan starts (but only if we don't have data for this scanId)
    if (!scanData || (scanData.scanId !== scanId && scanId)) {
      setIsInitialLoading(true);
    }

    let intervalId: NodeJS.Timeout | null = null;
    let isMounted = true;

    const fetchScanData = async () => {
      if (!isMounted) return;
      
      try {
        const response = await fetch(`http://localhost:3001/api/scan/${scanId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          if (isMounted) {
            const dataString = JSON.stringify(data);
            if (dataString !== previousDataRef.current) {
              previousDataRef.current = dataString;
              setScanData(data);
              setIsInitialLoading(false);
              
              // Notify parent if scan is done
              if (onStatusChange && (data.status === 'completed' || data.status === 'completed_with_errors' || data.status === 'failed' || data.status === 'error')) {
                onStatusChange(data.status);
              }
            }
          }
        } 
      } catch (error) {
        console.error('Error fetching scan data:', error);
        if (isMounted) {
          setIsInitialLoading(false);
        }
      }
    };

    fetchScanData();
    intervalId = setInterval(fetchScanData, 3000);
    
    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [scanId, token, onStatusChange]);

  const steps = useMemo(() => {
    if (!scanData) return defaultSteps;

    const phases = [
      { id: 1, name: 'Initial Assessment', phase: 'analysis' },
      { id: 2, name: 'Network Scan', phase: 'reconnaissance' },
      { id: 3, name: 'Tool Execution', phase: 'vulnerability_scanning' },
      { id: 4, name: 'Finalizing', phase: 'finalizing' }
    ];

    return phases.map(phase => {
      let status = 'pending';
      
      // Check if phase is completed in history
      if (scanData.phases && scanData.phases.some((p: any) => p.phase === phase.phase && p.status === 'completed')) {
        status = 'completed';
      }
      // Check if failed
      else if (scanData.phases && scanData.phases.some((p: any) => p.phase === phase.phase && p.status === 'failed')) {
        status = 'failed';
      }
      // Check current
      else if (scanData.currentPhase === phase.phase) {
        status = 'current';
      }

      // Descriptions mapping
      const descriptions: { [key: string]: string } = {
        'analysis': 'Analyzing target and planning scan strategy',
        'reconnaissance': 'Scanning ports and services with Nmap',
        'vulnerability_scanning': 'Running security scanners (Trivy, Docker Scout, Nikto, etc.)',
        'finalizing': 'Aggregating results and generating report'
      };

      return {
        id: phase.id,
        name: phase.name,
        status: status,
        description: descriptions[phase.phase] || 'Processing...'
      };
    });
  }, [scanData]);

  const getStepIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-6 h-6 text-success" />;
      case 'failed': return <AlertTriangle className="w-6 h-6 text-error" />;
      case 'current': return <Zap className="w-6 h-6 text-accent animate-pulse" />;
      default: return <Circle className="w-6 h-6 text-gray-600" />;
    }
  };

  const getStepColor = (status: string) => {
    switch (status) {
      case 'completed': return 'border-success bg-success/10';
      case 'failed': return 'border-error bg-error/10';
      case 'current': return 'border-accent bg-accent/10';
      default: return 'border-gray-600';
    }
  };

  // FIX: Count failed steps as "processed" so the bar fills up
  const completedSteps = useMemo(() => 
    steps.filter(step => step.status === 'completed' || step.status === 'failed').length,
    [steps]
  );
  
  // Use backend progress if available, else calculate based on steps
  const progressPercentage = useMemo(() => 
    scanData ? scanData.progress : 0,
    [scanData]
  );

  return (
    <div className={`bg-secondary rounded-xl border border-gray-700 p-6 flex flex-col overflow-hidden ${className || ''}`}>
      <div className="flex items-center space-x-2 mb-5">
        <Clock className="w-5 h-5 text-accent" />
        <h2 className="text-xl font-semibold text-white">Scan Progress</h2>
        <span
          className={`ml-auto text-xs font-medium px-2.5 py-1 rounded ${
            scanData
              ? scanData.status === 'completed'
                ? 'text-success bg-success/10 border border-success/20'
                : scanData.status === 'error' || scanData.status === 'failed'
                  ? 'text-error bg-error/10 border border-error/20'
                  : 'text-gray-400 bg-gray-850 border border-gray-700'
              : !scanId
                ? 'text-gray-400 bg-gray-850 border border-gray-700'
                : 'text-accent bg-accent/10 border border-accent/20'
          }`}
        >
          {scanData
            ? scanData.status.toUpperCase()
            : !scanId
              ? 'IDLE'
              : isInitialLoading
                ? 'INITIALIZING'
                : 'PENDING'}
        </span>
      </div>

      <div className="mb-5">
        {!scanId ? (
          <div className="mb-3 p-4 bg-gray-850 rounded-lg border border-gray-700 text-center">
            <span className="text-sm text-gray-300">
              No active scan. Select a target and start a scan to see progress.
            </span>
          </div>
        ) : isInitialLoading && !scanData ? (
          <div className="mb-3 p-4 bg-gray-850 rounded-lg border border-gray-700 text-center">
            <span className="text-sm text-gray-300">Initializing scan...</span>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        {steps.map((step, index) => (
          <div key={step.id} className="relative">
            <div className={`flex items-start p-4 rounded-lg border transition-all duration-200 ${getStepColor(step.status)}`}>
              <div className="flex-shrink-0 mt-0.5">
                {getStepIcon(step.status)}
              </div>
              
              <div className="ml-4 flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-white text-sm">{step.name}</h3>
                  {step.status === 'current' && (
                    <span className="text-xs text-accent font-medium">In Progress</span>
                  )}
                  {step.status === 'completed' && (
                    <span className="text-xs text-success font-medium">Complete</span>
                  )}
                  {step.status === 'failed' && (
                    <span className="text-xs text-error font-medium">Failed</span>
                  )}
                </div>
                <p className="text-gray-400 text-xs leading-relaxed">{step.description}</p>
                
                {step.status === 'current' && (
                  <div className="mt-3">
                    <div className="w-full bg-gray-700 rounded-full h-1.5">
                      <div className="bg-accent h-1.5 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className="absolute left-[1.75rem] top-[4.25rem] w-0.5 h-5 bg-gray-600"></div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 pt-6 border-t border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-300 font-medium text-sm">Overall Progress</span>
          <span className="text-accent font-bold text-xl">{progressPercentage || 0}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden relative">
          <div 
            className={`h-3 rounded-full transition-all duration-500 ${
                scanData?.status === 'failed' ? 'bg-error' : 'bg-gradient-to-r from-accent to-success'
            }`}
            style={{ width: `${Math.max(progressPercentage || 0, 0)}%`, minWidth: '0%' }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ProgressTracker);