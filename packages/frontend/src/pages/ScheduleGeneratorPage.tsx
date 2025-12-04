import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { fetchDivisions } from '../api/divisions';
import { generateSchedule } from '../api/schedule-generator';
import type {
  Division,
  GenerateScheduleResult,
  SchedulingLogEntry,
} from '@ll-scheduler/shared';
import styles from './ScheduleGeneratorPage.module.css';

export default function ScheduleGeneratorPage() {
  const { currentSeason } = useSeason();
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<string[]>([]);
  const [clearExisting, setClearExisting] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [result, setResult] = useState<GenerateScheduleResult | null>(null);
  const [showLog, setShowLog] = useState<boolean>(false);
  const [logFilter, setLogFilter] = useState<{
    level: 'all' | SchedulingLogEntry['level'];
    category: 'all' | SchedulingLogEntry['category'];
  }>({ level: 'all', category: 'all' });

  useEffect(() => {
    if (currentSeason) {
      loadDivisions();
    }
  }, [currentSeason]);

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
    if (!currentSeason) {
      alert('Please select a season first');
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const generateResult = await generateSchedule({
        seasonId: currentSeason.id,
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

  // Format date range for display
  const formatDateRange = () => {
    const gamesStart = currentSeason.gamesStartDate || currentSeason.startDate;
    if (gamesStart === currentSeason.startDate) {
      return `${currentSeason.startDate} to ${currentSeason.endDate}`;
    }
    return (
      <>
        Full season: {currentSeason.startDate} to {currentSeason.endDate}
        <br />
        Games start: {gamesStart}
      </>
    );
  };

  return (
    <div className={styles.container}>
      <h2>Schedule Generator</h2>
      <p className={styles.description}>
        Generate optimized schedules for games, practices, and batting cage sessions based on
        your configured divisions, teams, fields, and availability windows.
      </p>

      <div className={styles.seasonInfo}>
        <strong>Season:</strong> {currentSeason.name}
        <br />
        <strong>Schedule Period:</strong> {formatDateRange()}
      </div>

      <div className={styles.form}>
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
            Clear existing events before generating
          </label>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
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

          {result.schedulingLog && result.schedulingLog.length > 0 && (
            <div className={styles.logSection}>
              <div className={styles.logHeader}>
                <button
                  className={styles.logToggle}
                  onClick={() => setShowLog(!showLog)}
                >
                  {showLog ? '▼' : '▶'} Scheduling Log ({result.schedulingLog.length} entries)
                </button>
                {showLog && (
                  <div className={styles.logFilters}>
                    <select
                      value={logFilter.level}
                      onChange={(e) => setLogFilter({ ...logFilter, level: e.target.value as typeof logFilter.level })}
                    >
                      <option value="all">All Levels</option>
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="error">Error</option>
                      <option value="debug">Debug</option>
                    </select>
                    <select
                      value={logFilter.category}
                      onChange={(e) => setLogFilter({ ...logFilter, category: e.target.value as typeof logFilter.category })}
                    >
                      <option value="all">All Categories</option>
                      <option value="game">Games</option>
                      <option value="practice">Practices</option>
                      <option value="cage">Cages</option>
                      <option value="resource">Resources</option>
                      <option value="general">General</option>
                    </select>
                  </div>
                )}
              </div>
              {showLog && (
                <div className={styles.logEntries}>
                  {result.schedulingLog
                    .filter((entry) =>
                      (logFilter.level === 'all' || entry.level === logFilter.level) &&
                      (logFilter.category === 'all' || entry.category === logFilter.category)
                    )
                    .map((entry, index) => (
                      <div key={index} className={`${styles.logEntry} ${styles[`log_${entry.level}`]}`}>
                        <span className={styles.logLevel}>{entry.level.toUpperCase()}</span>
                        <span className={styles.logCategory}>[{entry.category}]</span>
                        <span className={styles.logMessage}>{entry.message}</span>
                        {entry.details && (
                          <details className={styles.logDetails}>
                            <summary>Details</summary>
                            <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    ))
                  }
                </div>
              )}
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
