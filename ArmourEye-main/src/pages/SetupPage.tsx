import React, { useState } from 'react';
import { UploadCloud, Shield, Layers } from 'lucide-react';
import ImageUpload from '../components/setup/ImageUpload';

const SetupPage: React.FC = () => {
  const [setupData, setSetupData] = useState({
    images: [],
    networkConfig: { type: 'single', networks: [] },
    containerPlacements: [],
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">
      <div className="bg-gradient-to-br from-gray-900 via-gray-850 to-gray-900 border border-gray-700 rounded-2xl p-8 shadow-2xl shadow-black/20">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center space-x-3 text-accent mb-3">
              <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
                <UploadCloud className="w-5 h-5" />
              </div>
              <span className="text-sm font-semibold tracking-wide uppercase">Setup Wizard</span>
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold text-white mb-3">Upload & Stage Container Images</h1>
            <p className="text-gray-300 text-base max-w-2xl">
              Bring your Docker workloads into ArmourEye, capture metadata, and get each image ready for deep security scanning and analysis.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-900/60 rounded-xl border border-gray-700 p-4 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-400">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wide">Step 1</p>
                <p className="text-white font-semibold">Upload Image</p>
              </div>
            </div>
            <div className="bg-gray-900/60 rounded-xl border border-gray-700 p-4 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-300">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wide">Step 2</p>
                <p className="text-white font-semibold">Prepare Scan</p>
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Step Content */}
      <div className="bg-secondary rounded-xl border border-gray-700 p-8">
        <ImageUpload setupData={setupData} setSetupData={setSetupData} onNext={() => {}} />
      </div>
    </div>
  );
};

export default SetupPage;