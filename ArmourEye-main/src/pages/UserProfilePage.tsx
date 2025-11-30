import React from 'react';
import { User, Shield, Hash, Calendar, Edit3 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const UserProfilePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const initials = user?.username
    ? user.username
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase()
    : '??';

  const fallbackInfo = {
    username: user?.username || 'Unknown User',
    role: user?.role || 'Unassigned',
    id: user?.id ?? 'N/A',
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">User Profile</h1>
          <p className="text-gray-400 mt-2">
            Review account details that power your ArmourEye workspace
          </p>
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-dark transition-colors"
        >
          <Edit3 className="w-4 h-4" />
          <span className="text-sm font-medium">Change User Info</span>
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="bg-secondary rounded-2xl border border-gray-700 p-6 flex flex-col items-center text-center">
          <div className="w-24 h-24 rounded-2xl bg-accent/20 border border-accent/40 flex items-center justify-center text-3xl font-semibold text-white mb-4">
            {initials}
          </div>
          <h2 className="text-2xl font-semibold text-white">{fallbackInfo.username}</h2>
          <p className="text-gray-400 capitalize">{fallbackInfo.role}</p>
          <div className="mt-4 text-sm text-gray-500 flex items-center space-x-2">
            <Hash className="w-4 h-4" />
            <span>User ID: {fallbackInfo.id}</span>
          </div>
        </div>

        <div className="bg-secondary rounded-2xl border border-gray-700 p-6 xl:col-span-2">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center space-x-2">
            <User className="w-5 h-5 text-accent" />
            <span>Account Overview</span>
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 bg-gray-850 rounded-xl border border-gray-700">
              <p className="text-gray-400 text-sm">Username</p>
              <p className="text-white font-medium mt-1">{fallbackInfo.username}</p>
            </div>
            <div className="p-4 bg-gray-850 rounded-xl border border-gray-700">
              <p className="text-gray-400 text-sm">Role</p>
              <p className="text-white font-medium mt-1 capitalize">{fallbackInfo.role}</p>
            </div>
            <div className="p-4 bg-gray-850 rounded-xl border border-gray-700">
              <p className="text-gray-400 text-sm">Status</p>
              <p className="text-white font-medium mt-1 flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                <span>Active session</span>
              </p>
            </div>
            <div className="p-4 bg-gray-850 rounded-xl border border-gray-700">
              <p className="text-gray-400 text-sm">Member Since</p>
              <p className="text-white font-medium mt-1 flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span>Not provided</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-secondary rounded-2xl border border-gray-700 p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center space-x-2">
            <Shield className="w-5 h-5 text-accent" />
            <span>Access & Permissions</span>
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-850 rounded-xl border border-gray-700">
              <div>
                <p className="text-white font-medium">Role</p>
                <p className="text-gray-400 text-sm">Determines what parts of the platform you can control</p>
              </div>
              <span className="px-3 py-1 rounded-full bg-accent/10 text-accent text-sm capitalize">
                {fallbackInfo.role}
              </span>
            </div>
            <div className="flex items-center justify-between p-4 bg-gray-850 rounded-xl border border-gray-700">
              <div>
                <p className="text-white font-medium">Backend Access</p>
                <p className="text-gray-400 text-sm">Authenticated with current token</p>
              </div>
              <span className="px-3 py-1 rounded-full bg-success/10 text-success text-sm">
                Healthy
              </span>
            </div>
          </div>
        </div>

        <div className="bg-secondary rounded-2xl border border-gray-700 p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center space-x-2">
            <Hash className="w-5 h-5 text-accent" />
            <span>Quick actions</span>
          </h3>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/settings')}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-850 border border-gray-700 rounded-lg text-left hover:border-accent transition-colors"
            >
              <div>
                <p className="text-white font-medium">Change user info</p>
                <p className="text-gray-400 text-sm">Update names, email, and organization details</p>
              </div>
              <Edit3 className="w-4 h-4 text-gray-400" />
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-850 border border-gray-700 rounded-lg text-left hover:border-accent transition-colors"
            >
              <div>
                <p className="text-white font-medium">Security preferences</p>
                <p className="text-gray-400 text-sm">Manage MFA, timeouts, and password controls</p>
              </div>
              <Shield className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfilePage;

