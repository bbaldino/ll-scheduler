import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { fetchSeasonPhases } from '../api/season-phases';
import { fetchDivisions } from '../api/divisions';
import { generateSchedule } from '../api/schedule-generator';
import type {
  SeasonPhase,
  Division,
  GenerateScheduleResult,
} from '@ll-scheduler/shared';
import styles from './ScheduleGeneratorPage.module.css';

export default function ScheduleGeneratorPage() {
  const { currentSeason } = useSeason();
  const [phases, setPhases] = useState<SeasonPhase[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>('');
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<string[]>([]);
  const [clearExisting, setClearExisting] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [result, setResult] = useState<GenerateScheduleResult | null>(null);

  useEffect(() => {
    if (currentSeason) {
      loadPhases();
      loadDivisions();
    }
  }, [currentSeason]);

  const loadPhases = async () => {
    if (!currentSeason) return;
    try {
      const data = await fetchSeasonPhases(currentSeason.id);
      setPhases(data);
      if (data.length > 0 && !selectedPhaseId) {
        setSelectedPhaseId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to load phases:', error);
    }
  };

  const loadDivisions = async () => {
    try {
      const data = await fetchDivisions();
      setDivisions(data);
    } catch (error) {
      console.error('Failed to load divisions:', error);
    }
  };

  const handleDivisionToggle = (divisionId: string) => {
    setSelectedDivisionIds((prev) =>
      prev.includes(divisionId)
        ? prev.filter((id) => id !== divisionId)
        : [...prev, divisionId]
    );
  };

  const handleGenerate = async () => {
    if (!selectedPhaseId) {
      alert('Please select a season phase');
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const generateResult = await generateSchedule({
        seasonPhaseId: selectedPhaseId,
        divisionIds: selectedDivisionIds.length > 0 ? selectedDivisionIds : undefined,
        clearExisting,
      });

      setResult(generateResult);
    } catch (error) {
      console.error('Failed to generate schedule:', error);
      setResult({
        success: false,
        eventsCreated: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (!currentSeason) {
    return (
      <div className={styles.container}>
        <h2>Schedule Generator</h2>
        <p className={styles.noSeason}>
          Please select a season first to generate schedules.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2>Schedule Generator</h2>
      <p className={styles.description}>
        Generate optimized schedules for games, practices, and batting cage sessions based on
        your configured divisions, teams, fields, and availability windows.
      </p>

      <div className={styles.form}>
        <div className={styles.formGroup}>
          <label htmlFor="phase-select">Season Phase *</label>
          <select
            id="phase-select"
            value={selectedPhaseId}
            onChange={(e) => setSelectedPhaseId(e.target.value)}
            disabled={isGenerating}
          >
            <option value="">Select a phase</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name} ({phase.startDate} to {phase.endDate})
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formGroup}>
          <label>Divisions (optional - leave empty for all)</label>
          <div className={styles.checkboxGroup}>
            {divisions.map((division) => (
              <label key={division.id} className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={selectedDivisionIds.includes(division.id)}
                  onChange={() => handleDivisionToggle(division.id)}
                  disabled={isGenerating}
                />
                {division.name}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={(e) => setClearExisting(e.target.checked)}
              disabled={isGenerating}
            />
            Clear existing events in this phase before generating
          </label>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating || !selectedPhaseId}
          className={styles.generateButton}
        >
          {isGenerating ? 'Generating...' : 'Generate Schedule'}
        </button>
      </div>

      {result && (
        <div className={`${styles.result} ${result.success ? styles.success : styles.error}`}>
          <h3>{result.success ? 'Success!' : 'Generation Failed'}</h3>
          <p className={styles.message}>{result.message}</p>

          {result.statistics && (
            <div className={styles.statistics}>
              <h4>Statistics</h4>
              <div className={styles.statsGrid}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Total Events:</span>
                  <span className={styles.statValue}>{result.statistics.totalEvents}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Games:</span>
                  <span className={styles.statValue}>{result.statistics.eventsByType.game}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Practices:</span>
                  <span className={styles.statValue}>{result.statistics.eventsByType.practice}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Cage Sessions:</span>
                  <span className={styles.statValue}>{result.statistics.eventsByType.cage}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Avg Events/Team:</span>
                  <span className={styles.statValue}>
                    {result.statistics.averageEventsPerTeam.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className={styles.errors}>
              <h4>Errors</h4>
              {result.errors.map((error, index) => (
                <div key={index} className={styles.errorItem}>
                  <strong>{error.type}:</strong> {error.message}
                </div>
              ))}
            </div>
          )}

          {result.warnings && result.warnings.length > 0 && (
            <div className={styles.warnings}>
              <h4>Warnings</h4>
              {result.warnings.map((warning, index) => (
                <div key={index} className={styles.warningItem}>
                  <strong>{warning.type}:</strong> {warning.message}
                </div>
              ))}
            </div>
          )}

          {result.success && (
            <p className={styles.nextSteps}>
              View the generated schedule on the <a href="/events">Scheduled Events</a> page.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
