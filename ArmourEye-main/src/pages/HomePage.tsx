import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Shield, 
  Zap, 
  FileText, 
  Target, 
  Clock, 
  Loader2,
  Brain,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Activity
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// --- Helper component for the loading placeholder ---
const SkeletonCard: React.FC = () => (
  <div className="bg-secondary rounded-xl border border-gray-700 p-6 h-24 animate-pulse">
    <div className="h-4 bg-gray-700 rounded w-1/2 mb-3"></div>
    <div className="h-6 bg-gray-600 rounded w-1/4"></div>
  </div>
);

interface DashboardStats {
  imageScans: number;
  vulnerabilitiesFound: number;
  aiScans: number;
  reportsGenerated: number;
}

interface RecentActivity {
  action: string;
  target: string;
  time: string;
  status: 'success' | 'warning' | 'error' | 'info';
}

interface SystemStatus {
  name: string;
  status: 'online' | 'offline' | 'updating';
}

// --- Main Page Component ---
const HomePage: React.FC = () => {
  const { token } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    imageScans: 0,
    vulnerabilitiesFound: 0,
    aiScans: 0,
    reportsGenerated: 0
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

    setIsLoading(true);
      setError(null);

      try {
        const response = await fetch('http://localhost:3001/api/dashboard/stats', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch dashboard data');
        }

        const data = await response.json();
        setStats(data.stats);
        setRecentActivity(data.recentActivity || []);
        setSystemStatus(data.systemStatus || []);
      } catch (err: any) {
        console.error('Dashboard fetch error:', err);
        setError(err.message);
        // Set default system status on error
        setSystemStatus([
          { name: 'Backend API', status: 'offline' },
          { name: 'Docker Engine', status: 'offline' },
          { name: 'AI Service (Local)', status: 'offline' },
          { name: 'Trivy Scanner', status: 'offline' }
        ]);
      } finally {
      setIsLoading(false);
      }
    };

    fetchDashboardData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const statCards = [
    { label: 'Image Scans', value: stats.imageScans.toString(), icon: Shield, color: 'text-cyan-400' },
    { label: 'Vulnerabilities Found', value: stats.vulnerabilitiesFound.toString(), icon: AlertTriangle, color: 'text-error' },
    { label: 'AI Analyses', value: stats.aiScans.toString(), icon: Brain, color: 'text-accent' },
    { label: 'Reports Generated', value: stats.reportsGenerated.toString(), icon: FileText, color: 'text-success' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-success';
      case 'offline': return 'text-error';
      case 'updating': return 'text-warning';
      default: return 'text-gray-400';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'online': return 'bg-success';
      case 'offline': return 'bg-error';
      case 'updating': return 'bg-warning';
      default: return 'bg-gray-400';
    }
  };

  const getActivityDot = (status: string) => {
    switch (status) {
      case 'success': return 'bg-success';
      case 'warning': return 'bg-warning';
      case 'error': return 'bg-error';
      default: return 'bg-accent';
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-2">Monitor your security posture and AI-driven analysis</p>
        </div>
        <Link
          to="/setup"
          className="px-6 py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-all duration-200 hover:shadow-lg hover:shadow-accent/20"
        >
          New Scan Setup
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          statCards.map((stat, index) => (
            <div key={index} className="bg-secondary rounded-xl border border-gray-700 p-6 hover:border-gray-600 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm font-medium">{stat.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-lg bg-gray-850 ${stat.color}`}>
                  <stat.icon className="w-6 h-6" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <div className="bg-secondary rounded-xl border border-gray-700 p-6 flex flex-col" style={{ minHeight: '320px' }}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">Recent Activity</h2>
            <Clock className="w-5 h-5 text-gray-400" />
          </div>
          <div className="space-y-4 flex-1">
            {isLoading ? (
              <div className="space-y-4">
                <div className="h-10 bg-gray-750 rounded-lg animate-pulse"></div>
                <div className="h-10 bg-gray-750 rounded-lg animate-pulse"></div>
                <div className="h-10 bg-gray-750 rounded-lg animate-pulse"></div>
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Activity className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No recent activity</p>
                <p className="text-xs text-gray-600 mt-1">Run a scan to see activity here</p>
              </div>
            ) : (
              recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center space-x-4 p-3 rounded-lg hover:bg-gray-750 transition-colors">
                  <div className={`w-2 h-2 rounded-full ${getActivityDot(activity.status)}`}></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{activity.action}</p>
                    <p className="text-gray-400 text-sm truncate">{activity.target}</p>
                  </div>
                  <span className="text-gray-500 text-xs whitespace-nowrap">{activity.time}</span>
                </div>
              ))
            )}
          </div>
          <Link
            to="/scan-results"
            className="block mt-4 text-accent hover:text-accent-light text-sm font-medium transition-colors"
          >
            View all activity →
          </Link>
        </div>

        {/* System Status */}
        <div className="bg-secondary rounded-xl border border-gray-700 p-6 flex flex-col" style={{ minHeight: '320px' }}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">System Status</h2>
            {isLoading ? (
              <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
            ) : error ? (
              <XCircle className="w-5 h-5 text-error" />
            ) : (
              <CheckCircle className="w-5 h-5 text-success" />
            )}
          </div>
          <div className="space-y-3 flex-1">
            {isLoading ? (
              <div className="space-y-3">
                <div className="h-12 bg-gray-750 rounded-lg animate-pulse"></div>
                <div className="h-12 bg-gray-750 rounded-lg animate-pulse"></div>
                <div className="h-12 bg-gray-750 rounded-lg animate-pulse"></div>
                <div className="h-12 bg-gray-750 rounded-lg animate-pulse"></div>
              </div>
            ) : (
              systemStatus.map((system, index) => (
                <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-gray-850">
                  <span className="text-gray-300">{system.name}</span>
              <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${getStatusDot(system.status)} ${system.status === 'online' ? 'animate-pulse' : ''}`}></div>
                    <span className={`text-sm font-medium capitalize ${getStatusColor(system.status)}`}>
                      {system.status}
                    </span>
              </div>
            </div>
              ))
            )}
              </div>
          {error && (
            <div className="mt-4 text-xs text-error bg-error/10 border border-error/30 rounded-lg p-2">
              Failed to fetch status: {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HomePage;
