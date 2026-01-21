import { useState, useEffect } from 'react';
import type {
  ScheduleComparisonResult,
  MetricComparison,
  SavedSchedule,
} from '@ll-scheduler/shared';
import { compareSchedules } from '../api/schedule-generator';
import { fetchSavedSchedules } from '../api/saved-schedules';
import styles from './ScheduleComparisonModal.module.css';

interface Props {
  seasonId: string;
  onClose: () => void;
}

const METRIC_LABELS: Record<string, string> = {
  weeklyRequirements: 'Weekly Requirements',
  homeAwayBalance: 'Home/Away Balance',
  constraintViolations: 'Constraint Violations',
  gameDayPreferences: 'Game Day Preferences',
  gameSpacing: 'Game Spacing',
  practiceSpacing: 'Practice Spacing',
  matchupBalance: 'Matchup Balance',
  matchupSpacing: 'Matchup Spacing',
  gameSlotEfficiency: 'Game Slot Efficiency',
  weeklyGamesDistribution: 'Weekly Games Distribution',
};

export default function ScheduleComparisonModal({ seasonId, onClose }: Props) {
  const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');
  const [comparison, setComparison] = useState<ScheduleComparisonResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSavedSchedules();
  }, [seasonId]);

  const loadSavedSchedules = async () => {
    try {
      setIsLoadingSchedules(true);
      const schedules = await fetchSavedSchedules(seasonId);
      setSavedSchedules(schedules);
      if (schedules.length > 0) {
        setSelectedScheduleId(schedules[0].id);
      }
    } catch (err) {
      console.error('Failed to load saved schedules:', err);
      setError('Failed to load saved schedules');
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  const handleCompare = async () => {
    if (!selectedScheduleId) return;

    try {
      setIsLoading(true);
      setError(null);
      const result = await compareSchedules(seasonId, selectedScheduleId);
      setComparison(result);
    } catch (err) {
      console.error('Failed to compare schedules:', err);
      setError('Failed to compare schedules');
    } finally {
      setIsLoading(false);
    }
  };

  const getScoreClass = (score: number) => {
    if (score >= 80) return styles.scoreGood;
    if (score >= 50) return styles.scoreWarning;
    return styles.scoreBad;
  };

  const getDeltaClass = (delta: number) => {
    if (delta > 0) return styles.deltaPositive;
    if (delta < 0) return styles.deltaNegative;
    return styles.deltaZero;
  };

  const getChangeIcon = (change: MetricComparison['change']) => {
    if (change === 'improved') return '↑';
    if (change === 'regressed') return '↓';
    return '=';
  };

  const getChangeClass = (change: MetricComparison['change']) => {
    if (change === 'improved') return styles.changeImproved;
    if (change === 'regressed') return styles.changeRegressed;
    return styles.changeUnchanged;
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Compare Schedules</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {isLoadingSchedules ? (
            <div className={styles.loading}>Loading saved schedules...</div>
          ) : savedSchedules.length === 0 ? (
            <div className={styles.noSchedules}>
              <p>No saved schedules found.</p>
              <p>Save a schedule first to compare against.</p>
            </div>
          ) : !comparison ? (
            <div className={styles.selectSection}>
              <div className={styles.selectGroup}>
                <label>Compare current schedule with:</label>
                <select
                  value={selectedScheduleId}
                  onChange={(e) => setSelectedScheduleId(e.target.value)}
                  className={styles.select}
                >
                  {savedSchedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name} ({schedule.eventCount} events) - {new Date(schedule.createdAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <button
                className={styles.compareButton}
                onClick={handleCompare}
                disabled={isLoading || !selectedScheduleId}
              >
                {isLoading ? 'Comparing...' : 'Compare Schedules'}
              </button>
            </div>
          ) : (
            <div className={styles.comparisonResults}>
              <button
                className={styles.backButton}
                onClick={() => setComparison(null)}
              >
                &larr; Select Different Schedule
              </button>

              {/* Overall Score Comparison */}
              <div className={styles.scoreComparison}>
                <div className={styles.scoreCard}>
                  <div className={styles.scoreLabel}>Saved: {comparison.savedScheduleName}</div>
                  <div className={`${styles.scoreValue} ${getScoreClass(comparison.overallScore1)}`}>
                    {comparison.overallScore1}%
                  </div>
                </div>
                <div className={styles.scoreDelta}>
                  <div className={`${styles.deltaValue} ${getDeltaClass(comparison.overallScoreDelta)}`}>
                    {comparison.overallScoreDelta > 0 ? '+' : ''}{comparison.overallScoreDelta}%
                  </div>
                  <div className={styles.deltaLabel}>
                    {comparison.overallScoreDelta > 0 ? 'Improvement' : comparison.overallScoreDelta < 0 ? 'Regression' : 'No Change'}
                  </div>
                </div>
                <div className={styles.scoreCard}>
                  <div className={styles.scoreLabel}>Current Schedule</div>
                  <div className={`${styles.scoreValue} ${getScoreClass(comparison.overallScore2)}`}>
                    {comparison.overallScore2}%
                  </div>
                </div>
              </div>

              {/* Summary Stats */}
              <div className={styles.summaryStats}>
                <div className={`${styles.statBadge} ${styles.improved}`}>
                  {comparison.improvementCount} Improved
                </div>
                <div className={`${styles.statBadge} ${styles.unchanged}`}>
                  {comparison.unchangedCount} Unchanged
                </div>
                <div className={`${styles.statBadge} ${styles.regressed}`}>
                  {comparison.regressionCount} Regressed
                </div>
              </div>

              {/* Metric-by-Metric Comparison */}
              <div className={styles.metricsTable}>
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Saved</th>
                      <th>Current</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(comparison.metrics).map(([key, metric]) => (
                      <tr key={key} className={getChangeClass(metric.change)}>
                        <td className={styles.metricName}>{METRIC_LABELS[key] || key}</td>
                        <td className={styles.metricStatus}>
                          <span className={metric.passed1 ? styles.statusPass : styles.statusFail}>
                            {metric.passed1 ? '✓' : '✗'}
                          </span>
                        </td>
                        <td className={styles.metricStatus}>
                          <span className={metric.passed2 ? styles.statusPass : styles.statusFail}>
                            {metric.passed2 ? '✓' : '✗'}
                          </span>
                        </td>
                        <td className={styles.metricChange}>
                          <span className={getChangeClass(metric.change)}>
                            {getChangeIcon(metric.change)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Detailed Summaries */}
              <div className={styles.detailsSection}>
                <h3>Metric Details</h3>
                {Object.entries(comparison.metrics).map(([key, metric]) => (
                  <div key={key} className={`${styles.metricDetail} ${getChangeClass(metric.change)}`}>
                    <div className={styles.metricDetailHeader}>
                      <span className={styles.metricDetailName}>{METRIC_LABELS[key] || key}</span>
                      <span className={getChangeClass(metric.change)}>
                        {getChangeIcon(metric.change)} {metric.change}
                      </span>
                    </div>
                    <div className={styles.metricSummaries}>
                      <div className={styles.summaryRow}>
                        <span className={styles.summaryLabel}>Saved:</span>
                        <span className={styles.summaryText}>{metric.summary1}</span>
                      </div>
                      <div className={styles.summaryRow}>
                        <span className={styles.summaryLabel}>Current:</span>
                        <span className={styles.summaryText}>{metric.summary2}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
