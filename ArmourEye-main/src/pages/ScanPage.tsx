import React, { useState, useEffect } from 'react';
import TargetList from '../components/scan/TargetList';
import ScanManager from '../components/scan/ScanProfile';
import LogPanel from '../components/scan/LogPanel';
import ProgressTracker from '../components/scan/ProgressTracker';
import SaveResultsButton from '../components/scan/SaveResultsButton';
import { useAuth } from '../contexts/AuthContext';
import { Radar, Activity, ShieldCheck } from 'lucide-react';

const ScanPage: React.FC = () => {
  const [selectedTarget, setSelectedTarget] = useState<any>(null);
  const { token } = useAuth();
  
  // Restore currentScanId from localStorage on mount
  const [currentScanId, setCurrentScanId] = useState<string | null>(() => {
    const saved = localStorage.getItem('currentScanId');
    return saved || null;
  });
  
  // New state to track if a scan is active vs. just showing results
  const [isScanning, setIsScanning] = useState(false);

  // Restore scan state from localStorage on mount and verify with backend
  useEffect(() => {
    const savedScanId = localStorage.getItem('currentScanId');
    const savedIsScanning = localStorage.getItem('isScanning') === 'true';
    
    if (savedScanId) {
      setCurrentScanId(savedScanId);
      
      // Verify with backend that the scan actually exists and is still active
      // This is important after server restarts
      const verifyScanStatus = async () => {
        try {
          if (!token) {
            // No token, reset state
            setIsScanning(false);
            localStorage.setItem('isScanning', 'false');
            return;
          }
          
          const response = await fetch(`http://localhost:3001/api/scan/${savedScanId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (response.ok) {
            const data = await response.json();
            // Only set isScanning to true if backend says scan is actually running
            if (data.status === 'running' || data.status === 'paused') {
              setIsScanning(true);
              localStorage.setItem('isScanning', 'true');
            } else {
              // Scan exists but is completed/failed/error
              setIsScanning(false);
              localStorage.setItem('isScanning', 'false');
            }
          } else if (response.status === 404) {
            // Scan doesn't exist in backend (server was restarted)
            setIsScanning(false);
            localStorage.setItem('isScanning', 'false');
            // Clear the scanId from localStorage since it doesn't exist anymore
            localStorage.removeItem('currentScanId');
            setCurrentScanId(null);
          } else {
            // Other error, reset to safe state
            setIsScanning(false);
            localStorage.setItem('isScanning', 'false');
          }
        } catch (error) {
          console.error('Error verifying scan status on mount:', error);
          // On error, reset to safe state
          setIsScanning(false);
          localStorage.setItem('isScanning', 'false');
        }
      };
      
      verifyScanStatus();
    } else {
      // No saved scan, ensure state is clean
      setIsScanning(false);
      localStorage.setItem('isScanning', 'false');
    }
  }, [token]);

  const handleTargetSelect = (target: any) => {
    setSelectedTarget(target);
  };

  const handleScanStarted = (scanId: string) => {
    setCurrentScanId(scanId);
    setIsScanning(true);
    // Persist scanId to localStorage so it survives page navigation
    localStorage.setItem('currentScanId', scanId);
    localStorage.setItem('isScanning', 'true');
  };

  const handleScanStopped = () => {
    // User manually stopped
    setIsScanning(false);
    localStorage.setItem('isScanning', 'false');
    // Do NOT set currentScanId to null, so we can see the "Stopped" logs
    // Keep currentScanId in localStorage so logs remain visible
  };
  
  // Called by ProgressTracker when backend reports completion/failure
  const handleStatusChange = (status: string) => {
      if (status === 'completed' || status === 'completed_with_errors' || status === 'failed' || status === 'error') {
          setIsScanning(false);
          localStorage.setItem('isScanning', 'false');
          // Keep currentScanId in localStorage so completed scan data remains visible
      }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-850 to-gray-900 border border-gray-700 rounded-2xl p-8 shadow-2xl shadow-black/20">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
          <div>
            <div className="flex items-center space-x-3 text-accent mb-3">
              <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
                <Radar className="w-5 h-5" />
              </div>
              <span className="text-sm font-semibold tracking-wide uppercase">Scan Control</span>
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold text-white mb-3">Orchestrate Deep Security Scans</h1>
            <p className="text-gray-300 text-base max-w-3xl">
              Launch coordinated reconnaissance, vulnerability, and supply-chain analysis across your staged targets.
              Track every phase in real time while ArmourEye keeps logs and results perfectly aligned.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-900/60 rounded-xl border border-gray-700 p-4 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-300">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wide">Live Telemetry</p>
                <p className="text-white font-semibold">Progress + Logs</p>
              </div>
            </div>
            <div className="bg-gray-900/60 rounded-xl border border-gray-700 p-4 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-300">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wide">Tool Stack</p>
                <p className="text-white font-semibold">Trivy, Scout, Nmap</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Row */}
      <div className="grid gap-6 xl:grid-cols-12 items-stretch">
        <div className="xl:col-span-5 flex flex-col">
          <TargetList onTargetSelect={handleTargetSelect} className="h-full" />
        </div>

        <div className="xl:col-span-7 flex flex-col gap-6 h-full">
          <div className="flex-1 flex flex-col">
            <ScanManager 
              selectedTarget={selectedTarget} 
              onScanStarted={handleScanStarted}
              onScanStopped={handleScanStopped}
              isScanning={isScanning}
              currentScanId={currentScanId}
              className="h-full"
            />
          </div>
          <SaveResultsButton scanId={currentScanId} targetName={selectedTarget?.name || selectedTarget?.image} />
        </div>
      </div>

      {/* Monitoring Row */}
      <div className="grid gap-6 xl:grid-cols-12 items-stretch">
        <div className="xl:col-span-5 flex flex-col">
          <ProgressTracker 
            scanId={currentScanId} 
            onStatusChange={handleStatusChange} 
            className="h-[600px]"
          />
        </div>

        <div className="xl:col-span-7 flex flex-col">
          <LogPanel scanId={currentScanId} />
        </div>
      </div>
    </div>
  );
};

export default ScanPage;