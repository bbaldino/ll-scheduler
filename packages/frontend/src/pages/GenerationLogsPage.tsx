import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { fetchGenerationLogs } from '../api/schedule-generator';
import type { ScheduleGenerationLog, SchedulingLogEntry } from '@ll-scheduler/shared';
import styles from './GenerationLogsPage.module.css';

export default function GenerationLogsPage() {
  const { currentSeason } = useSeason();
  const [logs, setLogs] = useState<ScheduleGenerationLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ScheduleGenerationLog | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Filters
  const [levelFilter, setLevelFilter] = useState<SchedulingLogEntry['level'] | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<SchedulingLogEntry['category'] | ''>('');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    if (currentSeason) {
      loadLogs();
    }
  }, [currentSeason]);

  const loadLogs = async () => {
    if (!currentSeason) return;

    setIsLoading(true);
    try {
      const logsList = await fetchGenerationLogs(currentSeason.id, 20);
      setLogs(logsList);
      if (logsList.length > 0 && !selectedLog) {
        setSelectedLog(logsList[0]);
      }
    } catch (error) {
      console.error('Failed to load generation logs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getFilteredLogEntries = (): SchedulingLogEntry[] => {
    if (!selectedLog?.log) return [];
    return selectedLog.log.filter((entry) => {
      if (levelFilter && entry.level !== levelFilter) return false;
      if (categoryFilter && entry.category !== categoryFilter) return false;
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        const messageMatch = entry.message.toLowerCase().includes(searchLower);
        const detailsMatch = entry.details
          ? JSON.stringify(entry.details).toLowerCase().includes(searchLower)
          : false;
        if (!messageMatch && !detailsMatch) return false;
      }
      return true;
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getLevelCounts = () => {
    if (!selectedLog?.log) return { info: 0, warning: 0, error: 0, debug: 0 };
    return selectedLog.log.reduce(
      (acc, entry) => {
        acc[entry.level] = (acc[entry.level] || 0) + 1;
        return acc;
      },
      { info: 0, warning: 0, error: 0, debug: 0 } as Record<string, number>
    );
  };

  const getCategoryCounts = () => {
    if (!selectedLog?.log) return {};
    return selectedLog.log.reduce((acc, entry) => {
      acc[entry.category] = (acc[entry.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  };

  if (!currentSeason) {
    return (
      <div className={styles.container}>
        <p>Please select a season to view generation logs.</p>
      </div>
    );
  }

  const filteredEntries = getFilteredLogEntries();
  const levelCounts = getLevelCounts();
  const categoryCounts = getCategoryCounts();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Schedule Generation Logs - {currentSeason.name}</h2>
        <button onClick={loadLogs} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className={styles.content}>
        {/* Sidebar with log list */}
        <div className={styles.sidebar}>
          <h3>Generation History</h3>
          {logs.length === 0 ? (
            <p className={styles.noLogs}>No generation logs found.</p>
          ) : (
            <div className={styles.logList}>
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`${styles.logItem} ${selectedLog?.id === log.id ? styles.selected : ''}`}
                  onClick={() => setSelectedLog(log)}
                >
                  <div className={styles.logItemHeader}>
                    <span className={`${styles.status} ${log.success ? styles.success : styles.failed}`}>
                      {log.success ? 'Success' : 'Failed'}
                    </span>
                    <span className={styles.eventCount}>{log.eventsCreated} events</span>
                  </div>
                  <div className={styles.logItemDate}>{formatDate(log.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Main content */}
        <div className={styles.main}>
          {selectedLog ? (
            <>
              {/* Summary */}
              <div className={styles.summary}>
                <h3>Generation Summary</h3>
                <div className={styles.summaryGrid}>
                  <div className={styles.summaryItem}>
                    <label>Status</label>
                    <span className={selectedLog.success ? styles.success : styles.failed}>
                      {selectedLog.success ? 'Success' : 'Failed'}
                    </span>
                  </div>
                  <div className={styles.summaryItem}>
                    <label>Events Created</label>
                    <span>{selectedLog.eventsCreated}</span>
                  </div>
                  <div className={styles.summaryItem}>
                    <label>Generated</label>
                    <span>{formatDate(selectedLog.createdAt)}</span>
                  </div>
                  {selectedLog.message && (
                    <div className={styles.summaryItem}>
                      <label>Message</label>
                      <span>{selectedLog.message}</span>
                    </div>
                  )}
                </div>

                {/* Statistics */}
                {selectedLog.statistics && (
                  <div className={styles.statistics}>
                    <h4>Event Breakdown</h4>
                    <div className={styles.statsGrid}>
                      <div>Games: {selectedLog.statistics.eventsByType.game}</div>
                      <div>Practices: {selectedLog.statistics.eventsByType.practice}</div>
                      <div>Cage Sessions: {selectedLog.statistics.eventsByType.cage}</div>
                    </div>
                  </div>
                )}

                {/* Log level summary */}
                <div className={styles.levelSummary}>
                  <h4>Log Entries by Level</h4>
                  <div className={styles.levelBadges}>
                    <span className={styles.infoBadge}>Info: {levelCounts.info}</span>
                    <span className={styles.warningBadge}>Warning: {levelCounts.warning}</span>
                    <span className={styles.errorBadge}>Error: {levelCounts.error}</span>
                    <span className={styles.debugBadge}>Debug: {levelCounts.debug}</span>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className={styles.filters}>
                <div className={styles.filterGroup}>
                  <label>Level:</label>
                  <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value as SchedulingLogEntry['level'] | '')}
                  >
                    <option value="">All Levels</option>
                    <option value="info">Info ({levelCounts.info})</option>
                    <option value="warning">Warning ({levelCounts.warning})</option>
                    <option value="error">Error ({levelCounts.error})</option>
                    <option value="debug">Debug ({levelCounts.debug})</option>
                  </select>
                </div>
                <div className={styles.filterGroup}>
                  <label>Category:</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) =>
                      setCategoryFilter(e.target.value as SchedulingLogEntry['category'] | '')
                    }
                  >
                    <option value="">All Categories</option>
                    {Object.entries(categoryCounts).map(([cat, count]) => (
                      <option key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)} ({count})
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.filterGroup}>
                  <label>Search:</label>
                  <input
                    type="text"
                    placeholder="Search messages..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />
                </div>
                <div className={styles.filterCount}>
                  Showing {filteredEntries.length} of {selectedLog.log?.length || 0} entries
                </div>
              </div>

              {/* Log entries */}
              <div className={styles.logEntries}>
                {filteredEntries.length === 0 ? (
                  <p className={styles.noEntries}>No log entries match the current filters.</p>
                ) : (
                  filteredEntries.map((entry, idx) => (
                    <div key={idx} className={`${styles.logEntry} ${styles[entry.level]}`}>
                      <div className={styles.logEntryHeader}>
                        <span className={`${styles.logLevel} ${styles[entry.level]}`}>
                          {entry.level.toUpperCase()}
                        </span>
                        <span className={styles.logCategory}>{entry.category}</span>
                      </div>
                      <div className={styles.logMessage}>{entry.message}</div>
                      {entry.summary && (
                        <details className={styles.logDetails}>
                          <summary>Summary</summary>
                          <div className={styles.summaryContent}>{entry.summary}</div>
                        </details>
                      )}
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <details className={styles.logDetails}>
                          <summary>Raw Details</summary>
                          <div className={styles.detailsContent}>
                            {Object.entries(entry.details).map(([key, value]) => (
                              <div key={key} className={styles.detailItem}>
                                <strong>{key}:</strong>{' '}
                                {typeof value === 'object' ? (
                                  <pre>{JSON.stringify(value, null, 2)}</pre>
                                ) : (
                                  String(value)
                                )}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className={styles.noSelection}>
              <p>Select a generation log from the sidebar to view details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
