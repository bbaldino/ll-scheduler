import { useState, useEffect } from 'react';
import type { SavedSchedule } from '@ll-scheduler/shared';
import {
  fetchSavedSchedules,
  restoreSchedule,
  deleteSavedSchedule,
} from '../api/saved-schedules';
import styles from './RestoreScheduleModal.module.css';

interface RestoreScheduleModalProps {
  seasonId: string;
  currentEventCount: number;
  onClose: () => void;
  onRestored: (restoredCount: number) => void;
}

type ConfirmAction =
  | { type: 'restore'; schedule: SavedSchedule }
  | { type: 'delete'; schedule: SavedSchedule }
  | null;

export function RestoreScheduleModal({
  seasonId,
  currentEventCount,
  onClose,
  onRestored,
}: RestoreScheduleModalProps) {
  const [schedules, setSchedules] = useState<SavedSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isActioning, setIsActioning] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  useEffect(() => {
    loadSchedules();
  }, [seasonId]);

  const loadSchedules = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchSavedSchedules(seasonId);
      // Sort by created date descending (newest first)
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSchedules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved schedules');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async (schedule: SavedSchedule) => {
    setIsActioning(true);
    setError(null);
    try {
      const result = await restoreSchedule(schedule.id);
      setConfirmAction(null);
      onRestored(result.restoredCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore schedule');
      setConfirmAction(null);
    } finally {
      setIsActioning(false);
    }
  };

  const handleDelete = async (schedule: SavedSchedule) => {
    setIsActioning(true);
    setError(null);
    try {
      await deleteSavedSchedule(schedule.id);
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      setConfirmAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete schedule');
      setConfirmAction(null);
    } finally {
      setIsActioning(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Saved Schedules</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loading}>Loading saved schedules...</div>
          ) : schedules.length === 0 ? (
            <div className={styles.empty}>No saved schedules yet.</div>
          ) : (
            <div className={styles.scheduleList}>
              {schedules.map((schedule) => (
                <div key={schedule.id} className={styles.scheduleItem}>
                  <div className={styles.scheduleInfo}>
                    <h3 className={styles.scheduleName}>{schedule.name}</h3>
                    {schedule.description && (
                      <p className={styles.scheduleDescription}>{schedule.description}</p>
                    )}
                    <p className={styles.scheduleMeta}>
                      {formatDate(schedule.createdAt)} · {schedule.eventCount} events
                    </p>
                  </div>
                  <div className={styles.scheduleActions}>
                    <button
                      className={styles.restoreButton}
                      onClick={() => setConfirmAction({ type: 'restore', schedule })}
                      disabled={isActioning}
                    >
                      Restore
                    </button>
                    <button
                      className={styles.deleteButton}
                      onClick={() => setConfirmAction({ type: 'delete', schedule })}
                      disabled={isActioning}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className={styles.confirmOverlay} onClick={() => setConfirmAction(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            {confirmAction.type === 'restore' ? (
              <>
                <h3>Restore Schedule?</h3>
                <p>
                  This will replace all current scheduled events ({currentEventCount}) with the
                  saved version "{confirmAction.schedule.name}" ({confirmAction.schedule.eventCount}{' '}
                  events). This cannot be undone.
                </p>
                <div className={styles.confirmActions}>
                  <button
                    className={styles.confirmCancel}
                    onClick={() => setConfirmAction(null)}
                    disabled={isActioning}
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.confirmRestore}
                    onClick={() => handleRestore(confirmAction.schedule)}
                    disabled={isActioning}
                  >
                    {isActioning ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Delete Saved Schedule?</h3>
                <p>
                  Delete saved schedule "{confirmAction.schedule.name}"? This cannot be undone.
                </p>
                <div className={styles.confirmActions}>
                  <button
                    className={styles.confirmCancel}
                    onClick={() => setConfirmAction(null)}
                    disabled={isActioning}
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.confirmDelete}
                    onClick={() => handleDelete(confirmAction.schedule)}
                    disabled={isActioning}
                  >
                    {isActioning ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
