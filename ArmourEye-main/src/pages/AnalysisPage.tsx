import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ShieldCheck,
  HelpCircle,
  Target,
  Sparkles,
  Wrench,
  Bomb,
  Info,
  ServerCrash,
  ArrowLeft,
  Network,
  Globe
} from 'lucide-react';

// --- Types ---
type Exploit = {
  source: string;
  url: string;
  tags: string[];
  status: string;
};

type Fix = {
  source: string;
  url: string;
  tags: string[];
  status: string;
};

type Vulnerability = {
  cve_id: string;
  severity: string;
  cvss: string;
  description: string;
  exploits: Exploit[];
  fixes: Fix[];
};

type NetworkInfo = {
  open_ports: number[];
  services: Record<number, string>;
  target_ip?: string;
};

type AnalysisReport = {
  package: string;
  version: string;
  status: 'VULNERABLE' | 'CLEAN' | 'UNKNOWN';
  unique_vuln_count: number;
  severities_found: string[];
  llm_summary: string;
  all_vulnerabilities: Vulnerability[];
  retrieved_docs_count?: number;
  found_in_database?: boolean;
  source?: 'chroma' | 'trivy' | 'none';
  network_info?: NetworkInfo;
};

// --- Helper Components ---
const SeverityBadge: React.FC<{ severity: string; className?: string }> = ({ severity, className = '' }) => {
  let colorClasses = '';
  switch (severity?.toUpperCase()) {
    case 'HIGH':
    case 'CRITICAL':
      colorClasses = 'bg-error/10 text-error border-error/30';
      break;
    case 'MEDIUM':
      colorClasses = 'bg-warning/10 text-warning border-warning/30';
      break;
    case 'LOW':
      colorClasses = 'bg-success/10 text-success border-success/30';
      break;
    default:
      colorClasses = 'bg-gray-700/50 text-gray-300 border-gray-600';
  }
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClasses} ${className}`}>
      {severity?.toUpperCase() || 'UNKNOWN'}
    </span>
  );
};

const StatusBadge: React.FC<{ status: AnalysisReport['status'] }> = ({ status }) => {
  switch (status) {
    case 'VULNERABLE':
      return (
        <span className="flex items-center space-x-2 text-error">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-lg font-medium">Vulnerable</span>
        </span>
      );
    case 'CLEAN':
      return (
        <span className="flex items-center space-x-2 text-success">
          <ShieldCheck className="w-5 h-5" />
          <span className="text-lg font-medium">Clean</span>
        </span>
      );
    default:
      return (
        <span className="flex items-center space-x-2 text-gray-400">
          <HelpCircle className="w-5 h-5" />
          <span className="text-lg font-medium">Unknown</span>
        </span>
      );
  }
};

// --- Main Component ---
const AnalysisPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [report] = useState<AnalysisReport | null>(() => {
    return location.state?.report || null;
  });
  
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!report) {
      setError("No report data provided. Please select a package from the Analysis Hub.");
      setTimeout(() => navigate('/scan-results'), 2000);
    }
  }, [report, navigate]);
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] space-y-4 bg-secondary border border-error/50 rounded-xl p-8">
        <ServerCrash className="w-12 h-12 text-error" />
        <h2 className="text-xl font-semibold text-white">Error</h2>
        <p className="text-gray-400">{error}</p>
      </div>
    );
  }
  
  if (!report) return null;

  const severityCounts = report.all_vulnerabilities.reduce((acc, vuln) => {
    const severity = vuln.severity?.toUpperCase() || 'UNKNOWN';
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalExploits = report.all_vulnerabilities.reduce((acc, vuln) => acc + vuln.exploits.length, 0);
  const totalFixes = report.all_vulnerabilities.reduce((acc, vuln) => acc + vuln.fixes.length, 0);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/scan-results')}
          className="flex items-center text-sm text-accent hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Analysis Hub
        </button>
        <h1 className="text-3xl font-bold text-white">Deep Dive Analysis</h1>
        <p className="text-gray-400 mt-2">Detailed vulnerability report for <span className="text-white font-mono">{report.package}</span></p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
        
        {/* LEFT: Vulnerability List */}
        <div className="xl:col-span-2 space-y-4">
            <h2 className="text-xl font-semibold text-white">Vulnerability Details</h2>
            {report.status === 'VULNERABLE' ? (
              report.all_vulnerabilities.map((vuln, index) => (
                <div key={index} className="bg-secondary rounded-xl border border-gray-700 p-6 transition-all hover:border-gray-600">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-lg font-semibold text-accent">{vuln.cve_id}</h3>
                    <SeverityBadge severity={vuln.severity} />
                  </div>
                  <p className="text-sm text-gray-500 mb-4">CVSS Score: {vuln.cvss}</p>
                  
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-300 mb-1">Description</h4>
                    <p className="text-sm text-gray-400">{vuln.description}</p>
                  </div>

                  {/* Exploits Section */}
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-300 mb-2 flex items-center">
                    <Bomb className="w-4 h-4 mr-2 text-red-400" /> Exploits
                      </h4>
                  {vuln.exploits.length > 0 ? (
                    <div className="p-3 bg-red-900/10 border border-red-900/30 rounded-lg">
                      <ul className="space-y-2">
                        {vuln.exploits.map((ex, i) => (
                          <li key={i} className="text-sm">
                            {ex.url ? (
                              <a 
                                href={ex.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-red-400 hover:underline font-medium"
                              >
                                {ex.source}
                              </a>
                            ) : (
                              <span className="text-red-400 font-medium">{ex.source}</span>
                            )}
                            {ex.tags && ex.tags.length > 0 && (
                              <span className="text-gray-500 ml-2">({ex.tags.join(", ")})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No known exploits found.</p>
                  )}
                </div>

                {/* Fixes/Remediation Section */}
                  <div>
                  <h4 className="text-sm font-semibold text-gray-300 mb-2 flex items-center">
                    <Wrench className="w-4 h-4 mr-2" /> Remediation
                  </h4>
                    {vuln.fixes.length > 0 ? (
                      <ul className="list-disc list-inside space-y-1">
                        {vuln.fixes.map((fix, i) => (
                          <li key={i} className="text-sm text-gray-400">
                          {fix.url ? (
                            <a 
                              href={fix.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              {fix.source}
                            </a>
                          ) : (
                            <span className="text-accent">{fix.source}</span>
                          )}
                          : {fix.status}
                          </li>
                        ))}
                      </ul>
                    ) : (
                    <p className="text-sm text-gray-500 italic">No fix links available.</p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-secondary rounded-xl border border-gray-700 p-12 text-center">
                <ShieldCheck className="w-16 h-16 text-success mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white">Clean Package</h3>
                <p className="text-gray-400 mt-2">No CVEs or security issues were detected.</p>
              </div>
            )}
        </div>

        {/* RIGHT: Summary Cards - sticky on desktop */}
        <div className="xl:col-span-1 space-y-6 xl:sticky xl:top-6">
          {/* Spacer to align with "Vulnerability Details" header */}
          <h2 className="text-xl font-semibold text-white invisible xl:visible">Package Summary</h2>
          <div className="bg-secondary rounded-xl border border-gray-700 p-6 -mt-2">
            <div className="flex items-center space-x-3 mb-6">
              <Target className="w-5 h-5 text-gray-300" />
              <h2 className="text-xl font-semibold text-white">Package Info</h2>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">Name</span>
                <span className="text-white font-medium">{report.package}</span>
              </div>
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">Version</span>
                <span className="text-white font-medium">{report.version}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-gray-400">Status</span>
                <StatusBadge status={report.status} />
              </div>
            </div>
          </div>

          {/* Network Info - only show if Nmap data available */}
          {report.network_info && report.network_info.open_ports && report.network_info.open_ports.length > 0 && (
            <div className="bg-secondary rounded-xl border border-cyan-700/50 p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Network className="w-5 h-5 text-cyan-400" />
                <h2 className="text-xl font-semibold text-white">Network Exposure</h2>
              </div>
              <p className="text-xs text-gray-500 mb-4">Detected by Nmap scan</p>
              
              {report.network_info.target_ip && (
                <div className="flex items-center text-sm text-gray-400 mb-3">
                  <Globe className="w-4 h-4 mr-2 text-gray-500" />
                  <span>Target: <span className="text-white">{report.network_info.target_ip}</span></span>
                </div>
              )}
              
              <div className="space-y-2">
                <p className="text-sm text-gray-400 mb-2">Open Ports:</p>
                <div className="flex flex-wrap gap-2">
                  {report.network_info.open_ports.map((port) => (
                    <div 
                      key={port} 
                      className="px-3 py-1.5 bg-cyan-900/30 border border-cyan-700/50 rounded-lg text-sm"
                    >
                      <span className="text-cyan-300 font-mono font-medium">{port}</span>
                      {report.network_info?.services[port] && (
                        <span className="text-gray-400 ml-2">
                          ({report.network_info.services[port]})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              
              {report.status === 'VULNERABLE' && (
                <div className="mt-4 p-3 bg-red-900/20 border border-red-700/30 rounded-lg">
                  <p className="text-xs text-red-300">
                    ⚠️ This package has vulnerabilities and the target has exposed ports. 
                    This may increase the risk of exploitation.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* AI Summary */}
          <div className="bg-secondary rounded-xl border border-accent/30 p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Sparkles className="w-24 h-24 text-accent" />
            </div>
            <div className="flex items-center space-x-3 mb-4 relative z-10">
              <Sparkles className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-semibold text-white">AI Assessment</h2>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed relative z-10">
              {report.llm_summary}
            </p>
            
            {/* Only show severity/exploits for VULNERABLE packages */}
            {report.status === 'VULNERABLE' && (
            <div className="mt-6 grid grid-cols-2 gap-3 relative z-10">
               <div className="bg-gray-800 p-3 rounded text-center">
                 <div className="text-xs text-gray-500 uppercase">Severity</div>
                 <div className="text-lg font-bold text-white">
                     {severityCounts['CRITICAL'] ? 'Critical' : severityCounts['HIGH'] ? 'High' : severityCounts['MEDIUM'] ? 'Medium' : 'Low'}
                   </div>
                 </div>
                 <div className="bg-gray-800 p-3 rounded text-center">
                   <div className="text-xs text-gray-500 uppercase">Vulnerabilities</div>
                   <div className="text-lg font-bold text-white">{report.all_vulnerabilities.length}</div>
               </div>
               <div className="bg-gray-800 p-3 rounded text-center">
                 <div className="text-xs text-gray-500 uppercase">Exploits</div>
                 <div className="text-lg font-bold text-white">{totalExploits}</div>
               </div>
                 <div className="bg-gray-800 p-3 rounded text-center">
                   <div className="text-xs text-gray-500 uppercase">Fixes</div>
                   <div className="text-lg font-bold text-white">{totalFixes}</div>
                 </div>
            </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};

export default AnalysisPage;