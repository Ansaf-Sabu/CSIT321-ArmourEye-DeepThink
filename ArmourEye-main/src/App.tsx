import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ScanProvider } from './contexts/ScanContext'; 
import LoginForm from './components/auth/LoginForm';
import Layout from './components/layout/Layout';
import HomePage from './pages/HomePage';
import SetupPage from './pages/SetupPage';
import ScanPage from './pages/ScanPage';
import SettingsPage from './pages/SettingsPage';
import ScanResultsPage from './pages/ScanResultPage'; 
import AnalysisPage from './pages/AnalysisPage';
import UserProfilePage from './pages/UserProfilePage';

// Cache keys (must match ScanResultPage.tsx)
const SERVER_START_KEY = 'armoureye_server_start';
const RESULTS_CACHE_KEY = 'armoureye_ai_results_cache';
const STORAGE_KEY = 'armoureye_ai_insights_state';

// Clear AI cache if backend was restarted - runs on app load
const clearCacheOnBackendRestart = async () => {
  try {
    const response = await fetch('http://localhost:3001/api/health');
    if (response.ok) {
      const data = await response.json();
      const serverStartTime = data.serverStartTime;
      const lastKnownStart = localStorage.getItem(SERVER_START_KEY);
      
      if (lastKnownStart && serverStartTime && String(serverStartTime) !== lastKnownStart) {
        // Backend was restarted - clear ALL AI-related caches
        console.log('[App] Backend restart detected, clearing AI cache');
        localStorage.removeItem(RESULTS_CACHE_KEY);
        localStorage.removeItem(STORAGE_KEY);
        // Also clear scan-related state
        localStorage.removeItem('currentScanId');
        localStorage.setItem('isScanning', 'false');
      }
      
      // Save current server start time
      if (serverStartTime) {
        localStorage.setItem(SERVER_START_KEY, String(serverStartTime));
      }
    }
  } catch {
    // Ignore errors - backend might not be running
  }
};

const AppContent: React.FC = () => {
  const { isAuthenticated, login } = useAuth();

  // Check for backend restart and clear cache on app load
  useEffect(() => {
    clearCacheOnBackendRestart();
  }, []);

  if (!isAuthenticated) {
    return <LoginForm onLogin={login} />;
  }

  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/scan-results" element={<ScanResultsPage />} />
          <Route path="/analysis-detail" element={<AnalysisPage />} />
          <Route path="/user-profile" element={<UserProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
};

function App() {
  return (
    <AuthProvider>
      <ScanProvider>
        <AppContent />
      </ScanProvider>
    </AuthProvider>
  );
}

export default App;