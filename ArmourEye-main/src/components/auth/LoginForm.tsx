import React, { useState, useEffect } from 'react';
import { Shield, Eye, EyeOff, Lock, User, Fingerprint, Scan, AlertTriangle } from 'lucide-react';

interface LoginFormProps {
  onLogin: (token: string, user: any) => void;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanLine, setScanLine] = useState(0);

  // Animated scan line effect
  useEffect(() => {
    const interval = setInterval(() => {
      setScanLine((prev) => (prev >= 100 ? 0 : prev + 0.5));
    }, 30);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      localStorage.setItem('authToken', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0e17]">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-20">
        <div 
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(59, 130, 246, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(59, 130, 246, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }}
        />
      </div>

      {/* Animated gradient orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-500/20 rounded-full blur-[100px] animate-pulse" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-cyan-500/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px]" />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-cyan-400/40 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${5 + Math.random() * 10}s`,
            }}
          />
        ))}
      </div>

      {/* Main login container */}
      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Glowing border effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 rounded-2xl blur-lg opacity-30 animate-pulse" />
        
        <div className="relative bg-[#0d1321]/90 backdrop-blur-xl rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
          {/* Scan line effect */}
          <div 
            className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-60 pointer-events-none z-20"
            style={{ top: `${scanLine}%` }}
          />

          {/* Header section with hex pattern */}
          <div className="relative px-8 pt-10 pb-8 text-center">
            {/* Hex pattern overlay */}
            <div 
              className="absolute inset-0 opacity-5"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0l25.98 15v30L30 60 4.02 45V15z' fill='none' stroke='%2306b6d4' stroke-width='1'/%3E%3C/svg%3E")`,
                backgroundSize: '30px 30px',
              }}
            />

            {/* Logo container */}
            <div className="relative inline-block">
              {/* Outer ring */}
              <div className="absolute inset-0 rounded-full border-2 border-cyan-500/30 animate-spin-slow" style={{ animationDuration: '10s' }} />
              <div className="absolute inset-2 rounded-full border border-blue-500/20 animate-spin-slow" style={{ animationDuration: '15s', animationDirection: 'reverse' }} />
              
              {/* Shield icon */}
              <div className="relative mx-auto h-20 w-20 flex items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30">
                <Shield className="h-10 w-10 text-cyan-400 drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
                
                {/* Pulse rings */}
                <div className="absolute inset-0 rounded-full border border-cyan-400/50 animate-ping" style={{ animationDuration: '2s' }} />
          </div>
            </div>

            {/* Title */}
            <h1 className="mt-6 text-4xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                ArmourEye
              </span>
            </h1>
            <p className="mt-2 text-gray-400 text-sm tracking-wide">
              AI-Powered Security Analysis Platform
            </p>

            {/* Status indicator */}
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/50 border border-gray-700/50">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs text-gray-400">System Ready</span>
            </div>
        </div>

          {/* Form section */}
          <form className="px-8 pb-8 space-y-5" onSubmit={handleSubmit}>
            {/* Username field */}
            <div className="group">
              <label htmlFor="username" className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="h-4 w-4 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
                </div>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-gray-900/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
                placeholder="Enter your username"
              />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/0 via-cyan-500/0 to-cyan-500/0 group-focus-within:from-cyan-500/5 group-focus-within:via-blue-500/5 group-focus-within:to-indigo-500/5 pointer-events-none transition-all duration-500" />
              </div>
            </div>

            {/* Password field */}
            <div className="group">
              <label htmlFor="password" className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-12 py-3 bg-gray-900/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-500 hover:text-cyan-400 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/0 via-cyan-500/0 to-cyan-500/0 group-focus-within:from-cyan-500/5 group-focus-within:via-blue-500/5 group-focus-within:to-indigo-500/5 pointer-events-none transition-all duration-500" />
            </div>
          </div>

            {/* Error message */}
          {error && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 animate-shake">
                <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="relative w-full group overflow-hidden"
            >
              {/* Button glow effect */}
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 rounded-xl blur opacity-30 group-hover:opacity-50 transition-opacity duration-500" />
              
              <div className="relative flex items-center justify-center gap-3 py-3.5 px-6 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-white font-medium transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? (
                  <>
                    <Scan className="h-5 w-5 animate-spin" />
                    <span>Authenticating...</span>
                  </>
              ) : (
                  <>
                    <Fingerprint className="h-5 w-5" />
                    <span>Access System</span>
                  </>
              )}
              </div>
            </button>

            {/* Demo credentials */}
            <div className="pt-4 border-t border-gray-800/50">
              <p className="text-center text-xs text-gray-500 mb-3">Demo Credentials</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setUsername('admin'); setPassword('password'); }}
                  className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gray-800/50 border border-gray-700/50 hover:border-cyan-500/30 hover:bg-gray-800 text-xs text-gray-400 hover:text-cyan-400 transition-all duration-300"
                >
                  <Shield className="h-3.5 w-3.5" />
                  <span>Admin</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setUsername('analyst'); setPassword('password'); }}
                  className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gray-800/50 border border-gray-700/50 hover:border-cyan-500/30 hover:bg-gray-800 text-xs text-gray-400 hover:text-cyan-400 transition-all duration-300"
                >
                  <User className="h-3.5 w-3.5" />
                  <span>Analyst</span>
                </button>
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-900/30 border-t border-gray-800/50">
            <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
              <span>v1.0.0</span>
              <span className="w-1 h-1 rounded-full bg-gray-600" />
              <span>Secure Connection</span>
              <span className="w-1 h-1 rounded-full bg-gray-600" />
              <span className="flex items-center gap-1">
                <Lock className="h-3 w-3" />
                TLS 1.3
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Corner decorations */}
      <div className="absolute top-8 left-8 w-24 h-24 border-l-2 border-t-2 border-cyan-500/20 rounded-tl-3xl" />
      <div className="absolute top-8 right-8 w-24 h-24 border-r-2 border-t-2 border-cyan-500/20 rounded-tr-3xl" />
      <div className="absolute bottom-8 left-8 w-24 h-24 border-l-2 border-b-2 border-cyan-500/20 rounded-bl-3xl" />
      <div className="absolute bottom-8 right-8 w-24 h-24 border-r-2 border-b-2 border-cyan-500/20 rounded-br-3xl" />

      {/* Binary rain effect (subtle) */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-[0.03]">
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className="absolute text-cyan-400 text-xs font-mono animate-binary-rain"
            style={{
              left: `${i * 10 + 5}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${10 + Math.random() * 10}s`,
            }}
          >
            {[...Array(20)].map((_, j) => (
              <div key={j} className="my-1">
                {Math.random() > 0.5 ? '1' : '0'}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Custom styles */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.4; }
          25% { transform: translateY(-20px) translateX(10px); opacity: 0.8; }
          50% { transform: translateY(-40px) translateX(-10px); opacity: 0.4; }
          75% { transform: translateY(-20px) translateX(5px); opacity: 0.8; }
        }
        
        @keyframes binary-rain {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        
        .animate-float {
          animation: float 10s ease-in-out infinite;
        }
        
        .animate-binary-rain {
          animation: binary-rain 15s linear infinite;
        }
        
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
        
        .animate-spin-slow {
          animation: spin 10s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default LoginForm; 
