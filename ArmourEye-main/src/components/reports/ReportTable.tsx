/**
 * NOTE: This component is currently NOT USED in the application.
 * It was created as a placeholder/template for a future Reports page feature.
 * Contains hardcoded demo data for demonstration purposes.
 * Can be integrated later if a reports history feature is needed.
 */

import React, { useState } from 'react';
import { Download, Eye, Calendar, Target } from 'lucide-react';

const ReportTable: React.FC = () => {
  const [selectedReport, setSelectedReport] = useState<string | null>('RPT-2024-001');

  const reports = [
    {
      id: 'RPT-2024-001',
      targets: 'web-server, api-service',
      date: '2024-01-15',
      time: '14:30',
      vulnerabilities: { critical: 2, high: 5, medium: 8, low: 12 },
      status: 'completed',
      duration: '2h 45m'
    },
    {
      id: 'RPT-2024-002',
      targets: 'database, auth-service',
      date: '2024-01-14',
      time: '09:15',
      vulnerabilities: { critical: 0, high: 2, medium: 4, low: 6 },
      status: 'completed',
      duration: '1h 30m'
    },
    {
      id: 'RPT-2024-003',
      targets: 'web-server',
      date: '2024-01-13',
      time: '16:20',
      vulnerabilities: { critical: 1, high: 3, medium: 5, low: 9 },
      status: 'completed',
      duration: '3h 10m'
    },
    {
      id: 'RPT-2024-004',
      targets: 'api-service, database',
      date: '2024-01-12',
      time: '11:45',
      vulnerabilities: { critical: 0, high: 1, medium: 3, low: 5 },
      status: 'completed',
      duration: '2h 15m'
    },
    {
      id: 'RPT-2024-005',
      targets: 'auth-service',
      date: '2024-01-11',
      time: '13:00',
      vulnerabilities: { critical: 3, high: 4, medium: 2, low: 1 },
      status: 'completed',
      duration: '4h 30m'
    }
  ];

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-error';
      case 'high':
        return 'text-warning';
      case 'medium':
        return 'text-cyan';
      case 'low':
        return 'text-success';
      default:
        return 'text-gray-400';
    }
  };

  const getTotalVulns = (vulns: any) => {
    return vulns.critical + vulns.high + vulns.medium + vulns.low;
  };

  const getRiskLevel = (vulns: any) => {
    if (vulns.critical > 0) return { level: 'Critical', color: 'text-error' };
    if (vulns.high > 0) return { level: 'High', color: 'text-warning' };
    if (vulns.medium > 0) return { level: 'Medium', color: 'text-cyan' };
    return { level: 'Low', color: 'text-success' };
  };

  return (
    <div className="bg-secondary rounded-xl border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Scan Reports</h2>
        <div className="flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-gray-400 text-sm">Last 30 days</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-400 font-medium py-3 px-2">Report ID</th>
              <th className="text-left text-gray-400 font-medium py-3 px-2">Targets</th>
              <th className="text-left text-gray-400 font-medium py-3 px-2">Date & Time</th>
              <th className="text-left text-gray-400 font-medium py-3 px-2">Vulnerabilities</th>
              <th className="text-left text-gray-400 font-medium py-3 px-2">Risk Level</th>
              <th className="text-left text-gray-400 font-medium py-3 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const riskLevel = getRiskLevel(report.vulnerabilities);
              return (
                <tr
                  key={report.id}
                  className={`border-b border-gray-700 hover:bg-gray-750 cursor-pointer transition-colors ${
                    selectedReport === report.id ? 'bg-accent/10 border-accent/20' : ''
                  }`}
                  onClick={() => setSelectedReport(report.id)}
                >
                  <td className="py-4 px-2">
                    <div className="flex items-center space-x-2">
                      <Target className="w-4 h-4 text-accent" />
                      <span className="text-white font-mono text-sm">{report.id}</span>
                    </div>
                  </td>
                  <td className="py-4 px-2">
                    <div className="text-gray-300 text-sm max-w-32 truncate">
                      {report.targets}
                    </div>
                    <div className="text-gray-500 text-xs">
                      Duration: {report.duration}
                    </div>
                  </td>
                  <td className="py-4 px-2">
                    <div className="text-white text-sm">{report.date}</div>
                    <div className="text-gray-400 text-xs">{report.time}</div>
                  </td>
                  <td className="py-4 px-2">
                    <div className="flex items-center space-x-3">
                      <div className="text-center">
                        <div className="text-error font-bold text-sm">{report.vulnerabilities.critical}</div>
                        <div className="text-gray-500 text-xs">C</div>
                      </div>
                      <div className="text-center">
                        <div className="text-warning font-bold text-sm">{report.vulnerabilities.high}</div>
                        <div className="text-gray-500 text-xs">H</div>
                      </div>
                      <div className="text-center">
                        <div className="text-cyan font-bold text-sm">{report.vulnerabilities.medium}</div>
                        <div className="text-gray-500 text-xs">M</div>
                      </div>
                      <div className="text-center">
                        <div className="text-success font-bold text-sm">{report.vulnerabilities.low}</div>
                        <div className="text-gray-500 text-xs">L</div>
                      </div>
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      Total: {getTotalVulns(report.vulnerabilities)}
                    </div>
                  </td>
                  <td className="py-4 px-2">
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${
                        riskLevel.level === 'Critical' ? 'bg-error' :
                        riskLevel.level === 'High' ? 'bg-warning' :
                        riskLevel.level === 'Medium' ? 'bg-cyan' :
                        'bg-success'
                      }`}></div>
                      <span className={`text-sm font-medium ${riskLevel.color}`}>
                        {riskLevel.level}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-2">
                    <div className="flex items-center space-x-2">
                      <button
                        className="p-1 text-gray-400 hover:text-accent transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        className="p-1 text-gray-400 hover:text-success transition-colors"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="text-gray-400 text-sm">
          Showing {reports.length} reports
        </div>
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1 text-gray-400 hover:text-white transition-colors">
            Previous
          </button>
          <button className="px-3 py-1 bg-accent text-white rounded">
            1
          </button>
          <button className="px-3 py-1 text-gray-400 hover:text-white transition-colors">
            2
          </button>
          <button className="px-3 py-1 text-gray-400 hover:text-white transition-colors">
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportTable;