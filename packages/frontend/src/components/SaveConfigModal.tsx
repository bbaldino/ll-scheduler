import { useState, useEffect } from 'react';
import type { SavedConfig, CreateSavedConfigInput } from '@ll-scheduler/shared';
import { fetchSavedConfigs, saveConfig, updateSavedConfig } from '../api/saved-configs';
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
  const [existingConfigs, setExistingConfigs] = useState<SavedConfig[]>([]);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(true);
  const [selectedConfig, setSelectedConfig] = useState<SavedConfig | null>(null);

  useEffect(() => {
    loadExistingConfigs();
  }, [seasonId]);

  const loadExistingConfigs = async () => {
    setIsLoadingConfigs(true);
    try {
      const configs = await fetchSavedConfigs(seasonId);
      // Sort by created date descending (newest first)
      configs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExistingConfigs(configs);
    } catch (err) {
      console.error('Failed to load existing configs:', err);
    } finally {
      setIsLoadingConfigs(false);
    }
  };

  const handleSelectConfig = (config: SavedConfig) => {
    setSelectedConfig(config);
    setName(config.name);
    setDescription(config.description || '');
    setError(null);
  };

  const handleClearSelection = () => {
    setSelectedConfig(null);
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
      let saved: SavedConfig;

      if (selectedConfig) {
        // Update existing config
        saved = await updateSavedConfig(selectedConfig.id, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
      } else {
        // Create new config
        const input: CreateSavedConfigInput = {
          seasonId,
          name: name.trim(),
          description: description.trim() || undefined,
        };
        saved = await saveConfig(input);
      }

      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
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
          <h2>Save Configuration</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.description}>
            This will save a snapshot of: season blackout dates, division configs,
            field/cage availabilities, and date overrides.
          </p>

          {/* Existing configs list */}
          {isLoadingConfigs ? (
            <div className={styles.loadingConfigs}>Loading saved configurations...</div>
          ) : existingConfigs.length > 0 ? (
            <div className={styles.existingConfigs}>
              <div className={styles.existingConfigsHeader}>
                <span>Existing Saves</span>
                {selectedConfig && (
                  <button
                    className={styles.clearSelectionButton}
                    onClick={handleClearSelection}
                  >
                    Create New Instead
                  </button>
                )}
              </div>
              <div className={styles.configList}>
                {existingConfigs.map((config) => (
                  <div
                    key={config.id}
                    className={`${styles.configItem} ${selectedConfig?.id === config.id ? styles.selected : ''}`}
                    onClick={() => handleSelectConfig(config)}
                  >
                    <div className={styles.configItemName}>{config.name}</div>
                    {config.description && (
                      <div className={styles.configItemDescription}>{config.description}</div>
                    )}
                    <div className={styles.configItemDate}>{formatDate(config.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.formGroup}>
            <label htmlFor="configName">Name *</label>
            <input
              id="configName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selectedConfig ? 'Edit name...' : 'e.g., v1, before changes'}
              autoFocus={existingConfigs.length === 0}
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
            {isSaving
              ? 'Saving...'
              : selectedConfig
                ? 'Overwrite Save'
                : 'Save as New'}
          </button>
        </div>
      </div>
    </div>
  );
}
