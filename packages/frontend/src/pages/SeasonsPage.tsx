import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { createSeason, deleteSeason, updateSeason } from '../api/seasons';
import {
  fetchSeasonPeriods,
  createSeasonPeriod,
  updateSeasonPeriod,
  deleteSeasonPeriod,
} from '../api/season-periods';
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
  SeasonPeriod,
  CreateSeasonPeriodInput,
  EventType,
  Division,
  DivisionConfig,
  CreateDivisionConfigInput,
  GameDayPreference,
} from '@ll-scheduler/shared';
import styles from './SeasonsPage.module.css';

export default function SeasonsPage() {
  const { seasons, refreshSeasons } = useSeason();
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<CreateSeasonInput>({
    name: '',
    startDate: '',
    endDate: '',
  });
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);
  const [seasonPeriods, setSeasonPeriods] = useState<Record<string, SeasonPeriod[]>>({});
  const [creatingPeriodForSeason, setCreatingPeriodForSeason] = useState<string | null>(null);
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [periodFormData, setPeriodFormData] = useState<CreateSeasonPeriodInput>({
    seasonId: '',
    name: '',
    eventTypes: ['game', 'practice', 'cage'],
    startDate: '',
    endDate: '',
    sortOrder: 0,
    autoSchedule: true,
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
    gameDayPreferences: undefined,
    cageSessionsPerWeek: undefined,
    cageSessionDurationHours: undefined,
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

  const loadSeasonPeriodsForSeason = async (seasonId: string) => {
    try {
      const periods = await fetchSeasonPeriods(seasonId);
      setSeasonPeriods((prev) => ({ ...prev, [seasonId]: periods }));
    } catch (error) {
      console.error('Failed to load season periods:', error);
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
      if (!seasonPeriods[seasonId]) {
        await loadSeasonPeriodsForSeason(seasonId);
      }
      if (!seasonDivisionConfigs[seasonId]) {
        await loadDivisionConfigsForSeason(seasonId);
      }
    }
  };

  const startCreatingSeasonPeriod = (season: Season) => {
    const nextDay = new Date(season.startDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];

    setPeriodFormData({
      seasonId: season.id,
      name: '',
      eventTypes: ['game', 'practice', 'cage'],
      startDate: season.startDate,
      endDate: nextDayStr,
      sortOrder: 0,
      autoSchedule: true,
    });
    setCreatingPeriodForSeason(season.id);
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
      await refreshSeasons();
    } catch (error) {
      console.error('Failed to delete season:', error);
      alert('Failed to delete season');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateSeasonPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingPeriodForSeason) return;

    if (!periodFormData.name) {
      alert('Please enter a name for the period');
      return;
    }

    if (periodFormData.eventTypes.length === 0) {
      alert('Please select at least one event type');
      return;
    }

    try {
      await createSeasonPeriod({ ...periodFormData, seasonId: creatingPeriodForSeason });
      await loadSeasonPeriodsForSeason(creatingPeriodForSeason);
      setCreatingPeriodForSeason(null);
      setPeriodFormData({
        seasonId: '',
        name: '',
        eventTypes: ['game', 'practice', 'cage'],
        startDate: '',
        endDate: '',
        sortOrder: 0,
        autoSchedule: true,
      });
    } catch (error) {
      console.error('Failed to create season period:', error);
      alert('Failed to create season period');
    }
  };

  const handleDeleteSeasonPeriod = async (seasonId: string, periodId: string) => {
    if (!confirm('Are you sure you want to delete this season period?')) {
      return;
    }
    try {
      await deleteSeasonPeriod(periodId);
      await loadSeasonPeriodsForSeason(seasonId);
    } catch (error) {
      console.error('Failed to delete season period:', error);
      alert('Failed to delete season period');
    }
  };

  const startEditingSeasonPeriod = (period: SeasonPeriod) => {
    setPeriodFormData({
      seasonId: period.seasonId,
      name: period.name,
      eventTypes: period.eventTypes,
      startDate: period.startDate,
      endDate: period.endDate,
      sortOrder: period.sortOrder,
      autoSchedule: period.autoSchedule,
    });
    setEditingPeriodId(period.id);
  };

  const handleUpdateSeasonPeriod = async (e: React.FormEvent, seasonId: string, periodId: string) => {
    e.preventDefault();
    try {
      await updateSeasonPeriod(periodId, {
        name: periodFormData.name,
        eventTypes: periodFormData.eventTypes,
        startDate: periodFormData.startDate,
        endDate: periodFormData.endDate,
        sortOrder: periodFormData.sortOrder,
        autoSchedule: periodFormData.autoSchedule,
      });
      await loadSeasonPeriodsForSeason(seasonId);
      setEditingPeriodId(null);
    } catch (error) {
      console.error('Failed to update season period:', error);
      alert('Failed to update season period');
    }
  };

  const toggleEventType = (eventType: EventType) => {
    const current = periodFormData.eventTypes;
    if (current.includes(eventType)) {
      setPeriodFormData({
        ...periodFormData,
        eventTypes: current.filter((t) => t !== eventType),
      });
    } else {
      setPeriodFormData({
        ...periodFormData,
        eventTypes: [...current, eventType],
      });
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
                    <h4>Season Periods</h4>
                    <button onClick={() => startCreatingSeasonPeriod(season)}>Add Period</button>
                  </div>

                  {creatingPeriodForSeason === season.id && (
                    <form onSubmit={handleCreateSeasonPeriod} className={styles.phaseForm}>
                      <div className={styles.formGroup}>
                        <label>Name</label>
                        <input
                          type="text"
                          value={periodFormData.name}
                          onChange={(e) =>
                            setPeriodFormData({ ...periodFormData, name: e.target.value })
                          }
                          placeholder="e.g., Regular Season, Preseason Practices"
                          required
                        />
                      </div>
                      <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                          <label>Start Date</label>
                          <input
                            type="date"
                            value={periodFormData.startDate}
                            onChange={(e) => {
                              const newStartDate = e.target.value;
                              const nextDay = new Date(newStartDate);
                              nextDay.setDate(nextDay.getDate() + 1);
                              const nextDayStr = nextDay.toISOString().split('T')[0];

                              setPeriodFormData({
                                ...periodFormData,
                                startDate: newStartDate,
                                endDate: !periodFormData.endDate || periodFormData.endDate < newStartDate ? nextDayStr : periodFormData.endDate
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
                            value={periodFormData.endDate}
                            onChange={(e) =>
                              setPeriodFormData({ ...periodFormData, endDate: e.target.value })
                            }
                            min={periodFormData.startDate || season.startDate}
                            max={season.endDate}
                            required
                          />
                        </div>
                      </div>
                      <div className={styles.formGroup}>
                        <label>Event Types</label>
                        <div className={styles.eventTypeCheckboxes}>
                          <label className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={periodFormData.eventTypes.includes('game')}
                              onChange={() => toggleEventType('game')}
                            />
                            Games
                          </label>
                          <label className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={periodFormData.eventTypes.includes('practice')}
                              onChange={() => toggleEventType('practice')}
                            />
                            Practices
                          </label>
                          <label className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={periodFormData.eventTypes.includes('cage')}
                              onChange={() => toggleEventType('cage')}
                            />
                            Batting Cages
                          </label>
                        </div>
                        <p className={styles.helperText}>
                          Select which event types can be scheduled during this period.
                        </p>
                      </div>
                      <div className={styles.formGroup}>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={periodFormData.autoSchedule}
                            onChange={(e) =>
                              setPeriodFormData({ ...periodFormData, autoSchedule: e.target.checked })
                            }
                          />
                          Auto-schedule events for this period
                        </label>
                        <p className={styles.helperText}>
                          Uncheck for periods like "Makeup Games" where events should be manually scheduled.
                        </p>
                      </div>
                      <div className={styles.formActions}>
                        <button type="submit">Add</button>
                        <button type="button" onClick={() => setCreatingPeriodForSeason(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {seasonPeriods[season.id] && seasonPeriods[season.id].length > 0 ? (
                    <div className={styles.phasesList}>
                      {seasonPeriods[season.id].map((period) => {
                        const isEditing = editingPeriodId === period.id;
                        return (
                          <div key={period.id} className={styles.phaseItem}>
                            {isEditing ? (
                              <form onSubmit={(e) => handleUpdateSeasonPeriod(e, season.id, period.id)} className={styles.inlineEditForm}>
                                <div className={styles.formGroup}>
                                  <label>Name</label>
                                  <input
                                    type="text"
                                    value={periodFormData.name}
                                    onChange={(e) =>
                                      setPeriodFormData({ ...periodFormData, name: e.target.value })
                                    }
                                    required
                                  />
                                </div>
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup}>
                                    <label>Start Date</label>
                                    <input
                                      type="date"
                                      value={periodFormData.startDate}
                                      onChange={(e) => setPeriodFormData({ ...periodFormData, startDate: e.target.value })}
                                      min={season.startDate}
                                      max={season.endDate}
                                      required
                                    />
                                  </div>
                                  <div className={styles.formGroup}>
                                    <label>End Date</label>
                                    <input
                                      type="date"
                                      value={periodFormData.endDate}
                                      onChange={(e) => setPeriodFormData({ ...periodFormData, endDate: e.target.value })}
                                      min={periodFormData.startDate || season.startDate}
                                      max={season.endDate}
                                      required
                                    />
                                  </div>
                                </div>
                                <div className={styles.formGroup}>
                                  <label>Event Types</label>
                                  <div className={styles.eventTypeCheckboxes}>
                                    <label className={styles.checkboxLabel}>
                                      <input
                                        type="checkbox"
                                        checked={periodFormData.eventTypes.includes('game')}
                                        onChange={() => toggleEventType('game')}
                                      />
                                      Games
                                    </label>
                                    <label className={styles.checkboxLabel}>
                                      <input
                                        type="checkbox"
                                        checked={periodFormData.eventTypes.includes('practice')}
                                        onChange={() => toggleEventType('practice')}
                                      />
                                      Practices
                                    </label>
                                    <label className={styles.checkboxLabel}>
                                      <input
                                        type="checkbox"
                                        checked={periodFormData.eventTypes.includes('cage')}
                                        onChange={() => toggleEventType('cage')}
                                      />
                                      Batting Cages
                                    </label>
                                  </div>
                                </div>
                                <div className={styles.formGroup}>
                                  <label className={styles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      checked={periodFormData.autoSchedule}
                                      onChange={(e) => setPeriodFormData({ ...periodFormData, autoSchedule: e.target.checked })}
                                    />
                                    Auto-schedule events
                                  </label>
                                </div>
                                <div className={styles.formActions}>
                                  <button type="submit">Save</button>
                                  <button type="button" onClick={() => setEditingPeriodId(null)}>Cancel</button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className={styles.phaseInfo}>
                                  <strong>{period.name}</strong>
                                  <span className={styles.phaseType}>
                                    ({period.eventTypes.join(', ')})
                                  </span>
                                  <span className={styles.phaseDates}>
                                    {period.startDate} to {period.endDate}
                                  </span>
                                  <span className={styles.phaseEventTypes}>
                                    Auto-schedule: {period.autoSchedule ? 'Yes' : 'No'}
                                  </span>
                                </div>
                                <div className={styles.phaseActions}>
                                  <button onClick={() => startEditingSeasonPeriod(period)}>Edit</button>
                                  <button onClick={() => handleDeleteSeasonPeriod(season.id, period.id)}>Delete</button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={styles.emptyPhases}>
                      No season periods defined yet. Add one to get started!
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
                                  <p className={styles.helperText}>
                                    Define preferred days for game scheduling (e.g., "1 weekday + 1 Saturday" or "prefer Saturdays, accept mid-week")
                                  </p>
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
