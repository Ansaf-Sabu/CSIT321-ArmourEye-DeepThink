import React, { useState, useEffect } from 'react';
import { Target, Network, Plug, CheckSquare, Square, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface TargetItem {
  id: string;
  name?: string;
  image?: string;
  status?: string;
  networks?: string[];
  ports?: string[];
  ip?: string | null;
}

interface TargetListProps {
  onTargetSelect?: (target: TargetItem) => void;
  className?: string;
}

const TargetList: React.FC<TargetListProps> = ({ onTargetSelect, className }) => {
  const [targets, setTargets] = useState<TargetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTarget, setSelectedTarget] = useState<TargetItem | null>(null);
  const [removingTargets, setRemovingTargets] = useState<Set<string>>(new Set());
  const { token } = useAuth();

  // Fetch targets from API
  useEffect(() => {
    const fetchTargets = async () => {
      try {
        if (!token) return;
        
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        try {
          const response = await fetch('http://localhost:3001/api/targets', {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data: TargetItem[] = await response.json();
            setTargets(data);

            // Persist and restore selection across tab changes
            const persistedId = localStorage.getItem('selectedTargetId');

            // If we have a persisted selection and nothing selected yet, restore it
            if (!selectedTarget && persistedId) {
              const found = data.find(t => t.id === persistedId);
              if (found) {
                setSelectedTarget(found);
                onTargetSelect?.(found);
                return;
              }
            }

            // If current selection disappeared from list, clear it
            if (selectedTarget && !data.find(t => t.id === selectedTarget.id)) {
              setSelectedTarget(null);
              localStorage.removeItem('selectedTargetId');
            }

            // If nothing selected, auto-select the first target
            if (!selectedTarget && data.length > 0) {
              setSelectedTarget(data[0]);
              localStorage.setItem('selectedTargetId', data[0].id);
              onTargetSelect?.(data[0]);
            }
          } else {
            // Handle non-OK responses
            const errorText = await response.text();
            console.error('Failed to fetch targets:', errorText);
          }
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error: any) {
        // Better error handling
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          console.error('Error fetching targets: Backend server may not be running at http://localhost:3001');
        } else if (error.name === 'AbortError') {
          console.error('Error fetching targets: Request timeout');
        } else {
          console.error('Error fetching targets:', error.message || error);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTargets();
    const interval = setInterval(fetchTargets, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [token]);

  const isScannableTarget = (target: TargetItem) => {
    const name = target.name?.toLowerCase() || '';
    return !name.startsWith('armoureye-main-');
  };

  const handleTargetClick = (target: TargetItem, e: React.MouseEvent) => {
    // Don't select if clicking the remove button
    if ((e.target as HTMLElement).closest('.remove-button')) {
      return;
    }
    setSelectedTarget(target);
    localStorage.setItem('selectedTargetId', target.id);
    onTargetSelect?.(target);
  };

  const handleRemoveTarget = async (target: TargetItem, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!token) {
      alert('Please log in to remove targets');
      return;
    }
    
    if (!confirm(`Are you sure you want to stop and remove the container "${target.name || target.id}"?`)) {
      return;
    }
    
    setRemovingTargets(prev => new Set(prev).add(target.id));
    
    try {
      const response = await fetch(`http://localhost:3001/api/containers/${target.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        // Remove from local state
        setTargets(prev => prev.filter(t => t.id !== target.id));
        
        // Clear selection if this was the selected target
        if (selectedTarget?.id === target.id) {
          setSelectedTarget(null);
          localStorage.removeItem('selectedTargetId');
          onTargetSelect?.(null as any);
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Failed to remove container' }));
        alert(`Failed to remove container: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error removing container:', error);
      alert(`Error removing container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRemovingTargets(prev => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  };

  return (
    <div className={`bg-secondary rounded-xl border border-gray-700 p-6 flex flex-col ${className || ''}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold text-white">Target Selection</h2>
        {loading && (
          <div className="flex items-center space-x-2 text-gray-400">
            <div className="w-2 h-2 bg-accent rounded-full animate-pulse"></div>
            <span className="text-sm">Loading...</span>
          </div>
        )}
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Select one of your uploaded container images to prepare it for scanning.
      </p>

      {loading ? (
        <div className="text-center text-gray-500 py-8">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Loading targets...</p>
        </div>
        ) : targets.filter(isScannableTarget).length === 0 ? (
        <div className="text-center text-gray-500 py-8">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No targets available</p>
          <p className="text-sm text-gray-400 mt-1">Upload and run Docker images to see targets</p>
        </div>
      ) : (
      <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
        {targets.filter(isScannableTarget).map((target) => (
          <div
            key={target.id}
            className={`p-4 rounded-lg border transition-all duration-200 cursor-pointer ${
                selectedTarget?.id === target.id
                ? 'border-accent bg-accent/10'
                : 'border-gray-600 hover:border-gray-500'
            }`}
              onClick={(e) => handleTargetClick(target, e)}
          >
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-1">
                {selectedTarget?.id === target.id ? (
                  <CheckSquare className="w-5 h-5 text-accent" />
                ) : (
                  <Square className="w-5 h-5 text-gray-400" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Target className="w-4 h-4 text-accent" />
                    <span className="text-white font-medium">{target.name || target.id}</span>
                    <div className={`w-2 h-2 rounded-full ${
                      target.status === 'running' ? 'bg-success animate-pulse' : 'bg-gray-500'
                    }`}></div>
                  </div>
                  <button
                    onClick={(e) => handleRemoveTarget(target, e)}
                    disabled={removingTargets.has(target.id)}
                    className="remove-button flex-shrink-0 p-1 text-gray-400 hover:text-error transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Stop and remove container"
                  >
                    {removingTargets.has(target.id) ? (
                      <div className="w-4 h-4 border-2 border-error border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                  </button>
                </div>
                
                <div className="space-y-1 text-sm">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-400">IP:</span>
                    <span className="text-white font-mono">{target.ip || 'No IP'}</span>
                  </div>
                  
                  {target.networks && target.networks.length > 0 && (
                  <div className="flex items-center space-x-2">
                    <Network className="w-3 h-3 text-cyan" />
                    <span className="text-gray-400">Networks:</span>
                    <div className="flex space-x-1">
                        {target.networks.map((network: string) => (
                        <span key={network} className="bg-cyan/20 text-cyan px-2 py-0.5 rounded text-xs">
                          {network}
                        </span>
                      ))}
                    </div>
                  </div>
                  )}
                  
                  {target.ports && target.ports.length > 0 && (
                  <div className="flex items-center space-x-2">
                    <Plug className="w-3 h-3 text-success" />
                    <span className="text-gray-400">Ports:</span>
                    <div className="flex space-x-1">
                        {target.ports.map((port: string) => (
                        <span key={port} className="bg-success/20 text-success px-2 py-0.5 rounded text-xs font-mono">
                          {port}
                        </span>
                      ))}
                    </div>
                  </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {selectedTarget && (
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">
              Selected: {selectedTarget.name || selectedTarget.id}
          </span>
          <span className="text-accent">
              Ready for scanning
          </span>
        </div>
      </div>
      )}
    </div>
  );
};

export default TargetList;