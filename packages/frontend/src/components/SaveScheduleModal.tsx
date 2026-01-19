import { useState, useEffect } from 'react';
import type { SavedSchedule, CreateSavedScheduleInput } from '@ll-scheduler/shared';
import { fetchSavedSchedules, saveSchedule, updateSavedSchedule } from '../api/saved-schedules';
import styles from './SaveScheduleModal.module.css';

interface SaveScheduleModalProps {
  seasonId: string;
  currentEventCount: number;
  onClose: () => void;
  onSaved: (schedule: SavedSchedule) => void;
}

export function SaveScheduleModal({
  seasonId,
  currentEventCount,
  onClose,
  onSaved,
}: SaveScheduleModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingSchedules, setExistingSchedules] = useState<SavedSchedule[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(true);
  const [selectedSchedule, setSelectedSchedule] = useState<SavedSchedule | null>(null);

  useEffect(() => {
    loadExistingSchedules();
  }, [seasonId]);

  const loadExistingSchedules = async () => {
    setIsLoadingSchedules(true);
    try {
      const schedules = await fetchSavedSchedules(seasonId);
      // Sort by created date descending (newest first)
      schedules.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExistingSchedules(schedules);
    } catch (err) {
      console.error('Failed to load existing schedules:', err);
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  const handleSelectSchedule = (schedule: SavedSchedule) => {
    setSelectedSchedule(schedule);
    setName(schedule.name);
    setDescription(schedule.description || '');
    setError(null);
  };

  const handleClearSelection = () => {
    setSelectedSchedule(null);
    setName('');
    setDescription('');
    setError(null);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let saved: SavedSchedule;

      if (selectedSchedule) {
        // Update existing schedule
        saved = await updateSavedSchedule(selectedSchedule.id, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
      } else {
        // Create new schedule
        const input: CreateSavedScheduleInput = {
          seasonId,
          name: name.trim(),
          description: description.trim() || undefined,
        };
        saved = await saveSchedule(input);
      }

      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setIsSaving(false);
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
          <h2>Save Schedule</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {/* Existing schedules list */}
          {isLoadingSchedules ? (
            <div className={styles.loadingSchedules}>Loading saved schedules...</div>
          ) : existingSchedules.length > 0 ? (
            <div className={styles.existingSchedules}>
              <div className={styles.existingSchedulesHeader}>
                <span>Existing Saves</span>
                {selectedSchedule && (
                  <button
                    className={styles.clearSelectionButton}
                    onClick={handleClearSelection}
                  >
                    Create New Instead
                  </button>
                )}
              </div>
              <div className={styles.scheduleList}>
                {existingSchedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className={`${styles.scheduleItem} ${selectedSchedule?.id === schedule.id ? styles.selected : ''}`}
                    onClick={() => handleSelectSchedule(schedule)}
                  >
                    <div className={styles.scheduleItemHeader}>
                      <span className={styles.scheduleItemName}>{schedule.name}</span>
                      <span className={styles.scheduleItemEvents}>{schedule.eventCount} events</span>
                    </div>
                    {schedule.description && (
                      <div className={styles.scheduleItemDescription}>{schedule.description}</div>
                    )}
                    <div className={styles.scheduleItemDate}>{formatDate(schedule.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.formGroup}>
            <label htmlFor="scheduleName">Name *</label>
            <input
              id="scheduleName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selectedSchedule ? 'Edit name...' : 'e.g., v1, before game changes'}
              autoFocus={existingSchedules.length === 0}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="scheduleDescription">Description (optional)</label>
            <textarea
              id="scheduleDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add notes about this version..."
              rows={3}
            />
          </div>

          <div className={styles.eventCount}>
            Current events: <strong>{currentEventCount}</strong>
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            className={styles.saveButton}
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
          >
            {isSaving
              ? 'Saving...'
              : selectedSchedule
                ? 'Overwrite Save'
                : 'Save as New'}
          </button>
        </div>
      </div>
    </div>
  );
}
