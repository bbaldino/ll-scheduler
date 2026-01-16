import { useState } from 'react';
import type { SavedConfig, CreateSavedConfigInput } from '@ll-scheduler/shared';
import { saveConfig } from '../api/saved-configs';
import styles from './SaveConfigModal.module.css';

interface SaveConfigModalProps {
  seasonId: string;
  onClose: () => void;
  onSaved: (config: SavedConfig) => void;
}

export function SaveConfigModal({
  seasonId,
  onClose,
  onSaved,
}: SaveConfigModalProps) {
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
      const input: CreateSavedConfigInput = {
        seasonId,
        name: name.trim(),
        description: description.trim() || undefined,
      };

      const saved = await saveConfig(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Save Current Configuration</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.description}>
            This will save a snapshot of: season blackout dates, division configs,
            field/cage availabilities, and date overrides.
          </p>

          <div className={styles.formGroup}>
            <label htmlFor="configName">Name *</label>
            <input
              id="configName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., v1, before changes"
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="configDescription">Description (optional)</label>
            <textarea
              id="configDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add notes about this version..."
              rows={3}
            />
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
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}
