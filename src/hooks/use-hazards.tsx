import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';

import type { Hazard } from '@/constants/hazards';
import { useSession } from '@/hooks/use-session';
import { failureMessage } from '@/services/api';
import { listHazards } from '@/services/hazards';

type NewHazard = Omit<Hazard, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

type HazardStore = {
  hazards: Hazard[];
  addHazard: (hazard: NewHazard) => void;
  removeHazard: (id: string) => void;
  /** Reloads the shared hazards from the backend. */
  refresh: () => Promise<void>;
  /** True while the first (or a manual) load is in flight. */
  loading: boolean;
  /** Set when the last load failed. Null after a successful load. */
  error: string | null;
};

const HazardContext = createContext<HazardStore | null>(null);

/** Merges fetched hazards with local ones, keeping one entry per id. */
function mergeById(local: Hazard[], fetched: Hazard[]): Hazard[] {
  const byId = new Map<string, Hazard>();
  // Local entries win: a hazard this device just created carries richer
  // detail (floor, pin, room) than the coordinate-only server row.
  for (const h of fetched) byId.set(h.id, h);
  for (const h of local) byId.set(h.id, h);
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function HazardProvider({ children }: { children: ReactNode }) {
  const { member } = useSession();
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await listHazards();
      setHazards((prev) => mergeById(prev, fetched));
      setError(null);
    } catch (caught) {
      setError(failureMessage(caught, 'Hazards could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Public refresh: scheduled off the current tick so callers (including the
  // mount effect) never run setState synchronously, which would trigger
  // cascading renders.
  const refresh = useCallback(async () => {
    await Promise.resolve();
    await load();
  }, [load]);

  // Load the shared list once the member is signed in (the read route
  // requires a session), and whenever the account changes. On sign-out the
  // list is cleared. All state updates are deferred to a microtask so the
  // effect body itself never sets state synchronously.
  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      if (!member) {
        setHazards([]);
        setError(null);
        return;
      }
      await load();
    })();
    return () => {
      active = false;
    };
  }, [member, load]);

  const addHazard = useCallback((hazard: NewHazard) => {
    setHazards((prev) =>
      mergeById(
        [
          ...prev,
          {
            ...hazard,
            id: hazard.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: hazard.createdAt ?? Date.now(),
          },
        ],
        []
      )
    );
  }, []);

  const removeHazard = useCallback((id: string) => {
    setHazards((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const value = useMemo(
    () => ({ hazards, addHazard, removeHazard, refresh, loading, error }),
    [hazards, addHazard, removeHazard, refresh, loading, error]
  );

  return <HazardContext.Provider value={value}>{children}</HazardContext.Provider>;
}

export function useHazards(): HazardStore {
  const ctx = useContext(HazardContext);
  if (!ctx) throw new Error('useHazards must be used within a HazardProvider');
  return ctx;
}
