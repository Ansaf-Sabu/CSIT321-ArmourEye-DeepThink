import React, { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import Header from './Header';
import Sidebar from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show button when scrolled down more than 400px
      setShowScrollTop(window.scrollY > 400);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-primary">
      <Header />
      <div className="flex">
        <Sidebar collapsed={sidebarCollapsed} onToggle={setSidebarCollapsed} />
        <main 
          className={`flex-1 transition-all duration-300 ${
            sidebarCollapsed ? 'ml-14' : 'ml-48'
          } pt-16`}
        >
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>

      {/* Scroll to top button - positioned bottom left to avoid misclicks */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 left-6 z-50 p-3 bg-accent hover:bg-accent-dark text-white rounded-full shadow-lg transition-all duration-300 hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-primary"
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

export default Layout;