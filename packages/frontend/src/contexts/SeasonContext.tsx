import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Season } from '@ll-scheduler/shared';
import { fetchSeasons } from '../api/seasons';

interface SeasonContextType {
  currentSeason: Season | null;
  setCurrentSeason: (season: Season | null) => void;
  seasons: Season[];
  loading: boolean;
  refreshSeasons: () => Promise<void>;
}

const SeasonContext = createContext<SeasonContextType | undefined>(undefined);

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [currentSeason, setCurrentSeason] = useState<Season | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSeasons = async () => {
    setLoading(true);
    try {
      const data = await fetchSeasons();
      setSeasons(data);

      // Auto-select the first active season, or the first season if none are active
      if (!currentSeason && data.length > 0) {
        const activeSeason = data.find((s) => s.status === 'active') || data[0];
        setCurrentSeason(activeSeason);
      }
    } catch (error) {
      console.error('Failed to fetch seasons:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSeasons();
  }, []);

  return (
    <SeasonContext.Provider
      value={{ currentSeason, setCurrentSeason, seasons, loading, refreshSeasons }}
    >
      {children}
    </SeasonContext.Provider>
  );
}

export function useSeason() {
  const context = useContext(SeasonContext);
  if (context === undefined) {
    throw new Error('useSeason must be used within a SeasonProvider');
  }
  return context;
}
