import React, { useState, useEffect } from 'react';
import { Settings, Play, Pause, Square, Zap, Shield, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useScan } from '../../contexts/ScanContext';

interface ScanProfileProps {
  selectedTarget?: any;
  onScanStarted?: (scanId: string) => void;
  onScanStopped?: () => void;
  isScanning?: boolean;
  currentScanId?: string | null;
  className?: string;
}

const ScanManager: React.FC<ScanProfileProps> = ({ selectedTarget, onScanStarted, onScanStopped, isScanning, currentScanId: propScanId, className }) => {
  const [selectedProfile, setSelectedProfile] = useState('misconfigs');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanStatus, setScanStatus] = useState('idle'); // idle, running, paused, completed, failed, error
  const [currentScanId, setCurrentScanId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { token } = useAuth();
  const { addTarget, updateTargetStatus } = useScan();
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);

  const mapStatusToContext = (status: string): 'idle' | 'scanning' | 'completed' | 'failed' => {
    switch (status) {
      case 'running':
      case 'paused':
        return 'scanning';
      case 'completed':
      case 'completed_with_errors':
        return 'completed';
      case 'failed':
      case 'error':
        return 'failed';
      default:
        return 'idle';
    }
  };

  const registerScanTarget = () => {
    if (!selectedTarget?.id) return;
    const id = selectedTarget.id;
    const name = selectedTarget.name || selectedTarget.image || id.slice(0, 8);
    const type = selectedTarget.image ? 'image' : 'container';
    addTarget({
      id,
      name,
      type,
      status: 'scanning',
      vulns: 0,
      ip: selectedTarget.ip || null,
      image: selectedTarget.image || '',
      networks: selectedTarget.networks || [],
      ports: selectedTarget.ports || []
    });
    updateTargetStatus(id, 'scanning');
    setActiveTargetId(id);
  };

  // Sync scanStatus with isScanning prop from parent
  useEffect(() => {
    if (isScanning && scanStatus === 'idle') {
      setScanStatus('running');
    } else if (!isScanning && (scanStatus === 'running' || scanStatus === 'paused')) {
      // If isScanning becomes false and we're in running/paused, check if scan completed
      // This will be handled by the polling effect below
    }
  }, [isScanning, scanStatus]);

  // Poll scan status from backend when we have a scanId
  useEffect(() => {
    const scanIdToCheck = propScanId || currentScanId;
    const targetIdForContext = activeTargetId || selectedTarget?.id || null;
    if (!scanIdToCheck || !token) {
      // Reset to idle if no scanId
      if (!scanIdToCheck && scanStatus !== 'idle') {
        setScanStatus('idle');
      }
      return;
    }

    // Don't poll if scan is already completed/failed/error
    if (scanStatus === 'completed' || scanStatus === 'completed_with_errors' || scanStatus === 'failed' || scanStatus === 'error') {
      return;
    }

    let intervalId: NodeJS.Timeout | null = null;
    let isMounted = true;

    const fetchScanStatus = async () => {
      if (!isMounted) return;

      try {
        const response = await fetch(`http://localhost:3001/api/scan/${scanIdToCheck}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          if (isMounted && data.status) {
            const contextStatus = mapStatusToContext(data.status);
            // Update scanStatus based on backend status
            if (data.status === 'completed' || data.status === 'completed_with_errors' || data.status === 'failed' || data.status === 'error') {
              // Map 'completed_with_errors' to 'completed' for UI consistency
              setScanStatus(data.status === 'completed_with_errors' ? 'completed' : data.status);
              if (targetIdForContext) {
                updateTargetStatus(targetIdForContext, contextStatus);
              }
              setActiveTargetId(null);
              // Stop polling once completed
              if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
              }
            } else if (data.status === 'running' && scanStatus !== 'paused') {
              setScanStatus('running');
              if (targetIdForContext) {
                updateTargetStatus(targetIdForContext, contextStatus);
              }
            } else if (data.status === 'paused') {
              setScanStatus('paused');
              if (targetIdForContext) {
                updateTargetStatus(targetIdForContext, contextStatus);
              }
            }
          }
        } else if (response.status === 404) {
          // Scan doesn't exist in backend (server was restarted or scan was deleted)
          if (isMounted) {
            setScanStatus('idle');
            setCurrentScanId(null);
            if (targetIdForContext) {
              updateTargetStatus(targetIdForContext, 'idle');
            }
            // Clear from localStorage
            localStorage.removeItem('currentScanId');
            localStorage.setItem('isScanning', 'false');
            setActiveTargetId(null);
            // Stop polling
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
          }
        }
      } catch (error) {
        console.error('Error fetching scan status:', error);
        // On error, if we've been trying for a while, reset to idle
        // This handles cases where backend is down
      }
    };

    fetchScanStatus();
    intervalId = setInterval(fetchScanStatus, 3000); // Poll every 3 seconds

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [propScanId, currentScanId, token, scanStatus, activeTargetId, selectedTarget?.id, updateTargetStatus]);

  const profiles = [
    {
      id: 'misconfigs',
      name: 'Standard Scan',
      icon: Shield,
      description: 'Surface misconfigurations, outdated packages, exposed services, and Docker Scout image issues',
      color: 'text-success'
    },
    {
      id: 'deeper',
      name: 'Deeper Scan',
      icon: Search,
      description: 'Extended scan with Docker Scout supply-chain analysis and additional vulnerability checks',
      color: 'text-warning'
    }
  ];

  const handleStartScan = async () => {
    if (!selectedTarget || !token) {
      alert('Please select a target and ensure you are logged in');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/scan/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          targetId: selectedTarget.id,
          profile: selectedProfile
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          throw new Error(errorText || `HTTP ${response.status}: ${response.statusText}`);
        }
        throw new Error(errorData.error || 'Failed to start scan');
      }

      const result = await response.json();
      const newScanId = result.scanId;
      setCurrentScanId(newScanId);
      setScanStatus('running'); // Reset to running when starting new scan
      registerScanTarget();
      // Save to localStorage (parent will also save, but this ensures it's saved)
      localStorage.setItem('currentScanId', newScanId);
      localStorage.setItem('isScanning', 'true');
      onScanStarted?.(newScanId);
    } catch (error: any) {
      console.error('Start scan error:', error);
      alert(`Failed to start scan: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePauseScan = async () => {
    if (!currentScanId || !token) return;

    try {
      const response = await fetch(`http://localhost:3001/api/scan/${currentScanId}/pause`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          throw new Error(errorText || `HTTP ${response.status}: ${response.statusText}`);
        }
        throw new Error(errorData.error || 'Failed to pause scan');
      }

      setScanStatus('paused');
    } catch (error: any) {
      console.error('Pause scan error:', error);
      alert(`Failed to pause scan: ${error.message}`);
    }
  };

  const handleResumeScan = async () => {
    if (!currentScanId || !token) return;

    try {
      const response = await fetch(`http://localhost:3001/api/scan/${currentScanId}/resume`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          throw new Error(errorText || `HTTP ${response.status}: ${response.statusText}`);
        }
        throw new Error(errorData.error || 'Failed to resume scan');
      }

      setScanStatus('running');
    } catch (error: any) {
      console.error('Resume scan error:', error);
      alert(`Failed to resume scan: ${error.message}`);
    }
  };

  const handleStopScan = async () => {
    if (!currentScanId || !token) return;

    try {
      const response = await fetch(`http://localhost:3001/api/scan/${currentScanId}/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          throw new Error(errorText || `HTTP ${response.status}: ${response.statusText}`);
        }
        throw new Error(errorData.error || 'Failed to stop scan');
      }

      setScanStatus('idle');
      setCurrentScanId(null);
      onScanStopped?.(); // Notify parent to clear scanId
      const targetId = activeTargetId || selectedTarget?.id;
      if (targetId) {
        updateTargetStatus(targetId, 'idle');
      }
      setActiveTargetId(null);
    } catch (error: any) {
      console.error('Stop scan error:', error);
      alert(`Failed to stop scan: ${error.message}`);
    }
  };

  return (
    <div className={`bg-secondary rounded-xl border border-gray-700 p-6 space-y-6 flex flex-col ${className || ''}`}>
      {/* Scan Manager Section */}
      <div className="flex-1 flex flex-col">
        <h2 className="text-xl font-semibold text-white mb-2">Scan Manager</h2>
        <p className="text-sm text-gray-400 mb-4">
          Pick the scanning profile that best matches the depth and thoroughness you need.
        </p>
        
        {/* Target Selection Indicator */}
        {selectedTarget ? (
          <div className="mb-4 p-3 bg-gray-850 rounded-lg border border-gray-700">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-success rounded-full"></div>
              <span className="text-sm text-gray-300">
                Target: {selectedTarget.name} ({selectedTarget.ip})
              </span>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3 bg-gray-850 rounded-lg border border-gray-700">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
              <span className="text-sm text-gray-400">
                No target selected
              </span>
            </div>
          </div>
        )}
        
        {/* Scan Profile Selection */}
        <div className="space-y-3 mb-5">
          {profiles.map((profile) => (
            <label
              key={profile.id}
              className={`block p-4 rounded-lg border cursor-pointer transition-all duration-200 ${
                selectedProfile === profile.id
                  ? 'border-accent bg-accent/10'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
            >
              <input
                type="radio"
                name="scanProfile"
                value={profile.id}
                checked={selectedProfile === profile.id}
                onChange={(e) => setSelectedProfile(e.target.value)}
                className="sr-only"
              />
              <div className="flex items-start space-x-3">
                <profile.icon className={`w-5 h-5 mt-0.5 ${profile.color}`} />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-white font-medium">{profile.name}</h3>
                  </div>
                  <p className="text-gray-400 text-sm">{profile.description}</p>
                </div>
              </div>
            </label>
          ))}
        </div>
        {/* Advanced Settings Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="mt-3 flex items-center space-x-2 text-accent hover:text-accent-light transition-colors text-sm"
        >
          <Settings className="w-4 h-4" />
          <span>Advanced Settings</span>
        </button>
        
        {/* Advanced Settings Panel */}
        {showAdvanced && (
          <div className="mt-3 p-4 bg-gray-850 rounded-lg border border-gray-700 animate-fade-in">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Concurrent Threads
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  defaultValue="5"
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>1</span>
                  <span>10</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Timeout (seconds)
                </label>
                <input
                  type="number"
                  defaultValue="30"
                  className="w-full px-3 py-2 bg-secondary border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="aggressive"
                  className="w-4 h-4 text-accent border-gray-600 rounded focus:ring-accent focus:ring-2"
                />
                <label htmlFor="aggressive" className="text-sm text-gray-300">
                  Enable aggressive scanning
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="stealth"
                  defaultChecked
                  className="w-4 h-4 text-accent border-gray-600 rounded focus:ring-accent focus:ring-2"
                />
                <label htmlFor="stealth" className="text-sm text-gray-300">
                  Use stealth techniques
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Scan Control Section */}
      <div className="pt-4 border-t border-gray-700">
        <div className="flex flex-wrap gap-3">
          {scanStatus === 'idle' && (
            <button
              onClick={handleStartScan}
              disabled={isLoading || !selectedTarget}
              className="flex items-center space-x-2 px-6 py-3 bg-success hover:bg-success/80 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" />
              <span>{isLoading ? 'Starting...' : 'Start Scan'}</span>
            </button>
          )}
          {scanStatus === 'running' && (
            <>
              <button
                onClick={handlePauseScan}
                className="flex items-center space-x-2 px-6 py-3 bg-warning hover:bg-warning/80 text-white rounded-lg font-medium transition-colors"
              >
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </button>
              <button
                onClick={handleStopScan}
                className="flex items-center space-x-2 px-6 py-3 bg-error hover:bg-error/80 text-white rounded-lg font-medium transition-colors"
              >
                <Square className="w-4 h-4" />
                <span>Stop</span>
              </button>
            </>
          )}
          {scanStatus === 'paused' && (
            <>
              <button
                onClick={handleResumeScan}
                className="flex items-center space-x-2 px-6 py-3 bg-success hover:bg-success/80 text-white rounded-lg font-medium transition-colors"
              >
                <Play className="w-4 h-4" />
                <span>Resume</span>
              </button>
              <button
                onClick={handleStopScan}
                className="flex items-center space-x-2 px-6 py-3 bg-error hover:bg-error/80 text-white rounded-lg font-medium transition-colors"
              >
                <Square className="w-4 h-4" />
                <span>Stop</span>
              </button>
            </>
          )}
          {(scanStatus === 'completed' || scanStatus === 'failed' || scanStatus === 'error') && (
            <button
              onClick={handleStartScan}
              disabled={isLoading || !selectedTarget}
              className="flex items-center space-x-2 px-6 py-3 bg-success hover:bg-success/80 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" />
              <span>Start New Scan</span>
            </button>
          )}
        </div>
        {scanStatus !== 'idle' && (
          <div className="mt-4 p-3 bg-gray-850 rounded-lg border border-gray-700">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${
                scanStatus === 'completed' ? 'bg-success' :
                scanStatus === 'failed' || scanStatus === 'error' ? 'bg-error' :
                scanStatus === 'running' ? 'bg-success animate-pulse' : 'bg-warning'
              }`}></div>
              <span className="text-sm text-gray-300">
                {scanStatus === 'completed' && 'Scan completed successfully'}
                {scanStatus === 'failed' && 'Scan failed'}
                {scanStatus === 'error' && 'Scan error occurred'}
                {scanStatus === 'running' && 'Scan running - Actively scanning targets'}
                {scanStatus === 'paused' && 'Scan paused'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanManager;