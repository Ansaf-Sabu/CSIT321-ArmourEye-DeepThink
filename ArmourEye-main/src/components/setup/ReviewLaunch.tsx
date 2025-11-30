import React, { useState } from 'react';
import { Play, Container, Network, Plug, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ReviewLaunchProps {
  setupData: any;
  onPrev: () => void;
}

const ReviewLaunch: React.FC<ReviewLaunchProps> = ({ setupData, onPrev }) => {
  const [isLaunching, setIsLaunching] = useState(false);
  const [progress, setProgress] = useState(0);
  const navigate = useNavigate();

  const handleLaunch = async () => {
    setIsLaunching(true);
    
    // Simulate launch progress
    const steps = [
      'Creating networks...',
      'Building containers...',
      'Starting services...',
      'Configuring ports...',
      'Finalizing setup...'
    ];

    for (let i = 0; i < steps.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      setProgress(((i + 1) / steps.length) * 100);
    }

    // Navigate to scan page after completion
    setTimeout(() => {
      navigate('/scan');
    }, 1000);
  };

  const getNetworkNames = () => {
    if (setupData.networkConfig.type === 'single') {
      return ['default'];
    }
    return setupData.networkConfig.networks.map((n: any) => n.name);
  };

  const getTotalPorts = () => {
    return setupData.containerPlacements.reduce((total: number, placement: any) => 
      total + placement.ports.length, 0
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white mb-2">Review & Launch</h2>
        <p className="text-gray-400">Review your configuration and launch the environment</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-850 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-3">
            <Container className="w-6 h-6 text-accent" />
            <h3 className="text-lg font-medium text-white">Containers</h3>
          </div>
          <p className="text-2xl font-bold text-white">{setupData.images.length}</p>
          <p className="text-gray-400 text-sm">Images configured</p>
        </div>

        <div className="bg-gray-850 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-3">
            <Network className="w-6 h-6 text-cyan" />
            <h3 className="text-lg font-medium text-white">Networks</h3>
          </div>
          <p className="text-2xl font-bold text-white">{getNetworkNames().length}</p>
          <p className="text-gray-400 text-sm">Network segments</p>
        </div>

        <div className="bg-gray-850 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-3">
            <Plug className="w-6 h-6 text-success" />
            <h3 className="text-lg font-medium text-white">Ports</h3>
          </div>
          <p className="text-2xl font-bold text-white">{getTotalPorts()}</p>
          <p className="text-gray-400 text-sm">Port mappings</p>
        </div>
      </div>

      {/* Detailed Configuration */}
      <div className="bg-gray-850 rounded-xl p-6">
        <h3 className="text-lg font-medium text-white mb-4">Configuration Details</h3>
        
        <div className="space-y-6">
          {/* Network Configuration */}
          <div>
            <h4 className="text-md font-medium text-gray-300 mb-3">Networks</h4>
            <div className="space-y-2">
              {setupData.networkConfig.type === 'single' ? (
                <div className="flex items-center space-x-3 p-3 bg-secondary rounded-lg">
                  <Network className="w-4 h-4 text-cyan" />
                  <span className="text-white">Default Network</span>
                  <span className="text-gray-400 text-sm">Bridge mode</span>
                </div>
              ) : (
                setupData.networkConfig.networks.map((network: any) => (
                  <div key={network.id} className="flex items-center space-x-3 p-3 bg-secondary rounded-lg">
                    <Network className="w-4 h-4 text-cyan" />
                    <span className="text-white font-medium">{network.name}</span>
                    <span className="text-gray-400 text-sm">{network.cidr}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Container Placements */}
          <div>
            <h4 className="text-md font-medium text-gray-300 mb-3">Container Placements</h4>
            <div className="space-y-3">
              {setupData.containerPlacements.map((placement: any) => (
                <div key={placement.id} className="p-4 bg-secondary rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <Container className="w-4 h-4 text-accent" />
                      <span className="text-white font-medium">{placement.alias}</span>
                    </div>
                    <span className="text-gray-400 text-sm">{placement.imageName}</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Networks:</span>
                      <div className="mt-1">
                        {placement.selectedNetworks.length > 0 ? (
                          placement.selectedNetworks.map((network: string) => (
                            <span key={network} className="inline-block bg-cyan/20 text-cyan px-2 py-1 rounded text-xs mr-2">
                              {network}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500">None selected</span>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <span className="text-gray-400">Ports:</span>
                      <div className="mt-1">
                        {placement.ports.length > 0 ? (
                          placement.ports.map((port: any) => (
                            <span key={port.id} className="inline-block bg-success/20 text-success px-2 py-1 rounded text-xs mr-2">
                              {port.host}:{port.container}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500">No ports mapped</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Launch Section */}
      <div className="bg-gradient-to-r from-accent/10 to-cyan/10 border border-accent/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-white mb-2">Ready to Launch</h3>
            <p className="text-gray-400">Deploy your penetration testing environment</p>
          </div>
          <Zap className="w-8 h-8 text-accent" />
        </div>

        {isLaunching && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">Launching environment...</span>
              <span className="text-sm text-accent">{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-accent to-cyan h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>
        )}

        <div className="flex items-center space-x-4">
          <button
            onClick={onPrev}
            disabled={isLaunching}
            className="px-6 py-3 text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleLaunch}
            disabled={isLaunching}
            className="flex items-center space-x-3 px-8 py-3 bg-gradient-to-r from-accent to-cyan hover:from-accent-dark hover:to-cyan text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
          >
            <Play className="w-5 h-5" />
            <span>{isLaunching ? 'Launching...' : 'Launch Environment'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReviewLaunch;