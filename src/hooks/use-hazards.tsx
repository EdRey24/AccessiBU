import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Hazard } from '@/constants/hazards';

type NewHazard = Omit<Hazard, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

type HazardStore = {
  hazards: Hazard[];
  addHazard: (hazard: NewHazard) => void;
  removeHazard: (id: string) => void;
};

const HazardContext = createContext<HazardStore | null>(null);

export function HazardProvider({ children }: { children: ReactNode }) {
  const [hazards, setHazards] = useState<Hazard[]>([]);

  const addHazard = useCallback((hazard: NewHazard) => {
    setHazards((prev) => [
      ...prev,
      {
        ...hazard,
        id: hazard.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: hazard.createdAt ?? Date.now(),
      },
    ]);
  }, []);

  const removeHazard = useCallback((id: string) => {
    setHazards((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const value = useMemo(
    () => ({ hazards, addHazard, removeHazard }),
    [hazards, addHazard, removeHazard]
  );

  return <HazardContext.Provider value={value}>{children}</HazardContext.Provider>;
}

export function useHazards(): HazardStore {
  const ctx = useContext(HazardContext);
  if (!ctx) throw new Error('useHazards must be used within a HazardProvider');
  return ctx;
}
