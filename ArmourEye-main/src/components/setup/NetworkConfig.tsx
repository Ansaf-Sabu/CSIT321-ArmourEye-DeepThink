import React, { useState } from 'react';
import { Plus, Trash2, Network } from 'lucide-react';

interface NetworkConfigProps {
  setupData: any;
  setSetupData: (data: any) => void;
  onNext: () => void;
  onPrev: () => void;
}

const NetworkConfig: React.FC<NetworkConfigProps> = ({ setupData, setSetupData, onNext, onPrev }) => {
  const [networkType, setNetworkType] = useState(setupData.networkConfig.type || 'single');
  const [networks, setNetworks] = useState(setupData.networkConfig.networks || []);

  const addNetwork = () => {
    const newNetwork = {
      id: Date.now(),
      name: '',
      cidr: '',
    };
    setNetworks([...networks, newNetwork]);
  };

  const updateNetwork = (id: number, field: string, value: string) => {
    setNetworks(networks.map(network => 
      network.id === id ? { ...network, [field]: value } : network
    ));
  };

  const removeNetwork = (id: number) => {
    setNetworks(networks.filter(network => network.id !== id));
  };

  const handleNext = () => {
    setSetupData({
      ...setupData,
      networkConfig: {
        type: networkType,
        networks: networkType === 'multiple' ? networks : []
      }
    });
    onNext();
  };

  const isValidCIDR = (cidr: string) => {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    return cidrRegex.test(cidr);
  };

  const canProceed = () => {
    if (networkType === 'single') return true;
    return networks.length > 0 && networks.every(network => 
      network.name.trim() && network.cidr.trim() && isValidCIDR(network.cidr)
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white mb-2">Network Configuration</h2>
        <p className="text-gray-400">Configure the network topology for your containers</p>
      </div>

      {/* Network Type Selection */}
      <div className="bg-gray-850 rounded-xl p-6">
        <h3 className="text-lg font-medium text-white mb-4">Network Type</h3>
        <div className="space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="networkType"
              value="single"
              checked={networkType === 'single'}
              onChange={(e) => setNetworkType(e.target.value)}
              className="w-4 h-4 text-accent border-gray-600 focus:ring-accent focus:ring-2"
            />
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <Network className="w-5 h-5 text-accent" />
                <span className="text-white font-medium">Single Network</span>
              </div>
              <p className="text-gray-400 text-sm mt-1">
                All containers will be placed on the same default network
              </p>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="networkType"
              value="multiple"
              checked={networkType === 'multiple'}
              onChange={(e) => setNetworkType(e.target.value)}
              className="w-4 h-4 text-accent border-gray-600 focus:ring-accent focus:ring-2"
            />
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <Network className="w-5 h-5 text-cyan" />
                <span className="text-white font-medium">Multiple Networks</span>
              </div>
              <p className="text-gray-400 text-sm mt-1">
                Create custom networks for network segmentation and isolation
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Multiple Networks Configuration */}
      {networkType === 'multiple' && (
        <div className="bg-gray-850 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-white">Custom Networks</h3>
            <button
              onClick={addNetwork}
              className="flex items-center space-x-2 px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add Network</span>
            </button>
          </div>

          {networks.length === 0 ? (
            <div className="text-center py-8">
              <Network className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No networks configured yet</p>
              <p className="text-gray-500 text-sm mt-1">Click "Add Network" to create your first network</p>
            </div>
          ) : (
            <div className="space-y-4">
              {networks.map((network, index) => (
                <div key={network.id} className="flex items-center space-x-4 p-4 bg-secondary rounded-lg">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Network Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., web-network"
                        value={network.name}
                        onChange={(e) => updateNetwork(network.id, 'name', e.target.value)}
                        className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        CIDR Block
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., 172.20.0.0/16"
                        value={network.cidr}
                        onChange={(e) => updateNetwork(network.id, 'cidr', e.target.value)}
                        className={`w-full px-3 py-2 bg-gray-850 border rounded-lg text-white placeholder-gray-400 focus:outline-none ${
                          network.cidr && !isValidCIDR(network.cidr)
                            ? 'border-error focus:border-error'
                            : 'border-gray-600 focus:border-accent'
                        }`}
                      />
                      {network.cidr && !isValidCIDR(network.cidr) && (
                        <p className="text-error text-xs mt-1">Invalid CIDR format</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeNetwork(network.id)}
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-error transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          Continue to Container Placement
        </button>
      </div>
    </div>
  );
};

export default NetworkConfig;