import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { fetchSeasonPeriods } from '../api/season-periods';
import { fetchDivisions } from '../api/divisions';
import { generateSchedule } from '../api/schedule-generator';
import type {
  SeasonPeriod,
  Division,
  GenerateScheduleResult,
} from '@ll-scheduler/shared';
import styles from './ScheduleGeneratorPage.module.css';

export default function ScheduleGeneratorPage() {
  const { currentSeason } = useSeason();
  const [seasonPeriods, setSeasonPeriods] = useState<SeasonPeriod[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<string[]>([]);
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<string[]>([]);
  const [clearExisting, setClearExisting] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [result, setResult] = useState<GenerateScheduleResult | null>(null);

  useEffect(() => {
    if (currentSeason) {
      loadSeasonPeriods();
      loadDivisions();
    }
  }, [currentSeason]);

  const loadSeasonPeriods = async () => {
    if (!currentSeason) return;
    try {
      const data = await fetchSeasonPeriods(currentSeason.id);
      setSeasonPeriods(data);
      // Pre-select all auto-schedulable periods
      const autoScheduleIds = data.filter((p) => p.autoSchedule).map((p) => p.id);
      setSelectedPeriodIds(autoScheduleIds);
    } catch (error) {
      console.error('Failed to load season periods:', error);
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

  const handlePeriodToggle = (periodId: string) => {
    setSelectedPeriodIds((prev) =>
      prev.includes(periodId)
        ? prev.filter((id) => id !== periodId)
        : [...prev, periodId]
    );
  };

  const handleDivisionToggle = (divisionId: string) => {
    setSelectedDivisionIds((prev) =>
      prev.includes(divisionId)
        ? prev.filter((id) => id !== divisionId)
        : [...prev, divisionId]
    );
  };

  const handleGenerate = async () => {
    if (selectedPeriodIds.length === 0) {
      alert('Please select at least one season period');
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const generateResult = await generateSchedule({
        periodIds: selectedPeriodIds,
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
          <label>Season Periods *</label>
          <p className={styles.helperText}>
            Select the periods to include in the schedule. Auto-schedulable periods are pre-selected.
          </p>
          <div className={styles.checkboxGroup}>
            {seasonPeriods.length === 0 ? (
              <p className={styles.emptyMessage}>
                No season periods defined. Add periods on the Seasons page.
              </p>
            ) : (
              seasonPeriods.map((period) => (
                <label key={period.id} className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={selectedPeriodIds.includes(period.id)}
                    onChange={() => handlePeriodToggle(period.id)}
                    disabled={isGenerating}
                  />
                  <span className={styles.periodLabel}>
                    <strong>{period.name}</strong>
                    <span className={styles.periodDates}>
                      {period.startDate} to {period.endDate}
                    </span>
                    <span className={styles.periodEventTypes}>
                      ({period.eventTypes.join(', ')})
                    </span>
                    {!period.autoSchedule && (
                      <span className={styles.manualBadge}>Manual</span>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>
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
            Clear existing events in selected periods before generating
          </label>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating || selectedPeriodIds.length === 0}
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
