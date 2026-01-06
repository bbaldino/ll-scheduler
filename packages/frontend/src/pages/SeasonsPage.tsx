import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { createSeason, deleteSeason, updateSeason } from '../api/seasons';
import { fetchDivisions } from '../api/divisions';
import {
  fetchDivisionConfigs,
  createDivisionConfig,
  updateDivisionConfig,
  deleteDivisionConfig,
} from '../api/division-configs';
import { fetchSeasonFields } from '../api/fields';
import type {
  Season,
  CreateSeasonInput,
  SeasonStatus,
  Division,
  DivisionConfig,
  CreateDivisionConfigInput,
  GameDayPreference,
  SeasonField,
} from '@ll-scheduler/shared';
import styles from './SeasonsPage.module.css';

export default function SeasonsPage() {
  const { seasons, refreshSeasons, currentSeason, setCurrentSeason } = useSeason();
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<CreateSeasonInput>({
    name: '',
    startDate: '',
    endDate: '',
  });
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);

  // Division configs state
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [seasonDivisionConfigs, setSeasonDivisionConfigs] = useState<Record<string, DivisionConfig[]>>({});
  const [seasonFields, setSeasonFields] = useState<Record<string, SeasonField[]>>({});
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [configFormData, setConfigFormData] = useState<Partial<CreateDivisionConfigInput>>({
    practicesPerWeek: 1,
    practiceDurationHours: 1,
    gamesPerWeek: undefined,
    gameDurationHours: undefined,
    gameDayPreferences: undefined,
    cageSessionsPerWeek: undefined,
    cageSessionDurationHours: undefined,
    fieldPreferences: undefined,
  });

  // Load divisions on mount
  useEffect(() => {
    loadDivisions();
  }, []);

  const loadDivisions = async () => {
    try {
      const data = await fetchDivisions();
      setDivisions(data);
    } catch (error) {
      console.error('Failed to load divisions:', error);
    }
  };

  const loadDivisionConfigsForSeason = async (seasonId: string) => {
    try {
      const configs = await fetchDivisionConfigs(seasonId);
      setSeasonDivisionConfigs((prev) => ({ ...prev, [seasonId]: configs }));
    } catch (error) {
      console.error('Failed to load division configs:', error);
    }
  };

  const loadSeasonFieldsForSeason = async (seasonId: string) => {
    try {
      const fields = await fetchSeasonFields(seasonId);
      setSeasonFields((prev) => ({ ...prev, [seasonId]: fields }));
    } catch (error) {
      console.error('Failed to load season fields:', error);
    }
  };

  const toggleSeasonExpanded = async (seasonId: string) => {
    if (expandedSeasonId === seasonId) {
      setExpandedSeasonId(null);
    } else {
      setExpandedSeasonId(seasonId);
      if (!seasonDivisionConfigs[seasonId]) {
        await loadDivisionConfigsForSeason(seasonId);
      }
      if (!seasonFields[seasonId]) {
        await loadSeasonFieldsForSeason(seasonId);
      }
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createSeason(formData);
      await refreshSeasons();
      setIsCreating(false);
      setFormData({ name: '', startDate: '', endDate: '' });
    } catch (error) {
      console.error('Failed to create season:', error);
      alert('Failed to create season');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (season: Season, updates: Partial<Season>) => {
    try {
      await updateSeason(season.id, updates);
      await refreshSeasons();
    } catch (error) {
      console.error('Failed to update season:', error);
      alert('Failed to update season');
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm('Are you sure you want to delete this season? This will delete all associated data.')
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      await deleteSeason(id);
      // If we deleted the currently selected season, clear the selection
      if (currentSeason?.id === id) {
        setCurrentSeason(null);
      }
      await refreshSeasons();
    } catch (error) {
      console.error('Failed to delete season:', error);
      alert('Failed to delete season');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startCreatingConfig = (seasonId: string, divisionId: string) => {
    setConfigFormData({
      seasonId,
      divisionId,
      practicesPerWeek: 1,
      practiceDurationHours: 1,
      gamesPerWeek: 1,
      gameDurationHours: 2,
      gameDayPreferences: undefined,
      cageSessionsPerWeek: undefined,
      cageSessionDurationHours: undefined,
    });
    setEditingConfigId(`new-${divisionId}`);
  };

  const startEditingConfig = (config: DivisionConfig) => {
    setConfigFormData({
      seasonId: config.seasonId,
      divisionId: config.divisionId,
      practicesPerWeek: config.practicesPerWeek,
      practiceDurationHours: config.practiceDurationHours,
      gamesPerWeek: config.gamesPerWeek,
      gameDurationHours: config.gameDurationHours,
      gameDayPreferences: config.gameDayPreferences,
      cageSessionsPerWeek: config.cageSessionsPerWeek,
      cageSessionDurationHours: config.cageSessionDurationHours,
      fieldPreferences: config.fieldPreferences,
    });
    setEditingConfigId(config.id);
  };

  const handleCreateDivisionConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configFormData.seasonId || !configFormData.divisionId) return;

    try {
      await createDivisionConfig(configFormData as CreateDivisionConfigInput);
      await loadDivisionConfigsForSeason(configFormData.seasonId);
      setEditingConfigId(null);
      setConfigFormData({
        practicesPerWeek: 1,
        practiceDurationHours: 1,
      });
    } catch (error) {
      console.error('Failed to create division config:', error);
      alert('Failed to create division config');
    }
  };

  const handleUpdateDivisionConfig = async (e: React.FormEvent, configId: string) => {
    e.preventDefault();
    if (!configFormData.seasonId) return;

    try {
      await updateDivisionConfig(configId, {
        practicesPerWeek: configFormData.practicesPerWeek,
        practiceDurationHours: configFormData.practiceDurationHours,
        gamesPerWeek: configFormData.gamesPerWeek,
        gameDurationHours: configFormData.gameDurationHours,
        gameDayPreferences: configFormData.gameDayPreferences,
        cageSessionsPerWeek: configFormData.cageSessionsPerWeek,
        cageSessionDurationHours: configFormData.cageSessionDurationHours,
        fieldPreferences: configFormData.fieldPreferences,
      });
      await loadDivisionConfigsForSeason(configFormData.seasonId);
      setEditingConfigId(null);
    } catch (error) {
      console.error('Failed to update division config:', error);
      alert('Failed to update division config');
    }
  };

  const handleDeleteDivisionConfig = async (seasonId: string, configId: string) => {
    if (!confirm('Are you sure you want to delete this division configuration?')) {
      return;
    }
    try {
      await deleteDivisionConfig(configId);
      await loadDivisionConfigsForSeason(seasonId);
    } catch (error) {
      console.error('Failed to delete division config:', error);
      alert('Failed to delete division config');
    }
  };

  // Game day preference helpers
  const addGameDayPreference = () => {
    const preferences = configFormData.gameDayPreferences || [];
    setConfigFormData({
      ...configFormData,
      gameDayPreferences: [
        ...preferences,
        { dayOfWeek: 6, priority: 'preferred' as const },
      ],
    });
  };

  const updateGameDayPreference = (index: number, updates: Partial<GameDayPreference>) => {
    const preferences = configFormData.gameDayPreferences || [];
    const updated = [...preferences];
    updated[index] = { ...updated[index], ...updates };
    setConfigFormData({ ...configFormData, gameDayPreferences: updated });
  };

  const removeGameDayPreference = (index: number) => {
    const preferences = configFormData.gameDayPreferences || [];
    const updated = preferences.filter((_, i) => i !== index);
    setConfigFormData({ ...configFormData, gameDayPreferences: updated.length > 0 ? updated : undefined });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Seasons</h2>
        <button onClick={() => setIsCreating(true)} disabled={isSubmitting || isCreating}>
          Create Season
        </button>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className={styles.form}>
          <h3>Create New Season</h3>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Spring 2024"
              required
            />
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="startDate">Start Date</label>
              <input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) => {
                  const newStartDate = e.target.value;
                  const nextDay = new Date(newStartDate);
                  nextDay.setDate(nextDay.getDate() + 1);
                  const nextDayStr = nextDay.toISOString().split('T')[0];

                  setFormData({
                    ...formData,
                    startDate: newStartDate,
                    endDate: !formData.endDate || formData.endDate < newStartDate ? nextDayStr : formData.endDate
                  });
                }}
                required
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="endDate">End Date</label>
              <input
                id="endDate"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                min={formData.startDate || undefined}
                required
              />
            </div>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="gamesStartDate">Games Start Date (optional)</label>
            <input
              id="gamesStartDate"
              type="date"
              value={formData.gamesStartDate || ''}
              onChange={(e) => setFormData({ ...formData, gamesStartDate: e.target.value || undefined })}
              min={formData.startDate || undefined}
              max={formData.endDate || undefined}
            />
            <p className={styles.helperText}>
              Leave blank to start games on the season start date. Set a later date to allow practices/cages to be scheduled before games begin.
            </p>
          </div>
          <div className={styles.formActions}>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
            <button type="button" onClick={() => setIsCreating(false)} disabled={isSubmitting}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={styles.seasonList}>
        {seasons.map((season) => (
          <div key={season.id} className={styles.seasonCard}>
            <div className={styles.seasonHeader}>
              <h3>{season.name}</h3>
              <div className={styles.seasonActions}>
                <button onClick={() => toggleSeasonExpanded(season.id)} disabled={isSubmitting}>
                  {expandedSeasonId === season.id ? 'Hide' : 'Show'} Details
                </button>
                <button onClick={() => handleDelete(season.id)} disabled={isSubmitting}>
                  {isSubmitting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
            <div className={styles.seasonDetails}>
              <p>
                <strong>Season:</strong> {season.startDate} to {season.endDate}
              </p>
              {season.gamesStartDate && season.gamesStartDate !== season.startDate && (
                <p>
                  <strong>Games Start:</strong> {season.gamesStartDate}
                </p>
              )}
              <p>
                <strong>Status:</strong>
                <select
                  value={season.status}
                  onChange={(e) => handleUpdate(season, { status: e.target.value as SeasonStatus })}
                  className={styles.inlineSelect}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </p>
            </div>

            {expandedSeasonId === season.id && (
              <>
                <div className={styles.divisionsSection}>
                  <div className={styles.phasesSectionHeader}>
                    <h4>Division Configurations</h4>
                  </div>
                  <p className={styles.divisionsSectionDescription}>
                    Configure practice and game settings for each division in this season.
                  </p>

                  {divisions.length === 0 ? (
                    <p className={styles.emptyPhases}>
                      No divisions available. Create divisions first in the Divisions page.
                    </p>
                  ) : (
                    <div className={styles.divisionConfigsList}>
                      {divisions.map((division) => {
                        const existingConfig = seasonDivisionConfigs[season.id]?.find(
                          (config) => config.divisionId === division.id
                        );
                        const isEditing = editingConfigId === (existingConfig?.id || `new-${division.id}`);

                        return (
                          <div key={division.id} className={styles.divisionConfigCard}>
                            <div className={styles.divisionConfigHeader}>
                              <h5>{division.name}</h5>
                              {!isEditing && (
                                <div className={styles.divisionConfigActions}>
                                  {existingConfig ? (
                                    <>
                                      <button onClick={() => startEditingConfig(existingConfig)}>
                                        Edit
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleDeleteDivisionConfig(season.id, existingConfig.id)
                                        }
                                      >
                                        Delete
                                      </button>
                                    </>
                                  ) : (
                                    <button onClick={() => startCreatingConfig(season.id, division.id)}>
                                      Configure
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {isEditing ? (
                              <form
                                onSubmit={(e) =>
                                  existingConfig
                                    ? handleUpdateDivisionConfig(e, existingConfig.id)
                                    : handleCreateDivisionConfig(e)
                                }
                                className={styles.configForm}
                              >
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup}>
                                    <label>Practices/Week</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={configFormData.practicesPerWeek || 0}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          practicesPerWeek: parseInt(e.target.value) || 0,
                                        })
                                      }
                                      required
                                    />
                                  </div>
                                  <div className={styles.formGroup}>
                                    <label>Practice Duration (hours)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.25"
                                      value={configFormData.practiceDurationHours || 0}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          practiceDurationHours: parseFloat(e.target.value) || 0,
                                        })
                                      }
                                      required
                                    />
                                  </div>
                                </div>
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup}>
                                    <label>Games/Week</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={configFormData.gamesPerWeek || 0}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          gamesPerWeek: parseInt(e.target.value) || 0,
                                        })
                                      }
                                      required
                                    />
                                  </div>
                                  <div className={styles.formGroup}>
                                    <label>Game Duration (hours)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.25"
                                      value={configFormData.gameDurationHours || 0}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          gameDurationHours: parseFloat(e.target.value) || 0,
                                        })
                                      }
                                      required
                                    />
                                  </div>
                                </div>
                                <div className={styles.formGroup}>
                                  <label>Game Day Preferences (optional)</label>
                                  {configFormData.gameDayPreferences && configFormData.gameDayPreferences.length > 0 && (
                                    <div className={styles.preferencesList}>
                                      {configFormData.gameDayPreferences.map((pref, index) => (
                                        <div key={index} className={styles.preferenceItem}>
                                          <select
                                            value={pref.dayOfWeek}
                                            onChange={(e) =>
                                              updateGameDayPreference(index, {
                                                dayOfWeek: parseInt(e.target.value),
                                              })
                                            }
                                          >
                                            <option value={0}>Sunday</option>
                                            <option value={1}>Monday</option>
                                            <option value={2}>Tuesday</option>
                                            <option value={3}>Wednesday</option>
                                            <option value={4}>Thursday</option>
                                            <option value={5}>Friday</option>
                                            <option value={6}>Saturday</option>
                                          </select>
                                          <select
                                            value={pref.priority}
                                            onChange={(e) =>
                                              updateGameDayPreference(index, {
                                                priority: e.target.value as GameDayPreference['priority'],
                                              })
                                            }
                                          >
                                            <option value="required">Required</option>
                                            <option value="preferred">Preferred</option>
                                            <option value="acceptable">Acceptable</option>
                                            <option value="avoid">Avoid</option>
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => removeGameDayPreference(index)}
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <button type="button" onClick={addGameDayPreference}>
                                    Add Day Preference
                                  </button>
                                </div>
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup}>
                                    <label>Cage Sessions/Week (optional)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={configFormData.cageSessionsPerWeek || ''}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          cageSessionsPerWeek: e.target.value ? parseInt(e.target.value) : undefined,
                                        })
                                      }
                                    />
                                  </div>
                                  <div className={styles.formGroup}>
                                    <label>Cage Duration (hours, optional)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.25"
                                      value={configFormData.cageSessionDurationHours || ''}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          cageSessionDurationHours: e.target.value ? parseFloat(e.target.value) : undefined,
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                                {/* Field Preferences */}
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                                    <label>Field Preferences (drag to reorder, first = most preferred)</label>
                                    <div className={styles.fieldPreferences}>
                                      {(() => {
                                        const fields = seasonFields[season.id] || [];
                                        const currentPrefs = configFormData.fieldPreferences || [];
                                        // Fields in preference order, then remaining fields
                                        const orderedFields = [
                                          ...currentPrefs.map(id => fields.find(f => f.fieldId === id)).filter(Boolean),
                                          ...fields.filter(f => !currentPrefs.includes(f.fieldId))
                                        ] as SeasonField[];

                                        return orderedFields.map((field, index) => {
                                          const isInPrefs = currentPrefs.includes(field.fieldId);
                                          return (
                                            <div
                                              key={field.fieldId}
                                              className={`${styles.fieldPrefItem} ${isInPrefs ? styles.fieldPrefActive : ''}`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isInPrefs}
                                                onChange={(e) => {
                                                  if (e.target.checked) {
                                                    setConfigFormData({
                                                      ...configFormData,
                                                      fieldPreferences: [...currentPrefs, field.fieldId],
                                                    });
                                                  } else {
                                                    setConfigFormData({
                                                      ...configFormData,
                                                      fieldPreferences: currentPrefs.filter(id => id !== field.fieldId),
                                                    });
                                                  }
                                                }}
                                              />
                                              <span className={styles.fieldPrefName}>
                                                {isInPrefs && <span className={styles.fieldPrefRank}>{currentPrefs.indexOf(field.fieldId) + 1}.</span>}
                                                {field.field?.name || field.fieldId}
                                              </span>
                                              {isInPrefs && index > 0 && currentPrefs.indexOf(field.fieldId) > 0 && (
                                                <button
                                                  type="button"
                                                  className={styles.fieldPrefMoveBtn}
                                                  onClick={() => {
                                                    const idx = currentPrefs.indexOf(field.fieldId);
                                                    const newPrefs = [...currentPrefs];
                                                    [newPrefs[idx - 1], newPrefs[idx]] = [newPrefs[idx], newPrefs[idx - 1]];
                                                    setConfigFormData({ ...configFormData, fieldPreferences: newPrefs });
                                                  }}
                                                >
                                                  ↑
                                                </button>
                                              )}
                                              {isInPrefs && currentPrefs.indexOf(field.fieldId) < currentPrefs.length - 1 && (
                                                <button
                                                  type="button"
                                                  className={styles.fieldPrefMoveBtn}
                                                  onClick={() => {
                                                    const idx = currentPrefs.indexOf(field.fieldId);
                                                    const newPrefs = [...currentPrefs];
                                                    [newPrefs[idx], newPrefs[idx + 1]] = [newPrefs[idx + 1], newPrefs[idx]];
                                                    setConfigFormData({ ...configFormData, fieldPreferences: newPrefs });
                                                  }}
                                                >
                                                  ↓
                                                </button>
                                              )}
                                            </div>
                                          );
                                        });
                                      })()}
                                    </div>
                                  </div>
                                </div>
                                <div className={styles.formActions}>
                                  <button type="submit">{existingConfig ? 'Save' : 'Create'}</button>
                                  <button type="button" onClick={() => setEditingConfigId(null)}>
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : existingConfig ? (
                              <div className={styles.configDetails}>
                                <div className={styles.configDetailRow}>
                                  <span>Practices: {existingConfig.practicesPerWeek}/week</span>
                                  <span>Duration: {existingConfig.practiceDurationHours}h</span>
                                </div>
                                <div className={styles.configDetailRow}>
                                  <span>Games: {existingConfig.gamesPerWeek}/week</span>
                                  <span>Duration: {existingConfig.gameDurationHours}h</span>
                                </div>
                                {existingConfig.gameDayPreferences && existingConfig.gameDayPreferences.length > 0 && (
                                  <div className={styles.configDetailRow}>
                                    <span>Game days: {existingConfig.gameDayPreferences.map((pref) => {
                                      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                                      const priorityIcon = {
                                        required: '⭐',
                                        preferred: '👍',
                                        acceptable: '✓',
                                        avoid: '⛔',
                                      };
                                      return `${days[pref.dayOfWeek]}${priorityIcon[pref.priority]}`;
                                    }).join(', ')}</span>
                                  </div>
                                )}
                                {(existingConfig.cageSessionsPerWeek || existingConfig.cageSessionDurationHours) && (
                                  <div className={styles.configDetailRow}>
                                    {existingConfig.cageSessionsPerWeek && (
                                      <span>Cage sessions: {existingConfig.cageSessionsPerWeek}/week</span>
                                    )}
                                    {existingConfig.cageSessionDurationHours && (
                                      <span>Cage duration: {existingConfig.cageSessionDurationHours}h</span>
                                    )}
                                  </div>
                                )}
                                {existingConfig.fieldPreferences && existingConfig.fieldPreferences.length > 0 && (
                                  <div className={styles.configDetailRow}>
                                    <span>Field preferences: {existingConfig.fieldPreferences.map((fieldId, idx) => {
                                      const field = (seasonFields[season.id] || []).find(f => f.fieldId === fieldId);
                                      return `${idx + 1}. ${field?.field?.name || fieldId}`;
                                    }).join(', ')}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className={styles.noConfig}>Not configured for this season</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {seasons.length === 0 && !isCreating && (
        <div className={styles.empty}>
          <p>No seasons yet. Create one to get started!</p>
        </div>
      )}
    </div>
  );
}
