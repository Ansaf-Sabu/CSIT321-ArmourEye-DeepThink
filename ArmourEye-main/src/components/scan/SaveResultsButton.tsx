import React, { useState } from 'react';
import { Download, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface SaveResultsButtonProps {
  scanId?: string | null;
  targetName?: string | null;
}

type DownloadType = 'combined' | 'image-scanner' | 'runtime-scanner';

// Helper to sanitize filename (remove invalid characters)
const sanitizeFilename = (name: string): string => {
  return name
    .replace(/[<>:"/\\|?*]/g, '-') // Replace invalid chars with dash
    .replace(/\s+/g, '_')          // Replace spaces with underscore
    .replace(/-+/g, '-')           // Collapse multiple dashes
    .replace(/^-|-$/g, '')         // Remove leading/trailing dashes
    .substring(0, 50);             // Limit length
};

const SaveResultsButton: React.FC<SaveResultsButtonProps> = ({ scanId, targetName }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [showOptions, setShowOptions] = useState(false);
  const [downloadType, setDownloadType] = useState<DownloadType>('combined');
  const { token } = useAuth();

  const handleSave = async (type: DownloadType = downloadType) => {
    if (!scanId || !token) {
      setSaveStatus('error');
      setMessage('No scan selected or not logged in');
      setTimeout(() => setSaveStatus('idle'), 3000);
      return;
    }

    setIsSaving(true);
    setSaveStatus('idle');
    setMessage('');
    setShowOptions(false);

    try {
      // Use target name if available, otherwise fall back to scanId
      const fileBaseName = targetName ? sanitizeFilename(targetName) : scanId;
      
      // Determine endpoint based on download type
      let endpoint = `http://localhost:3001/api/scan/${scanId}/results`;
      let filename = `scan-results-${fileBaseName}.json`;
      
      if (type === 'image-scanner') {
        endpoint = `http://localhost:3001/api/scan/${scanId}/results/image-scanner`;
        filename = `image-scanner-results-${fileBaseName}.json`;
      } else if (type === 'runtime-scanner') {
        endpoint = `http://localhost:3001/api/scan/${scanId}/results/runtime-scanner`;
        filename = `runtime-scanner-results-${fileBaseName}.json`;
      }

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to get results' }));
        throw new Error(errorData.error || 'Failed to get scan results');
      }

      const data = await response.json();
      
      // Create a blob and trigger download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Track report download
      try {
        await fetch('http://localhost:3001/api/reports/generated', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ scanId, reportType: type })
        });
      } catch (e) {
        // Non-critical, ignore errors
      }
      
      setSaveStatus('success');
      setMessage('Results downloaded successfully');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSaveStatus('idle');
        setMessage('');
      }, 3000);
    } catch (error: any) {
      console.error('Error saving scan results:', error);
      setSaveStatus('error');
      setMessage(error.message || 'Failed to download scan results');
      
      // Clear error message after 5 seconds
      setTimeout(() => {
        setSaveStatus('idle');
        setMessage('');
      }, 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const downloadOptions = [
    { value: 'combined', label: 'Combined (All Results)' },
    { value: 'image-scanner', label: 'Image Scanner Only' },
    { value: 'runtime-scanner', label: 'Runtime Scanner Only' }
  ];
  const isDisabled = !scanId || !token;

  return (
    <div className="bg-secondary rounded-xl border border-gray-700 p-4">
      <div className="flex items-center space-x-3">
        {/* Download Type Selector - Compact */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => !isDisabled && setShowOptions(!showOptions)}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm min-w-[180px] transition-colors ${
              isDisabled
                ? 'bg-gray-800 border border-gray-700 cursor-not-allowed text-gray-500'
                : 'bg-gray-850 border border-gray-600 text-white hover:border-accent'
            }`}
            disabled={isSaving || isDisabled}
          >
            <span className="truncate">{downloadOptions.find(opt => opt.value === downloadType)?.label || 'Combined (All Results)'}</span>
            <ChevronDown className={`w-4 h-4 ml-2 flex-shrink-0 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
          </button>
          
          {showOptions && !isDisabled && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowOptions(false)}
              ></div>
              <div className="absolute z-20 w-full mt-1 bg-gray-850 border border-gray-600 rounded-lg shadow-lg">
                {downloadOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setDownloadType(option.value as DownloadType);
                      setShowOptions(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      downloadType === option.value
                        ? 'bg-accent/20 text-accent'
                        : 'text-white hover:bg-gray-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        
        {/* Download Button */}
        <button
          onClick={() => handleSave(downloadType)}
          disabled={isSaving || isDisabled}
          className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            isDisabled
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
              <span>Download Results</span>
            </>
          )}
        </button>
      </div>
      
      {message && (
        <p className={`text-sm mt-3 text-center ${
          saveStatus === 'success' ? 'text-success' : 
          saveStatus === 'error' ? 'text-error' : 
          'text-gray-400'
        }`}>
          {message}
        </p>
      )}
      
      {!scanId && (
        <p className="text-xs mt-2 text-center text-gray-500">
          Start a scan to enable result downloads.
        </p>
      )}
    </div>
  );
};

export default SaveResultsButton;

