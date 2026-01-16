import { useState } from 'react';
import type { SavedSchedule, CreateSavedScheduleInput } from '@ll-scheduler/shared';
import { saveSchedule } from '../api/saved-schedules';
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

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const input: CreateSavedScheduleInput = {
        seasonId,
        name: name.trim(),
        description: description.trim() || undefined,
      };

      const saved = await saveSchedule(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Save Current Schedule</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.formGroup}>
            <label htmlFor="scheduleName">Name *</label>
            <input
              id="scheduleName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., v1, before game changes"
              autoFocus
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
            {isSaving ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
