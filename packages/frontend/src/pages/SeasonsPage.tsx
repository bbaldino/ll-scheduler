import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { createSeason, deleteSeason, updateSeason } from '../api/seasons';
import {
  fetchSeasonPhases,
  createSeasonPhase,
  deleteSeasonPhase,
} from '../api/season-phases';
import { fetchDivisions } from '../api/divisions';
import {
  fetchDivisionConfigs,
  createDivisionConfig,
  updateDivisionConfig,
  deleteDivisionConfig,
} from '../api/division-configs';
import type {
  Season,
  CreateSeasonInput,
  SeasonStatus,
  SeasonPhase,
  CreateSeasonPhaseInput,
  SeasonPhaseType,
  Division,
  DivisionConfig,
  CreateDivisionConfigInput,
} from '@ll-scheduler/shared';
import styles from './SeasonsPage.module.css';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export default function SeasonsPage() {
  const { seasons, refreshSeasons } = useSeason();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<CreateSeasonInput>({
    name: '',
    startDate: '',
    endDate: '',
  });
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);
  const [seasonPhases, setSeasonPhases] = useState<Record<string, SeasonPhase[]>>({});
  const [creatingPhaseForSeason, setCreatingPhaseForSeason] = useState<string | null>(null);
  const [phaseFormData, setPhaseFormData] = useState<CreateSeasonPhaseInput>({
    seasonId: '',
    name: '',
    phaseType: 'regular',
    startDate: '',
    endDate: '',
    sortOrder: 0,
  });

  // Division configs state
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [seasonDivisionConfigs, setSeasonDivisionConfigs] = useState<Record<string, DivisionConfig[]>>({});
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [configFormData, setConfigFormData] = useState<Partial<CreateDivisionConfigInput>>({
    practicesPerWeek: 1,
    practiceDurationHours: 1,
    gamesPerWeek: undefined,
    gameDurationHours: undefined,
    minConsecutiveDayGap: undefined,
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

  const loadPhasesForSeason = async (seasonId: string) => {
    try {
      const phases = await fetchSeasonPhases(seasonId);
      setSeasonPhases((prev) => ({ ...prev, [seasonId]: phases }));
    } catch (error) {
      console.error('Failed to load phases:', error);
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

  const toggleSeasonExpanded = async (seasonId: string) => {
    if (expandedSeasonId === seasonId) {
      setExpandedSeasonId(null);
    } else {
      setExpandedSeasonId(seasonId);
      if (!seasonPhases[seasonId]) {
        await loadPhasesForSeason(seasonId);
      }
      if (!seasonDivisionConfigs[seasonId]) {
        await loadDivisionConfigsForSeason(seasonId);
      }
    }
  };

  const startCreatingPhase = (season: Season) => {
    const nextDay = new Date(season.startDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];

    setPhaseFormData({
      seasonId: season.id,
      name: '',
      phaseType: 'regular',
      startDate: season.startDate,
      endDate: nextDayStr,
      sortOrder: 0,
    });
    setCreatingPhaseForSeason(season.id);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSeason(formData);
      await refreshSeasons();
      setIsCreating(false);
      setFormData({ name: '', startDate: '', endDate: '' });
    } catch (error) {
      console.error('Failed to create season:', error);
      alert('Failed to create season');
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
    try {
      await deleteSeason(id);
      await refreshSeasons();
    } catch (error) {
      console.error('Failed to delete season:', error);
      alert('Failed to delete season');
    }
  };

  const handleCreatePhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingPhaseForSeason) return;

    try {
      await createSeasonPhase({ ...phaseFormData, seasonId: creatingPhaseForSeason });
      await loadPhasesForSeason(creatingPhaseForSeason);
      setCreatingPhaseForSeason(null);
      setPhaseFormData({
        seasonId: '',
        name: '',
        phaseType: 'regular',
        startDate: '',
        endDate: '',
        sortOrder: 0,
      });
    } catch (error) {
      console.error('Failed to create phase:', error);
      alert('Failed to create phase');
    }
  };

  const handleDeletePhase = async (seasonId: string, phaseId: string) => {
    if (!confirm('Are you sure you want to delete this phase?')) {
      return;
    }
    try {
      await deleteSeasonPhase(phaseId);
      await loadPhasesForSeason(seasonId);
    } catch (error) {
      console.error('Failed to delete phase:', error);
      alert('Failed to delete phase');
    }
  };

  const startCreatingConfig = (seasonId: string, divisionId: string) => {
    setConfigFormData({
      seasonId,
      divisionId,
      practicesPerWeek: 1,
      practiceDurationHours: 1,
      gamesPerWeek: undefined,
      gameDurationHours: undefined,
      minConsecutiveDayGap: undefined,
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
      minConsecutiveDayGap: config.minConsecutiveDayGap,
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
        minConsecutiveDayGap: configFormData.minConsecutiveDayGap,
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Seasons</h2>
        <button onClick={() => setIsCreating(true)}>Create Season</button>
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
          <div className={styles.formActions}>
            <button type="submit">Create</button>
            <button type="button" onClick={() => setIsCreating(false)}>
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
                <button onClick={() => toggleSeasonExpanded(season.id)}>
                  {expandedSeasonId === season.id ? 'Hide' : 'Show'} Phases
                </button>
                <button onClick={() => handleDelete(season.id)}>Delete</button>
              </div>
            </div>
            <div className={styles.seasonDetails}>
              <p>
                <strong>Period:</strong> {season.startDate} to {season.endDate}
              </p>
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
                <div className={styles.phasesSection}>
                  <div className={styles.phasesSectionHeader}>
                    <h4>Season Phases</h4>
                    <button onClick={() => startCreatingPhase(season)}>Add Phase</button>
                  </div>

                  {creatingPhaseForSeason === season.id && (
                    <form onSubmit={handleCreatePhase} className={styles.phaseForm}>
                      <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                          <label>Name</label>
                          <input
                            type="text"
                            value={phaseFormData.name}
                            onChange={(e) =>
                              setPhaseFormData({ ...phaseFormData, name: e.target.value })
                            }
                            placeholder="e.g., Regular Season"
                            required
                          />
                        </div>
                        <div className={styles.formGroup}>
                          <label>Type</label>
                          <select
                            value={phaseFormData.phaseType}
                            onChange={(e) =>
                              setPhaseFormData({
                                ...phaseFormData,
                                phaseType: e.target.value as SeasonPhaseType,
                              })
                            }
                          >
                            <option value="regular">Regular Season</option>
                            <option value="makeup">Makeup Games</option>
                            <option value="playoffs">Playoffs</option>
                            <option value="championship">Championship</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                      </div>
                      <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                          <label>Start Date</label>
                          <input
                            type="date"
                            value={phaseFormData.startDate}
                            onChange={(e) => {
                              const newStartDate = e.target.value;
                              const nextDay = new Date(newStartDate);
                              nextDay.setDate(nextDay.getDate() + 1);
                              const nextDayStr = nextDay.toISOString().split('T')[0];

                              setPhaseFormData({
                                ...phaseFormData,
                                startDate: newStartDate,
                                endDate: !phaseFormData.endDate || phaseFormData.endDate < newStartDate ? nextDayStr : phaseFormData.endDate
                              });
                            }}
                            min={season.startDate}
                            max={season.endDate}
                            required
                          />
                        </div>
                        <div className={styles.formGroup}>
                          <label>End Date</label>
                          <input
                            type="date"
                            value={phaseFormData.endDate}
                            onChange={(e) =>
                              setPhaseFormData({ ...phaseFormData, endDate: e.target.value })
                            }
                            min={phaseFormData.startDate || season.startDate}
                            max={season.endDate}
                            required
                          />
                        </div>
                      </div>
                      <div className={styles.formActions}>
                        <button type="submit">Add</button>
                        <button type="button" onClick={() => setCreatingPhaseForSeason(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {seasonPhases[season.id] && seasonPhases[season.id].length > 0 ? (
                    <div className={styles.phasesList}>
                      {seasonPhases[season.id].map((phase) => (
                        <div key={phase.id} className={styles.phaseItem}>
                          <div className={styles.phaseInfo}>
                            <strong>{phase.name}</strong>
                            <span className={styles.phaseType}>({phase.phaseType})</span>
                            <span className={styles.phaseDates}>
                              {phase.startDate} to {phase.endDate}
                            </span>
                          </div>
                          <button onClick={() => handleDeletePhase(season.id, phase.id)}>
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.emptyPhases}>
                      No phases defined yet. Add one to get started!
                    </p>
                  )}
                </div>

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
                                    <label>Games/Week (optional)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={configFormData.gamesPerWeek || ''}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          gamesPerWeek: e.target.value ? parseInt(e.target.value) : undefined,
                                        })
                                      }
                                    />
                                  </div>
                                  <div className={styles.formGroup}>
                                    <label>Game Duration (hours, optional)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.25"
                                      value={configFormData.gameDurationHours || ''}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          gameDurationHours: e.target.value ? parseFloat(e.target.value) : undefined,
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                                <div className={styles.formGroup}>
                                  <label>Min Gap Between Events (days, optional)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={configFormData.minConsecutiveDayGap || ''}
                                    onChange={(e) =>
                                      setConfigFormData({
                                        ...configFormData,
                                        minConsecutiveDayGap: e.target.value ? parseInt(e.target.value) : undefined,
                                      })
                                    }
                                  />
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
                                {(existingConfig.gamesPerWeek || existingConfig.gameDurationHours) && (
                                  <div className={styles.configDetailRow}>
                                    {existingConfig.gamesPerWeek && (
                                      <span>Games: {existingConfig.gamesPerWeek}/week</span>
                                    )}
                                    {existingConfig.gameDurationHours && (
                                      <span>Duration: {existingConfig.gameDurationHours}h</span>
                                    )}
                                  </div>
                                )}
                                {existingConfig.minConsecutiveDayGap && (
                                  <div className={styles.configDetailRow}>
                                    <span>Min gap: {existingConfig.minConsecutiveDayGap} days</span>
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
