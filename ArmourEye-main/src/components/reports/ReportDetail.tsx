/**
 * NOTE: This component is currently NOT USED in the application.
 * It was created as a placeholder/template for a future Reports page feature.
 * Contains hardcoded demo data for demonstration purposes.
 * Can be integrated later if a reports history feature is needed.
 */

import React from 'react';
import { Target, Clock, AlertTriangle, Download, Share } from 'lucide-react';

const ReportDetail: React.FC = () => {
  const selectedReport = {
    id: 'RPT-2024-001',
    targets: ['web-server', 'api-service'],
    date: '2024-01-15',
    time: '14:30',
    duration: '2h 45m',
    vulnerabilities: { critical: 2, high: 5, medium: 8, low: 12 },
    findings: [
      {
        id: 1,
        title: 'SQL Injection in Login Form',
        severity: 'critical',
        cvss: 9.8,
        description: 'Authentication bypass via SQL injection',
        recommendation: 'Implement parameterized queries and input validation'
      },
      {
        id: 2,
        title: 'Cross-Site Scripting (XSS)',
        severity: 'high',
        cvss: 7.4,
        description: 'Stored XSS in user profile page',
        recommendation: 'Sanitize user inputs and implement Content Security Policy'
      },
      {
        id: 3,
        title: 'Insecure Direct Object Reference',
        severity: 'high',
        cvss: 6.5,
        description: 'Users can access other users\' data',
        recommendation: 'Implement proper authorization checks'
      }
    ]
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-error bg-error/10 border-error/20';
      case 'high':
        return 'text-warning bg-warning/10 border-warning/20';
      case 'medium':
        return 'text-cyan bg-cyan/10 border-cyan/20';
      case 'low':
        return 'text-success bg-success/10 border-success/20';
      default:
        return 'text-gray-400 bg-gray-850 border-gray-700';
    }
  };

  const getCvssColor = (score: number) => {
    if (score >= 9.0) return 'text-error';
    if (score >= 7.0) return 'text-warning';
    if (score >= 4.0) return 'text-cyan';
    return 'text-success';
  };

  return (
    <div className="space-y-6">
      {/* Report Summary */}
      <div className="bg-secondary rounded-xl border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Report Summary</h2>
          <div className="flex items-center space-x-2">
            <button className="p-2 text-gray-400 hover:text-accent transition-colors">
              <Share className="w-4 h-4" />
            </button>
            <button className="p-2 text-gray-400 hover:text-success transition-colors">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <Target className="w-5 h-5 text-accent" />
            <div>
              <p className="text-white font-medium">{selectedReport.id}</p>
              <p className="text-gray-400 text-sm">{selectedReport.targets.join(', ')}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Clock className="w-5 h-5 text-cyan" />
            <div>
              <p className="text-white font-medium">{selectedReport.date} at {selectedReport.time}</p>
              <p className="text-gray-400 text-sm">Duration: {selectedReport.duration}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <div>
              <p className="text-white font-medium">27 Total Vulnerabilities</p>
              <p className="text-gray-400 text-sm">2 Critical, 5 High Risk</p>
            </div>
          </div>
        </div>
      </div>

      {/* Vulnerability Breakdown */}
      <div className="bg-secondary rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Vulnerability Breakdown</h3>
        
        <div className="space-y-3">
          {Object.entries(selectedReport.vulnerabilities).map(([severity, count]) => (
            <div key={severity} className="flex items-center justify-between p-3 bg-gray-850 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className={`w-3 h-3 rounded-full ${
                  severity === 'critical' ? 'bg-error' :
                  severity === 'high' ? 'bg-warning' :
                  severity === 'medium' ? 'bg-cyan' :
                  'bg-success'
                }`}></div>
                <span className="text-white capitalize font-medium">{severity}</span>
              </div>
              <span className={`font-bold ${
                severity === 'critical' ? 'text-error' :
                severity === 'high' ? 'text-warning' :
                severity === 'medium' ? 'text-cyan' :
                'text-success'
              }`}>
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Findings */}
      <div className="bg-secondary rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Top Findings</h3>
        
        <div className="space-y-4">
          {selectedReport.findings.map((finding) => (
            <div key={finding.id} className={`p-4 rounded-lg border ${getSeverityColor(finding.severity)}`}>
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-white font-medium text-sm">{finding.title}</h4>
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-bold ${getCvssColor(finding.cvss)}`}>
                    CVSS {finding.cvss}
                  </span>
                </div>
              </div>
              
              <p className="text-gray-300 text-sm mb-3">{finding.description}</p>
              
              <div className="bg-gray-850 rounded p-3">
                <h5 className="text-success text-xs font-medium mb-1">Recommendation:</h5>
                <p className="text-gray-400 text-xs">{finding.recommendation}</p>
              </div>
            </div>
          ))}
        </div>

        <button className="w-full mt-4 px-4 py-2 text-accent hover:text-accent-light text-sm font-medium transition-colors">
          View All Findings →
        </button>
      </div>
    </div>
  );
};

export default ReportDetail;