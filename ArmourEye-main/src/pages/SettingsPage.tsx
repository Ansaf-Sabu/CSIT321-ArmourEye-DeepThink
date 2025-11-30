import React, { useState } from 'react';
import { User, Shield, Palette } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const SettingsPage: React.FC = () => {
  // State for which tab is active
  const profileTabLabel = 'Change User Info';
  const appearanceTabLabel = 'Appearance';
  const [activeTab, setActiveTab] = useState(profileTabLabel);
  const { theme, setTheme } = useTheme();
  
  // State for profile form (visual only, won't save)
  const [firstName, setFirstName] = useState('Security');
  const [lastName, setLastName] = useState('Analyst');
  const [email, setEmail] = useState('analyst@company.com');

  // State for password fields (visual only)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Removed the useEffect for theme management

  const navItems = [
    { icon: User, label: profileTabLabel },
    { icon: Shield, label: 'Security' },
    { icon: Palette, label: appearanceTabLabel },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 mt-2">Configure your ArmourEye platform preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Settings Navigation */}
        <div className="lg:col-span-1">
          <div className="bg-secondary rounded-xl border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Settings Categories</h2>
            <nav className="space-y-2">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => setActiveTab(item.label)}
                  className={`w-full flex items-center space-x-3 p-3 rounded-lg text-left transition-colors ${
                    activeTab === item.label
                      ? 'bg-accent text-white'
                      : 'text-gray-300 hover:bg-gray-750 hover:text-white'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Settings Content */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* --- Conditionally render Profile Settings --- */}
          {activeTab === profileTabLabel && (
            <div className="bg-secondary rounded-xl border border-gray-700 p-6 animate-fade-in">
              <h3 className="text-xl font-semibold text-white mb-4">Change User Info</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      First Name
                    </label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* --- Conditionally render Security Settings --- */}
          {activeTab === 'Security' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-secondary rounded-xl border border-gray-700 p-6">
                <h3 className="text-xl font-semibold text-white mb-4">Security Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-gray-850 rounded-lg">
                    <div>
                      <h4 className="text-white font-medium">Two-Factor Authentication</h4>
                      <p className="text-gray-400 text-sm">Add an extra layer of security to your account</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" defaultChecked />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                    </label>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-gray-850 rounded-lg">
                    <div>
                      <h4 className="text-white font-medium">Session Timeout</h4>
                      <p className="text-gray-400 text-sm">Automatically log out after inactivity</p>
                    </div>
                    <select className="px-3 py-2 bg-secondary border border-gray-600 rounded text-white focus:outline-none focus:border-accent">
                      <option>30 minutes</option>
                      <option>1 hour</option>
                      <option>4 hours</option>
                      <option>Never</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* --- Change Password Section --- */}
              <div className="bg-secondary rounded-xl border border-gray-700 p-6">
                <h3 className="text-xl font-semibold text-white mb-4">Change Password</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter your current password"
                      className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter a new password"
                      className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your new password"
                      className="w-full px-3 py-2 bg-gray-850 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === appearanceTabLabel && (
            <div className="bg-secondary rounded-xl border border-gray-700 p-6 space-y-6 animate-fade-in">
              <div>
                <h3 className="text-xl font-semibold text-white">Appearance</h3>
                <p className="text-gray-400 text-sm mt-1">Switch between light and dark themes instantly.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  { id: 'dark', title: 'Dark', description: 'High-contrast surfaces optimized for command centers.' },
                  { id: 'light', title: 'Light', description: 'Bright workspace with soft shadows and muted borders.' },
                ].map((option) => {
                  const isActive = theme === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTheme(option.id as 'dark' | 'light')}
                      className={`text-left border rounded-xl p-4 transition-all ${
                        isActive
                          ? 'border-accent bg-accent/10 shadow-lg shadow-accent/20'
                          : 'border-gray-600 hover:border-accent/60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-semibold">{option.title} Mode</span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            isActive ? 'bg-accent' : 'bg-gray-600'
                          }`}></span>
                      </div>
                      <p className="text-sm text-gray-400">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end">
            <button className="px-6 py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors">
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;