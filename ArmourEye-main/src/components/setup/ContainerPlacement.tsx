import React, { useState } from 'react';
import { Plus, Trash2, Container } from 'lucide-react';

interface ContainerPlacementProps {
  setupData: any;
  setSetupData: (data: any) => void;
  onNext: () => void;
  onPrev: () => void;
}

const ContainerPlacement: React.FC<ContainerPlacementProps> = ({ setupData, setSetupData, onNext, onPrev }) => {
  const [placements, setPlacements] = useState(
    setupData.containerPlacements.length > 0 
      ? setupData.containerPlacements 
      : setupData.images.map((image: any) => ({
          id: Date.now() + Math.random(),
          imageId: image.id,
          imageName: image.name,
          alias: '',
          selectedNetworks: [],
          ports: []
        }))
  );

  const updatePlacement = (id: number, field: string, value: any) => {
    setPlacements(placements.map(placement => 
      placement.id === id ? { ...placement, [field]: value } : placement
    ));
  };

  const addPort = (placementId: number) => {
    setPlacements(placements.map(placement => 
      placement.id === placementId 
        ? { 
            ...placement, 
            ports: [...placement.ports, { id: Date.now(), host: '', container: '' }]
          } 
        : placement
    ));
  };

  const updatePort = (placementId: number, portId: number, field: string, value: string) => {
    setPlacements(placements.map(placement => 
      placement.id === placementId 
        ? {
            ...placement,
            ports: placement.ports.map((port: any) => 
              port.id === portId ? { ...port, [field]: value } : port
            )
          }
        : placement
    ));
  };

  const removePort = (placementId: number, portId: number) => {
    setPlacements(placements.map(placement => 
      placement.id === placementId 
        ? {
            ...placement,
            ports: placement.ports.filter((port: any) => port.id !== portId)
          }
        : placement
    ));
  };

  const handleNetworkSelect = (placementId: number, networkName: string, checked: boolean) => {
    setPlacements(placements.map(placement => 
      placement.id === placementId 
        ? {
            ...placement,
            selectedNetworks: checked 
              ? [...placement.selectedNetworks, networkName]
              : placement.selectedNetworks.filter((n: string) => n !== networkName)
          }
        : placement
    ));
  };

  const handleNext = () => {
    setSetupData({
      ...setupData,
      containerPlacements: placements
    });
    onNext();
  };

  const availableNetworks = setupData.networkConfig.type === 'multiple' 
    ? setupData.networkConfig.networks.map((n: any) => n.name).filter((name: string) => name.trim())
    : ['default'];

  const canProceed = () => {
    return placements.every(placement => placement.alias.trim());
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white mb-2">Container Placement</h2>
        <p className="text-gray-400">Configure aliases, network assignments, and port mappings</p>
      </div>

      <div className="space-y-6">
        {placements.map((placement, index) => (
          <div key={placement.id} className="bg-gray-850 rounded-xl p-6">
            <div className="flex items-center space-x-3 mb-6">
              <Container className="w-6 h-6 text-accent" />
              <h3 className="text-lg font-medium text-white">
                {placement.imageName}
              </h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Container Alias */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Container Alias *
                </label>
                <input
                  type="text"
                  placeholder="e.g., web-server"
                  value={placement.alias}
                  onChange={(e) => updatePlacement(placement.id, 'alias', e.target.value)}
                  className="w-full px-3 py-2 bg-secondary border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-accent"
                />
                <p className="text-gray-500 text-xs mt-1">
                  Friendly name for this container instance
                </p>
              </div>

              {/* Network Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Network Assignment
                </label>
                <div className="space-y-2">
                  {availableNetworks.map((network) => (
                    <label key={network} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={placement.selectedNetworks.includes(network)}
                        onChange={(e) => handleNetworkSelect(placement.id, network, e.target.checked)}
                        className="w-4 h-4 text-accent border-gray-600 rounded focus:ring-accent focus:ring-2"
                      />
                      <span className="text-gray-300 text-sm">{network}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Port Mappings */}
            <div className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-medium text-gray-300">
                  Port Mappings
                </label>
                <button
                  onClick={() => addPort(placement.id)}
                  className="flex items-center space-x-2 px-3 py-1 bg-accent hover:bg-accent-dark text-white text-sm rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Port</span>
                </button>
              </div>

              {placement.ports.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  No port mappings configured
                </div>
              ) : (
                <div className="space-y-3">
                  {placement.ports.map((port: any) => (
                    <div key={port.id} className="flex items-center space-x-3 p-3 bg-secondary rounded-lg">
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <div>
                          <input
                            type="text"
                            placeholder="Host port"
                            value={port.host}
                            onChange={(e) => updatePort(placement.id, port.id, 'host', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-accent"
                          />
                        </div>
                        <div>
                          <input
                            type="text"
                            placeholder="Container port"
                            value={port.container}
                            onChange={(e) => updatePort(placement.id, port.id, 'container', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-accent"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removePort(placement.id, port.id)}
                        className="flex-shrink-0 p-2 text-gray-400 hover:text-error transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={onPrev}
          className="px-6 py-3 text-gray-400 hover:text-white transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={!canProceed()}
          className="px-6 py-3 bg-accent hover:bg-accent-dark disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
        >
          Continue to Review
        </button>
      </div>
    </div>
  );
};

export default ContainerPlacement;