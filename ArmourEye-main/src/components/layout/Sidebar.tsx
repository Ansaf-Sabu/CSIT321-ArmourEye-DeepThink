import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  Wrench,
  Activity,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface SidebarProps {
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const initials = user?.username
    ? user.username
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase()
    : '??';

  const menuItems = [
    { path: '/', icon: Home, label: 'Home' },
    { path: '/setup', icon: Wrench, label: 'Setup' },
    { path: '/scan', icon: Activity, label: 'Orchestrator' },
    { path: '/scan-results', icon: Sparkles, label: 'AI Insights' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className={`fixed left-0 top-16 h-[calc(100vh-4rem)] bg-secondary border-r border-gray-700 transition-all duration-300 z-40 ${
      collapsed ? 'w-14' : 'w-48'
    }`}>
      <div className="flex flex-col h-full">
        
        <div className={`p-4 flex items-center ${collapsed ? 'justify-center' : 'justify-between space-x-3'}`}>
          {!collapsed && user && (
            <button
              onClick={() => navigate('/user-profile')}
              className="flex items-center space-x-3 px-3 py-2 rounded-xl border border-gray-700 hover:border-accent transition-colors bg-gray-850"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent font-semibold flex items-center justify-center">
                {initials}
              </div>
              <div className="text-left">
                <p className="text-white font-medium leading-tight">{user.username}</p>
                <p className="text-xs text-gray-400 capitalize">{user.role}</p>
              </div>
            </button>
          )}
          <button
            onClick={() => onToggle(!collapsed)}
            className="flex items-center justify-center p-2 rounded-lg hover:bg-gray-750 transition-colors"
          >
            {collapsed ? (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronLeft className="w-5 h-5 text-gray-400" />
            )}
          </button>
        </div>

        <nav className="flex-1 px-4">
          <ul className="space-y-2">
            {menuItems.map((item) => {
              const isScanActive = (location.pathname === '/scan-results' || location.pathname === '/analysis-detail') && item.path === '/scan-results';
              const isActive = (location.pathname === item.path) || isScanActive;
              const finalIsActive = item.path === '/' 
                ? location.pathname === '/' 
                : isActive;

              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center ${collapsed ? 'justify-center' : 'space-x-3'} p-3 rounded-lg transition-all duration-200 ${
                      finalIsActive
                        ? 'bg-accent text-white shadow-lg shadow-accent/20'
                        : 'text-gray-300 hover:bg-gray-750 hover:text-white'
                    }`}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {!collapsed && (
                      <span className="font-medium animate-fade-in">{item.label}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* The fake status bar section has been removed. */}

      </div>
    </aside>
  );
};

export default Sidebar;