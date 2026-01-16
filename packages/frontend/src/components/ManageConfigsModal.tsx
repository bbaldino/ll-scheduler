import { useState, useEffect } from 'react';
import type { SavedConfig, RestoreConfigResult } from '@ll-scheduler/shared';
import {
  fetchSavedConfigs,
  restoreConfig,
  deleteSavedConfig,
} from '../api/saved-configs';
import styles from './ManageConfigsModal.module.css';

interface ManageConfigsModalProps {
  seasonId: string;
  onClose: () => void;
  onRestored: (result: RestoreConfigResult) => void;
}

type ConfirmAction =
  | { type: 'restore'; config: SavedConfig }
  | { type: 'delete'; config: SavedConfig }
  | null;

export function ManageConfigsModal({
  seasonId,
  onClose,
  onRestored,
}: ManageConfigsModalProps) {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isActioning, setIsActioning] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  useEffect(() => {
    loadConfigs();
  }, [seasonId]);

  const loadConfigs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchSavedConfigs(seasonId);
      // Sort by created date descending (newest first)
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setConfigs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved configs');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async (config: SavedConfig) => {
    setIsActioning(true);
    setError(null);
    try {
      const result = await restoreConfig(config.id);
      setConfirmAction(null);
      onRestored(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore config');
      setConfirmAction(null);
    } finally {
      setIsActioning(false);
    }
  };

  const handleDelete = async (config: SavedConfig) => {
    setIsActioning(true);
    setError(null);
    try {
      await deleteSavedConfig(config.id);
      setConfigs((prev) => prev.filter((c) => c.id !== config.id));
      setConfirmAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete config');
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
          <h2>Saved Configurations</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loading}>Loading saved configurations...</div>
          ) : configs.length === 0 ? (
            <div className={styles.empty}>No saved configurations yet.</div>
          ) : (
            <div className={styles.configList}>
              {configs.map((config) => (
                <div key={config.id} className={styles.configItem}>
                  <div className={styles.configInfo}>
                    <h3 className={styles.configName}>{config.name}</h3>
                    {config.description && (
                      <p className={styles.configDescription}>{config.description}</p>
                    )}
                    <p className={styles.configMeta}>
                      {formatDate(config.createdAt)}
                    </p>
                  </div>
                  <div className={styles.configActions}>
                    <button
                      className={styles.restoreButton}
                      onClick={() => setConfirmAction({ type: 'restore', config })}
                      disabled={isActioning}
                    >
                      Restore
                    </button>
                    <button
                      className={styles.deleteButton}
                      onClick={() => setConfirmAction({ type: 'delete', config })}
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
                <h3>Restore Configuration?</h3>
                <p>
                  This will replace all current division configs, field/cage availabilities,
                  and date overrides with the saved version "{confirmAction.config.name}".
                  This cannot be undone.
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
                    onClick={() => handleRestore(confirmAction.config)}
                    disabled={isActioning}
                  >
                    {isActioning ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Delete Saved Configuration?</h3>
                <p>
                  Delete saved configuration "{confirmAction.config.name}"? This cannot be undone.
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
                    onClick={() => handleDelete(confirmAction.config)}
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
