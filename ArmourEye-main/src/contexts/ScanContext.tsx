import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export interface ScanTarget {
  id: string;
  name: string;
  type: 'container' | 'image';
  status: 'idle' | 'scanning' | 'completed' | 'failed';
  vulns?: number;
  ip?: string | null;
  image?: string;
  networks?: string[];
  ports?: string[];
}

interface ScanContextType {
  targets: ScanTarget[];
  addTarget: (target: ScanTarget) => void;
  updateTargetStatus: (id: string, status: ScanTarget['status']) => void;
  syncTargets: (latestFromDocker: ScanTarget[]) => void;
}

const STORAGE_KEY = 'scanTargets';

const ScanContext = createContext<ScanContextType | undefined>(undefined);

export function ScanProvider({ children }: { children: ReactNode }) {
  const [targets, setTargetsState] = useState<ScanTarget[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setTargetsState(parsed);
        }
      }
    } catch (error) {
      console.warn('Failed to hydrate scan targets:', error);
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
    } catch (error) {
      console.warn('Failed to persist scan targets:', error);
    }
  }, [targets, isHydrated]);

  const addTarget = (target: ScanTarget) => {
    setTargetsState(prev => {
      const existing = prev.find(t => t.id === target.id);
      if (existing) {
        return prev.map(t => (t.id === target.id ? { ...t, ...target } : t));
      }
      return [...prev, target];
    });
  };

  const updateTargetStatus = (id: string, status: ScanTarget['status']) => {
    setTargetsState(prev => prev.map(t => 
      t.id === id ? { ...t, status } : t
    ));
  };

  const syncTargets = (latestFromDocker: ScanTarget[]) => {
    setTargetsState(prev => {
      const merged = [...prev];
      latestFromDocker.forEach(dockerTarget => {
        const existing = merged.find(t => t.id === dockerTarget.id);
        if (!existing) merged.push(dockerTarget);
      });
      return merged;
    });
  }

  return (
    <ScanContext.Provider value={{ targets, addTarget, updateTargetStatus, syncTargets }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScan() {
  const context = useContext(ScanContext);
  if (context === undefined) {
    throw new Error('useScan must be used within a ScanProvider');
  }
  return context;
}