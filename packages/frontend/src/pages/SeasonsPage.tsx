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
import { fetchSeasonCages } from '../api/batting-cages';
import { fetchTeams } from '../api/teams';
import { deleteScheduledEventsBulk } from '../api/scheduled-events';
import { SaveConfigModal } from '../components/SaveConfigModal';
import { ManageConfigsModal } from '../components/ManageConfigsModal';
import type {
  Season,
  CreateSeasonInput,
  SeasonStatus,
  SeasonBlackout,
  Division,
  DivisionConfig,
  CreateDivisionConfigInput,
  GameDayPreference,
  GameWeekOverride,
  SeasonField,
  SeasonCage,
  Team,
  EventType,
  RestoreConfigResult,
} from '@ll-scheduler/shared';
import styles from './SeasonsPage.module.css';

// Helper to generate week definitions for a season's game period
function generateGameWeeks(gamesStartDate: string, endDate: string): Array<{ weekNumber: number; startDate: string; endDate: string }> {
  if (!gamesStartDate || !endDate) return [];

  const weeks: Array<{ weekNumber: number; startDate: string; endDate: string }> = [];
  const start = new Date(gamesStartDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  // Find the start of the first week (Monday of the week containing gamesStartDate)
  // This must match the backend's generateWeekDefinitions in draft.ts
  // getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  // For Monday-based weeks: Sunday goes back 6 days, other days go back (day-1) days
  let weekStart = new Date(start);
  const dayOfWeek = weekStart.getDay();
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekStart.setDate(weekStart.getDate() - daysToSubtract);

  let weekNumber = 1;
  while (weekStart <= end) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    weeks.push({
      weekNumber,
      startDate: weekStart.toISOString().split('T')[0],
      endDate: weekEnd.toISOString().split('T')[0],
    });

    weekStart.setDate(weekStart.getDate() + 7);
    weekNumber++;
  }

  return weeks;
}

function formatWeekDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
}

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
  const [seasonCages, setSeasonCages] = useState<Record<string, SeasonCage[]>>({});
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [configFormData, setConfigFormData] = useState<Partial<CreateDivisionConfigInput>>({
    practicesPerWeek: 1,
    practiceDurationHours: 1,
    practiceArriveBeforeMinutes: 10,
    gamesPerWeek: undefined,
    maxGamesPerWeek: undefined,
    gameDurationHours: undefined,
    gameArriveBeforeHours: undefined,
    gameDayPreferences: undefined,
    cageSessionsPerWeek: undefined,
    cageSessionDurationHours: undefined,
    fieldPreferences: undefined,
    sundayPairedPracticeEnabled: undefined,
    sundayPairedPracticeDurationHours: undefined,
    sundayPairedPracticeFieldId: undefined,
    sundayPairedPracticeCageId: undefined,
    gameSpacingEnabled: undefined,
  });

  // Game week overrides state
  const [addingOverrideForConfigId, setAddingOverrideForConfigId] = useState<string | null>(null);
  const [newOverrideWeek, setNewOverrideWeek] = useState<number>(1);
  const [newOverrideGames, setNewOverrideGames] = useState<number>(0);

  // Delete events state
  const [deleteEventsExpandedForSeasonId, setDeleteEventsExpandedForSeasonId] = useState<string | null>(null);
  const [seasonTeams, setSeasonTeams] = useState<Record<string, Team[]>>({});
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<string[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<EventType[]>([]);
  const [isDeletingEvents, setIsDeletingEvents] = useState(false);
  const [deleteEventsStatus, setDeleteEventsStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Saved configs modal state
  const [showSaveConfigForSeasonId, setShowSaveConfigForSeasonId] = useState<string | null>(null);
  const [showManageConfigsForSeasonId, setShowManageConfigsForSeasonId] = useState<string | null>(null);

  // Blackout dates editing state
  const [editingBlackoutsForSeasonId, setEditingBlackoutsForSeasonId] = useState<string | null>(null);
  // State for the blackout being added/edited in the dialog (index: null = new, number = editing existing)
  const [editingBlackout, setEditingBlackout] = useState<{
    seasonId: string;
    index: number | null;
    data: SeasonBlackout;
  } | null>(null);

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

  const loadSeasonCagesForSeason = async (seasonId: string) => {
    try {
      const cages = await fetchSeasonCages(seasonId);
      setSeasonCages((prev) => ({ ...prev, [seasonId]: cages }));
    } catch (error) {
      console.error('Failed to load season cages:', error);
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
      if (!seasonCages[seasonId]) {
        await loadSeasonCagesForSeason(seasonId);
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
      practiceArriveBeforeMinutes: 10,
      gamesPerWeek: 1,
      gameDurationHours: 2,
      gameArriveBeforeHours: 0,
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
      practiceArriveBeforeMinutes: config.practiceArriveBeforeMinutes,
      gamesPerWeek: config.gamesPerWeek,
      maxGamesPerWeek: config.maxGamesPerWeek,
      gameDurationHours: config.gameDurationHours,
      gameArriveBeforeHours: config.gameArriveBeforeHours,
      gameDayPreferences: config.gameDayPreferences,
      cageSessionsPerWeek: config.cageSessionsPerWeek,
      cageSessionDurationHours: config.cageSessionDurationHours,
      fieldPreferences: config.fieldPreferences,
      maxGamesPerSeason: config.maxGamesPerSeason,
      sundayPairedPracticeEnabled: config.sundayPairedPracticeEnabled,
      sundayPairedPracticeDurationHours: config.sundayPairedPracticeDurationHours,
      sundayPairedPracticeFieldId: config.sundayPairedPracticeFieldId,
      sundayPairedPracticeCageId: config.sundayPairedPracticeCageId,
      gameSpacingEnabled: config.gameSpacingEnabled,
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
        practiceArriveBeforeMinutes: configFormData.practiceArriveBeforeMinutes,
        gamesPerWeek: configFormData.gamesPerWeek,
        maxGamesPerWeek: configFormData.maxGamesPerWeek,
        gameDurationHours: configFormData.gameDurationHours,
        gameArriveBeforeHours: configFormData.gameArriveBeforeHours,
        gameDayPreferences: configFormData.gameDayPreferences,
        cageSessionsPerWeek: configFormData.cageSessionsPerWeek,
        cageSessionDurationHours: configFormData.cageSessionDurationHours,
        fieldPreferences: configFormData.fieldPreferences,
        maxGamesPerSeason: configFormData.maxGamesPerSeason,
        sundayPairedPracticeEnabled: configFormData.sundayPairedPracticeEnabled,
        sundayPairedPracticeDurationHours: configFormData.sundayPairedPracticeDurationHours,
        sundayPairedPracticeFieldId: configFormData.sundayPairedPracticeFieldId,
        sundayPairedPracticeCageId: configFormData.sundayPairedPracticeCageId,
        gameSpacingEnabled: configFormData.gameSpacingEnabled,
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

  // Game week override handlers
  const handleAddGameWeekOverride = async (seasonId: string, config: DivisionConfig) => {
    const existingOverrides = config.gameWeekOverrides || [];

    // Check if this week already has an override
    if (existingOverrides.some(o => o.weekNumber === newOverrideWeek)) {
      alert('This week already has an override');
      return;
    }

    const updatedOverrides: GameWeekOverride[] = [
      ...existingOverrides,
      { weekNumber: newOverrideWeek, gamesPerWeek: newOverrideGames },
    ].sort((a, b) => a.weekNumber - b.weekNumber);

    try {
      await updateDivisionConfig(config.id, { gameWeekOverrides: updatedOverrides });
      await loadDivisionConfigsForSeason(seasonId);
      setAddingOverrideForConfigId(null);
      setNewOverrideWeek(1);
      setNewOverrideGames(0);
    } catch (error) {
      console.error('Failed to add game week override:', error);
      alert('Failed to add game week override');
    }
  };

  const handleRemoveGameWeekOverride = async (seasonId: string, config: DivisionConfig, weekNumber: number) => {
    const existingOverrides = config.gameWeekOverrides || [];
    const updatedOverrides = existingOverrides.filter(o => o.weekNumber !== weekNumber);

    try {
      await updateDivisionConfig(config.id, {
        gameWeekOverrides: updatedOverrides.length > 0 ? updatedOverrides : [],
      });
      await loadDivisionConfigsForSeason(seasonId);
    } catch (error) {
      console.error('Failed to remove game week override:', error);
      alert('Failed to remove game week override');
    }
  };

  // Delete events handlers
  const toggleDeleteEventsSection = async (seasonId: string) => {
    if (deleteEventsExpandedForSeasonId === seasonId) {
      setDeleteEventsExpandedForSeasonId(null);
      setSelectedDivisionIds([]);
      setSelectedTeamIds([]);
      setSelectedEventTypes([]);
      setDeleteEventsStatus(null);
      setConfirmingDelete(false);
    } else {
      setDeleteEventsExpandedForSeasonId(seasonId);
      setSelectedDivisionIds([]);
      setSelectedTeamIds([]);
      setSelectedEventTypes([]);
      setDeleteEventsStatus(null);
      setConfirmingDelete(false);
      // Load teams for this season if not already loaded
      if (!seasonTeams[seasonId]) {
        try {
          const teams = await fetchTeams(seasonId);
          setSeasonTeams((prev) => ({ ...prev, [seasonId]: teams }));
        } catch (error) {
          console.error('Failed to load teams:', error);
        }
      }
    }
  };

  const handleDeleteEvents = async (seasonId: string) => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setDeleteEventsStatus(null);
      return;
    }

    setIsDeletingEvents(true);
    setDeleteEventsStatus(null);
    try {
      const result = await deleteScheduledEventsBulk({
        seasonId,
        divisionIds: selectedDivisionIds.length > 0 ? selectedDivisionIds : undefined,
        teamIds: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
        eventTypes: selectedEventTypes.length > 0 ? selectedEventTypes : undefined,
      });
      setDeleteEventsStatus({
        type: 'success',
        message: `Successfully deleted ${result.deletedCount} event${result.deletedCount !== 1 ? 's' : ''}.`,
      });
      setSelectedDivisionIds([]);
      setSelectedTeamIds([]);
      setSelectedEventTypes([]);
      setConfirmingDelete(false);
    } catch (error) {
      console.error('Failed to delete events:', error);
      setDeleteEventsStatus({ type: 'error', message: 'Failed to delete events' });
      setConfirmingDelete(false);
    } finally {
      setIsDeletingEvents(false);
    }
  };

  // Saved config modal handlers
  const handleConfigSaved = () => {
    setShowSaveConfigForSeasonId(null);
    alert('Configuration saved successfully!');
  };

  const handleConfigRestored = async (result: RestoreConfigResult) => {
    const seasonId = showManageConfigsForSeasonId;
    setShowManageConfigsForSeasonId(null);
    // Reload division configs for this season
    if (seasonId) {
      await loadDivisionConfigsForSeason(seasonId);
    }
    // Refresh seasons to get updated blackout dates
    await refreshSeasons();
    alert(
      `Configuration restored! Division configs: ${result.divisionConfigsRestored}, ` +
      `Field availabilities: ${result.fieldAvailabilitiesRestored}, ` +
      `Cage availabilities: ${result.cageAvailabilitiesRestored}`
    );
  };

  // Blackout dialog helpers
  const startAddingBlackout = (season: Season) => {
    setEditingBlackout({
      seasonId: season.id,
      index: null,
      data: { date: season.startDate },
    });
  };

  const startEditingBlackoutItem = (seasonId: string, index: number, blackout: SeasonBlackout) => {
    setEditingBlackout({
      seasonId,
      index,
      data: { ...blackout },
    });
  };

  const cancelEditingBlackout = () => {
    setEditingBlackout(null);
  };

  const saveEditingBlackout = async () => {
    if (!editingBlackout) return;
    const season = seasons.find((s) => s.id === editingBlackout.seasonId);
    if (!season) return;

    const blackouts = season.blackoutDates || [];
    let updated: SeasonBlackout[];

    if (editingBlackout.index === null) {
      // Adding new
      updated = [...blackouts, editingBlackout.data].sort((a, b) => a.date.localeCompare(b.date));
    } else {
      // Editing existing
      updated = blackouts.map((b, i) =>
        i === editingBlackout.index ? editingBlackout.data : b
      ).sort((a, b) => a.date.localeCompare(b.date));
    }

    await handleUpdate(season, { blackoutDates: updated });
    setEditingBlackout(null);
  };

  const deleteBlackoutItem = async (season: Season, index: number) => {
    const updated = (season.blackoutDates || []).filter((_, i) => i !== index);
    await handleUpdate(season, { blackoutDates: updated });
  };

  const updateEditingBlackoutData = (updates: Partial<SeasonBlackout>) => {
    if (!editingBlackout) return;
    setEditingBlackout({
      ...editingBlackout,
      data: { ...editingBlackout.data, ...updates },
    });
  };

  const toggleEditingBlackoutEventType = (eventType: EventType) => {
    if (!editingBlackout) return;
    const currentTypes = editingBlackout.data.blockedEventTypes;
    if (currentTypes === undefined) {
      // Currently "all types" - switching to specific, start with all three then remove the clicked one
      const allTypes: EventType[] = ['game', 'practice', 'cage'];
      updateEditingBlackoutData({ blockedEventTypes: allTypes.filter((t) => t !== eventType) });
    } else {
      const newTypes = currentTypes.includes(eventType)
        ? currentTypes.filter((t) => t !== eventType)
        : [...currentTypes, eventType];
      updateEditingBlackoutData({ blockedEventTypes: newTypes.length > 0 ? newTypes : undefined });
    }
  };

  const toggleEditingBlackoutDivision = (divisionId: string) => {
    if (!editingBlackout) return;
    const currentIds = editingBlackout.data.divisionIds || [];
    const newIds = currentIds.includes(divisionId)
      ? currentIds.filter((id) => id !== divisionId)
      : [...currentIds, divisionId];
    updateEditingBlackoutData({ divisionIds: newIds.length > 0 ? newIds : undefined });
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
                <button
                  type="button"
                  onClick={() => setShowSaveConfigForSeasonId(season.id)}
                  className={styles.saveConfigBtn}
                >
                  Save Config
                </button>
                <button
                  type="button"
                  onClick={() => setShowManageConfigsForSeasonId(season.id)}
                  className={styles.manageConfigsBtn}
                >
                  Manage Saved
                </button>
                <button onClick={() => handleDelete(season.id)} disabled={isSubmitting}>
                  {isSubmitting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
            <div className={styles.seasonDetails}>
              <p>
                <strong>Start Date:</strong>{' '}
                <input
                  type="date"
                  value={season.startDate}
                  onChange={(e) => handleUpdate(season, { startDate: e.target.value })}
                  className={styles.inlineInput}
                  max={season.endDate}
                />
              </p>
              <p>
                <strong>End Date:</strong>{' '}
                <input
                  type="date"
                  value={season.endDate}
                  onChange={(e) => handleUpdate(season, { endDate: e.target.value })}
                  className={styles.inlineInput}
                  min={season.startDate}
                />
              </p>
              <p>
                <strong>Games Start:</strong>{' '}
                <input
                  type="date"
                  value={season.gamesStartDate || season.startDate}
                  onChange={(e) => handleUpdate(season, { gamesStartDate: e.target.value })}
                  className={styles.inlineInput}
                  min={season.startDate}
                  max={season.endDate}
                />
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
              <div className={styles.blackoutDatesSection}>
                <div className={styles.blackoutDatesHeader}>
                  <strong>Blackout Dates:</strong>
                  <button
                    type="button"
                    onClick={() => setEditingBlackoutsForSeasonId(
                      editingBlackoutsForSeasonId === season.id ? null : season.id
                    )}
                    className={styles.editBlackoutsBtn}
                  >
                    {editingBlackoutsForSeasonId === season.id ? 'Done' : 'Edit'}
                  </button>
                </div>
                {editingBlackoutsForSeasonId === season.id ? (
                  <>
                    {/* List of existing blackouts with Edit/Delete buttons */}
                    <div className={styles.blackoutDatesEditList}>
                      {(season.blackoutDates || []).length === 0 ? (
                        <span className={styles.noBlackouts}>None configured</span>
                      ) : (
                        (season.blackoutDates || [])
                          .sort((a, b) => a.date.localeCompare(b.date))
                          .map((blackout, index) => {
                            const startDate = new Date(blackout.date + 'T00:00:00');
                            const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            let dateStr = startStr;
                            if (blackout.endDate) {
                              const endDate = new Date(blackout.endDate + 'T00:00:00');
                              const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                              dateStr = `${startStr} - ${endStr}`;
                            }
                            const eventTypes = !blackout.blockedEventTypes || blackout.blockedEventTypes.length === 0 || blackout.blockedEventTypes.length === 3
                              ? 'All'
                              : blackout.blockedEventTypes.map(t => t.charAt(0).toUpperCase()).join('');
                            const divisionInfo = blackout.divisionIds
                              ? blackout.divisionIds.map(id => divisions.find(d => d.id === id)?.name).filter(Boolean).join(', ')
                              : 'All divisions';
                            const isCurrentlyEditing = editingBlackout?.seasonId === season.id && editingBlackout?.index === index;
                            return (
                              <div key={`${blackout.date}-${index}`} className={`${styles.blackoutEditListItem} ${isCurrentlyEditing ? styles.blackoutEditListItemActive : ''}`}>
                                <div className={styles.blackoutEditListInfo}>
                                  <span className={styles.blackoutReadOnlyDate}>{dateStr}</span>
                                  {blackout.reason && <span className={styles.blackoutReadOnlyReason}>{blackout.reason}</span>}
                                  <span className={styles.blackoutReadOnlyMeta}>({eventTypes}) {divisionInfo}</span>
                                </div>
                                <div className={styles.blackoutEditListActions}>
                                  <button
                                    type="button"
                                    onClick={() => startEditingBlackoutItem(season.id, index, blackout)}
                                    className={styles.blackoutEditBtn}
                                    disabled={editingBlackout !== null}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteBlackoutItem(season, index)}
                                    className={styles.blackoutDeleteBtn}
                                    disabled={editingBlackout !== null}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>

                    {/* Add button (when not currently editing) */}
                    {editingBlackout === null && (
                      <div className={styles.addBlackoutDate}>
                        <button
                          type="button"
                          onClick={() => startAddingBlackout(season)}
                          className={styles.addBlackoutBtn}
                        >
                          + Add Blackout Date
                        </button>
                      </div>
                    )}

                    {/* Edit/Add form at the bottom */}
                    {editingBlackout?.seasonId === season.id && (
                      <div className={styles.blackoutEditForm}>
                        <h4>{editingBlackout.index === null ? 'Add Blackout Date' : 'Edit Blackout Date'}</h4>
                        <div className={styles.blackoutEditFormRow}>
                          <label>Date:</label>
                          <input
                            type="date"
                            value={editingBlackout.data.date}
                            min={season.startDate}
                            max={editingBlackout.data.endDate || season.endDate}
                            onChange={(e) => updateEditingBlackoutData({ date: e.target.value })}
                            className={styles.blackoutDateInput}
                          />
                          {editingBlackout.data.endDate ? (
                            <>
                              <span className={styles.blackoutDateSeparator}>to</span>
                              <input
                                type="date"
                                value={editingBlackout.data.endDate}
                                min={editingBlackout.data.date}
                                max={season.endDate}
                                onChange={(e) => updateEditingBlackoutData({ endDate: e.target.value || undefined })}
                                className={styles.blackoutDateInput}
                              />
                              <button
                                type="button"
                                onClick={() => updateEditingBlackoutData({ endDate: undefined })}
                                className={styles.clearEndDateBtn}
                                title="Remove end date"
                              >
                                ×
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => updateEditingBlackoutData({ endDate: editingBlackout.data.date })}
                              className={styles.addEndDateBtn}
                            >
                              + Range
                            </button>
                          )}
                        </div>
                        <div className={styles.blackoutEditFormRow}>
                          <label>Event Types:</label>
                          <div className={styles.seasonBlackoutTypes}>
                            <label className={styles.seasonBlackoutTypeLabel}>
                              <input
                                type="checkbox"
                                checked={editingBlackout.data.blockedEventTypes === undefined}
                                onChange={(e) => {
                                  const allEventTypes: EventType[] = ['game', 'practice', 'cage'];
                                  updateEditingBlackoutData({ blockedEventTypes: e.target.checked ? undefined : allEventTypes });
                                }}
                              />
                              All event types
                            </label>
                            {editingBlackout.data.blockedEventTypes !== undefined && (
                              <>
                                <span className={styles.divisionSeparator}>|</span>
                                <label className={styles.seasonBlackoutTypeLabel}>
                                  <input
                                    type="checkbox"
                                    checked={editingBlackout.data.blockedEventTypes.includes('game')}
                                    onChange={() => toggleEditingBlackoutEventType('game')}
                                  />
                                  Game
                                </label>
                                <label className={styles.seasonBlackoutTypeLabel}>
                                  <input
                                    type="checkbox"
                                    checked={editingBlackout.data.blockedEventTypes.includes('practice')}
                                    onChange={() => toggleEditingBlackoutEventType('practice')}
                                  />
                                  Practice
                                </label>
                                <label className={styles.seasonBlackoutTypeLabel}>
                                  <input
                                    type="checkbox"
                                    checked={editingBlackout.data.blockedEventTypes.includes('cage')}
                                    onChange={() => toggleEditingBlackoutEventType('cage')}
                                  />
                                  Cage
                                </label>
                              </>
                            )}
                          </div>
                        </div>
                        <div className={styles.blackoutEditFormRow}>
                          <label>Divisions:</label>
                          <div className={styles.seasonBlackoutDivisions}>
                            <label className={styles.seasonBlackoutDivisionLabel}>
                              <input
                                type="checkbox"
                                checked={editingBlackout.data.divisionIds === undefined}
                                onChange={(e) => updateEditingBlackoutData({ divisionIds: e.target.checked ? undefined : [] })}
                              />
                              All Divisions
                            </label>
                            {editingBlackout.data.divisionIds !== undefined && (
                              <>
                                <span className={styles.divisionSeparator}>|</span>
                                {divisions.map((division) => (
                                  <label key={division.id} className={styles.seasonBlackoutDivisionLabel}>
                                    <input
                                      type="checkbox"
                                      checked={editingBlackout.data.divisionIds?.includes(division.id) || false}
                                      onChange={() => toggleEditingBlackoutDivision(division.id)}
                                    />
                                    {division.name}
                                  </label>
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                        <div className={styles.blackoutEditFormRow}>
                          <label>Reason:</label>
                          <input
                            type="text"
                            placeholder="Optional description"
                            value={editingBlackout.data.reason || ''}
                            onChange={(e) => updateEditingBlackoutData({ reason: e.target.value || undefined })}
                            className={styles.blackoutReasonInput}
                          />
                        </div>
                        <div className={styles.blackoutEditFormActions}>
                          <button type="button" onClick={saveEditingBlackout} className={styles.blackoutSaveBtn}>
                            {editingBlackout.index === null ? 'Add' : 'Save'}
                          </button>
                          <button type="button" onClick={cancelEditingBlackout} className={styles.blackoutCancelBtn}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.blackoutDatesReadOnly}>
                    {(season.blackoutDates || []).length === 0 ? (
                      <span className={styles.noBlackouts}>None configured</span>
                    ) : (
                      (season.blackoutDates || [])
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map((blackout, index) => {
                          const startDate = new Date(blackout.date + 'T00:00:00');
                          const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          let dateStr = startStr;
                          if (blackout.endDate) {
                            const endDate = new Date(blackout.endDate + 'T00:00:00');
                            const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            dateStr = `${startStr} - ${endStr}`;
                          }
                          const eventTypes = !blackout.blockedEventTypes || blackout.blockedEventTypes.length === 0 || blackout.blockedEventTypes.length === 3
                            ? 'All'
                            : blackout.blockedEventTypes.map(t => t.charAt(0).toUpperCase()).join('');
                          const divisionInfo = blackout.divisionIds
                            ? blackout.divisionIds.map(id => divisions.find(d => d.id === id)?.name).filter(Boolean).join(', ')
                            : 'All divisions';
                          return (
                            <div key={`${blackout.date}-${index}`} className={styles.blackoutReadOnlyItem}>
                              <span className={styles.blackoutReadOnlyDate}>{dateStr}</span>
                              {blackout.reason && <span className={styles.blackoutReadOnlyReason}>{blackout.reason}</span>}
                              <span className={styles.blackoutReadOnlyMeta}>({eventTypes}) {divisionInfo}</span>
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </div>

              {/* Delete Events Section */}
              <div className={styles.deleteEventsSection}>
                <button
                  onClick={() => toggleDeleteEventsSection(season.id)}
                  className={styles.deleteEventsToggle}
                  disabled={isDeletingEvents}
                >
                  {deleteEventsExpandedForSeasonId === season.id ? 'Cancel' : 'Delete Events...'}
                </button>

                {deleteEventsExpandedForSeasonId === season.id && (
                  <div className={styles.deleteEventsPanel}>
                    <p className={styles.deleteEventsDescription}>
                      Select filters to delete specific events, or leave all unchecked to delete all events for this season.
                    </p>

                    {/* Division filter */}
                    <div className={styles.filterGroup}>
                      <div className={styles.filterHeader}>
                        <label className={styles.filterLabel}>Divisions:</label>
                        <div className={styles.selectAllButtons}>
                          <button
                            type="button"
                            onClick={() => setSelectedDivisionIds(divisions.map((d) => d.id))}
                            className={styles.selectAllBtn}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDivisionIds([]);
                              setSelectedTeamIds([]);
                            }}
                            className={styles.selectAllBtn}
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className={styles.checkboxGrid}>
                        {divisions.map((division) => (
                          <label key={division.id} className={styles.checkboxItem}>
                            <input
                              type="checkbox"
                              checked={selectedDivisionIds.includes(division.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedDivisionIds([...selectedDivisionIds, division.id]);
                                } else {
                                  setSelectedDivisionIds(selectedDivisionIds.filter((id) => id !== division.id));
                                  // Also remove any selected teams from this division
                                  const divisionTeamIds = (seasonTeams[season.id] || [])
                                    .filter((t) => t.divisionId === division.id)
                                    .map((t) => t.id);
                                  setSelectedTeamIds(selectedTeamIds.filter((id) => !divisionTeamIds.includes(id)));
                                }
                              }}
                            />
                            {division.name}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Team filter - grouped by division */}
                    <div className={styles.filterGroup}>
                      <div className={styles.filterHeader}>
                        <label className={styles.filterLabel}>Teams:</label>
                        <div className={styles.selectAllButtons}>
                          <button
                            type="button"
                            onClick={() => {
                              const visibleTeams = (seasonTeams[season.id] || []).filter(
                                (t) => selectedDivisionIds.length === 0 || selectedDivisionIds.includes(t.divisionId)
                              );
                              setSelectedTeamIds(visibleTeams.map((t) => t.id));
                            }}
                            className={styles.selectAllBtn}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedTeamIds([])}
                            className={styles.selectAllBtn}
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className={styles.teamsByDivision}>
                        {divisions
                          .filter((division) =>
                            selectedDivisionIds.length === 0 || selectedDivisionIds.includes(division.id)
                          )
                          .map((division) => {
                            const divisionTeams = (seasonTeams[season.id] || []).filter(
                              (t) => t.divisionId === division.id
                            );
                            if (divisionTeams.length === 0) return null;
                            return (
                              <div key={division.id} className={styles.divisionTeamsGroup}>
                                <div className={styles.divisionTeamsHeader}>
                                  <span className={styles.divisionTeamsLabel}>{division.name}</span>
                                  <div className={styles.selectAllButtons}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const teamIds = divisionTeams.map((t) => t.id);
                                        setSelectedTeamIds([...new Set([...selectedTeamIds, ...teamIds])]);
                                      }}
                                      className={styles.selectAllBtnSmall}
                                    >
                                      All
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const teamIds = divisionTeams.map((t) => t.id);
                                        setSelectedTeamIds(selectedTeamIds.filter((id) => !teamIds.includes(id)));
                                      }}
                                      className={styles.selectAllBtnSmall}
                                    >
                                      None
                                    </button>
                                  </div>
                                </div>
                                <div className={styles.checkboxGrid}>
                                  {divisionTeams.map((team) => (
                                    <label key={team.id} className={styles.checkboxItem}>
                                      <input
                                        type="checkbox"
                                        checked={selectedTeamIds.includes(team.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedTeamIds([...selectedTeamIds, team.id]);
                                          } else {
                                            setSelectedTeamIds(selectedTeamIds.filter((id) => id !== team.id));
                                          }
                                        }}
                                      />
                                      {team.name}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        {(seasonTeams[season.id] || []).length === 0 && (
                          <span className={styles.noTeamsHint}>No teams in this season</span>
                        )}
                      </div>
                    </div>

                    {/* Event type filter */}
                    <div className={styles.filterGroup}>
                      <div className={styles.filterHeader}>
                        <label className={styles.filterLabel}>Event Types:</label>
                        <div className={styles.selectAllButtons}>
                          <button
                            type="button"
                            onClick={() => setSelectedEventTypes(['game', 'practice', 'cage'])}
                            className={styles.selectAllBtn}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedEventTypes([])}
                            className={styles.selectAllBtn}
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className={styles.checkboxGrid}>
                        {(['game', 'practice', 'cage'] as EventType[]).map((eventType) => (
                          <label key={eventType} className={styles.checkboxItem}>
                            <input
                              type="checkbox"
                              checked={selectedEventTypes.includes(eventType)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedEventTypes([...selectedEventTypes, eventType]);
                                } else {
                                  setSelectedEventTypes(selectedEventTypes.filter((t) => t !== eventType));
                                }
                              }}
                            />
                            {eventType.charAt(0).toUpperCase() + eventType.slice(1)}
                          </label>
                        ))}
                      </div>
                    </div>

                    {deleteEventsStatus && (
                      <div
                        className={
                          deleteEventsStatus.type === 'success'
                            ? styles.deleteEventsSuccess
                            : styles.deleteEventsError
                        }
                      >
                        {deleteEventsStatus.message}
                      </div>
                    )}

                    <div className={styles.deleteEventsActions}>
                      {confirmingDelete ? (
                        <>
                          <span className={styles.confirmWarning}>Are you sure? This cannot be undone.</span>
                          <button
                            onClick={() => handleDeleteEvents(season.id)}
                            className={styles.deleteEventsButton}
                            disabled={isDeletingEvents}
                          >
                            {isDeletingEvents ? 'Deleting...' : 'Yes, Delete'}
                          </button>
                          <button
                            onClick={() => setConfirmingDelete(false)}
                            className={styles.cancelConfirmButton}
                            disabled={isDeletingEvents}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleDeleteEvents(season.id)}
                          className={styles.deleteEventsButton}
                          disabled={isDeletingEvents}
                        >
                          Delete Events
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
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
                                  <div className={styles.formGroup}>
                                    <label>Arrive Before (minutes)</label>
                                    <select
                                      value={configFormData.practiceArriveBeforeMinutes ?? 10}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          practiceArriveBeforeMinutes: parseInt(e.target.value),
                                        })
                                      }
                                    >
                                      {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                                        <option key={m} value={m}>{m} min</option>
                                      ))}
                                    </select>
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
                                    <label>Max Games/Week (optional)</label>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      placeholder="No limit"
                                      value={configFormData.maxGamesPerWeek || ''}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          maxGamesPerWeek: e.target.value ? parseInt(e.target.value) : undefined,
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup}>
                                    <label>Max Games/Season (optional)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      placeholder="No limit"
                                      value={configFormData.maxGamesPerSeason || ''}
                                      onChange={(e) =>
                                        setConfigFormData({
                                          ...configFormData,
                                          maxGamesPerSeason: e.target.value ? parseInt(e.target.value) : null,
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup}>
                                    <label>Game Duration</label>
                                    <div className={styles.timeInputRow}>
                                      <select
                                        value={Math.floor(configFormData.gameDurationHours || 0)}
                                        onChange={(e) => {
                                          const hours = parseInt(e.target.value);
                                          const currentMinutes = Math.round(((configFormData.gameDurationHours || 0) % 1) * 60);
                                          setConfigFormData({
                                            ...configFormData,
                                            gameDurationHours: hours + currentMinutes / 60,
                                          });
                                        }}
                                        required
                                      >
                                        {[0, 1, 2, 3, 4, 5].map((h) => (
                                          <option key={h} value={h}>{h}h</option>
                                        ))}
                                      </select>
                                      <select
                                        value={Math.round(((configFormData.gameDurationHours || 0) % 1) * 60)}
                                        onChange={(e) => {
                                          const minutes = parseInt(e.target.value);
                                          const currentHours = Math.floor(configFormData.gameDurationHours || 0);
                                          setConfigFormData({
                                            ...configFormData,
                                            gameDurationHours: currentHours + minutes / 60,
                                          });
                                        }}
                                      >
                                        {[0, 15, 30, 45].map((m) => (
                                          <option key={m} value={m}>{m}m</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div className={styles.formGroup}>
                                    <label>Arrive Before</label>
                                    <div className={styles.timeInputRow}>
                                      <select
                                        value={Math.floor(configFormData.gameArriveBeforeHours || 0)}
                                        onChange={(e) => {
                                          const hours = parseInt(e.target.value);
                                          const currentMinutes = Math.round(((configFormData.gameArriveBeforeHours || 0) % 1) * 60);
                                          setConfigFormData({
                                            ...configFormData,
                                            gameArriveBeforeHours: hours + currentMinutes / 60,
                                          });
                                        }}
                                      >
                                        {[0, 1, 2].map((h) => (
                                          <option key={h} value={h}>{h}h</option>
                                        ))}
                                      </select>
                                      <select
                                        value={Math.round(((configFormData.gameArriveBeforeHours || 0) % 1) * 60)}
                                        onChange={(e) => {
                                          const minutes = parseInt(e.target.value);
                                          const currentHours = Math.floor(configFormData.gameArriveBeforeHours || 0);
                                          setConfigFormData({
                                            ...configFormData,
                                            gameArriveBeforeHours: currentHours + minutes / 60,
                                          });
                                        }}
                                      >
                                        {[0, 15, 30, 45].map((m) => (
                                          <option key={m} value={m}>{m}m</option>
                                        ))}
                                      </select>
                                    </div>
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
                                {/* Sunday Paired Practice */}
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={configFormData.sundayPairedPracticeEnabled || false}
                                        onChange={(e) =>
                                          setConfigFormData({
                                            ...configFormData,
                                            sundayPairedPracticeEnabled: e.target.checked,
                                          })
                                        }
                                      />
                                      {' '}Enable Sunday Paired Practices
                                    </label>
                                    <p className={styles.helperText}>
                                      Teams are paired on Sundays - first half on field + cage, then swap. Counts as 1 practice + 1 cage session.
                                    </p>
                                  </div>
                                </div>
                                {configFormData.sundayPairedPracticeEnabled && (
                                  <div className={styles.formRow}>
                                    <div className={styles.formGroup}>
                                      <label>Total Duration</label>
                                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <select
                                          value={Math.floor(configFormData.sundayPairedPracticeDurationHours || 0)}
                                          onChange={(e) => {
                                            const hours = parseInt(e.target.value);
                                            const currentMinutes = Math.round(((configFormData.sundayPairedPracticeDurationHours || 0) % 1) * 60);
                                            setConfigFormData({
                                              ...configFormData,
                                              sundayPairedPracticeDurationHours: hours + currentMinutes / 60,
                                            });
                                          }}
                                          style={{ width: '70px' }}
                                        >
                                          {[0, 1, 2, 3, 4, 5].map((h) => (
                                            <option key={h} value={h}>{h}</option>
                                          ))}
                                        </select>
                                        <span>hr</span>
                                        <select
                                          value={Math.round(((configFormData.sundayPairedPracticeDurationHours || 0) % 1) * 60)}
                                          onChange={(e) => {
                                            const minutes = parseInt(e.target.value);
                                            const currentHours = Math.floor(configFormData.sundayPairedPracticeDurationHours || 0);
                                            setConfigFormData({
                                              ...configFormData,
                                              sundayPairedPracticeDurationHours: currentHours + minutes / 60,
                                            });
                                          }}
                                          style={{ width: '70px' }}
                                        >
                                          {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                          ))}
                                        </select>
                                        <span>min</span>
                                      </div>
                                    </div>
                                    <div className={styles.formGroup}>
                                      <label>Field</label>
                                      <select
                                        value={configFormData.sundayPairedPracticeFieldId || ''}
                                        onChange={(e) =>
                                          setConfigFormData({
                                            ...configFormData,
                                            sundayPairedPracticeFieldId: e.target.value || undefined,
                                          })
                                        }
                                      >
                                        <option value="">Select field...</option>
                                        {(seasonFields[season.id] || []).map((f) => (
                                          <option key={f.fieldId} value={f.fieldId}>
                                            {f.field?.name || f.fieldId}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className={styles.formGroup}>
                                      <label>Cage</label>
                                      <select
                                        value={configFormData.sundayPairedPracticeCageId || ''}
                                        onChange={(e) =>
                                          setConfigFormData({
                                            ...configFormData,
                                            sundayPairedPracticeCageId: e.target.value || undefined,
                                          })
                                        }
                                      >
                                        <option value="">Select cage...</option>
                                        {(seasonCages[season.id] || []).map((c) => (
                                          <option key={c.cageId} value={c.cageId}>
                                            {c.cage?.name || c.cageId}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                )}
                                {/* Game Spacing */}
                                <div className={styles.formRow}>
                                  <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={configFormData.gameSpacingEnabled || false}
                                        onChange={(e) =>
                                          setConfigFormData({
                                            ...configFormData,
                                            gameSpacingEnabled: e.target.checked,
                                          })
                                        }
                                      />
                                      {' '}Enable Game Spacing
                                    </label>
                                    <p className={styles.helperText}>
                                      When enabled, the scheduler will try to maintain minimum days between games for each team.
                                    </p>
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
                                  {existingConfig.practiceArriveBeforeMinutes != null && existingConfig.practiceArriveBeforeMinutes > 0 && (
                                    <span>Arrive: {existingConfig.practiceArriveBeforeMinutes}m before</span>
                                  )}
                                </div>
                                <div className={styles.configDetailRow}>
                                  <span>Games: {existingConfig.gamesPerWeek}/week</span>
                                  <span>Duration: {Math.floor(existingConfig.gameDurationHours)}h {Math.round((existingConfig.gameDurationHours % 1) * 60)}m</span>
                                  {existingConfig.gameArriveBeforeHours ? (
                                    <span>Arrive: {Math.floor(existingConfig.gameArriveBeforeHours)}h {Math.round((existingConfig.gameArriveBeforeHours % 1) * 60)}m before</span>
                                  ) : null}
                                  {existingConfig.maxGamesPerSeason && (
                                    <span>Max/season: {existingConfig.maxGamesPerSeason}</span>
                                  )}
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
                                {existingConfig.sundayPairedPracticeEnabled && (
                                  <div className={styles.configDetailRow}>
                                    <span>Sunday paired practice: {(() => {
                                      const hours = Math.floor(existingConfig.sundayPairedPracticeDurationHours || 0);
                                      const minutes = Math.round(((existingConfig.sundayPairedPracticeDurationHours || 0) % 1) * 60);
                                      if (minutes === 0) return `${hours}h`;
                                      if (hours === 0) return `${minutes}min`;
                                      return `${hours}h ${minutes}min`;
                                    })()}</span>
                                    {existingConfig.sundayPairedPracticeFieldId && (
                                      <span>
                                        Field: {(seasonFields[season.id] || []).find(f => f.fieldId === existingConfig.sundayPairedPracticeFieldId)?.field?.name || existingConfig.sundayPairedPracticeFieldId}
                                      </span>
                                    )}
                                    {existingConfig.sundayPairedPracticeCageId && (
                                      <span>
                                        Cage: {(seasonCages[season.id] || []).find(c => c.cageId === existingConfig.sundayPairedPracticeCageId)?.cage?.name || existingConfig.sundayPairedPracticeCageId}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {existingConfig.gameSpacingEnabled && (
                                  <div className={styles.configDetailRow}>
                                    <span>Game spacing: enabled</span>
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
                                {/* Game Week Overrides Section */}
                                {existingConfig.gamesPerWeek > 0 && (
                                  <div className={styles.gameWeekOverrides}>
                                    <div className={styles.overridesHeader}>
                                      <span className={styles.overridesLabel}>Game week overrides:</span>
                                      {addingOverrideForConfigId !== existingConfig.id && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setAddingOverrideForConfigId(existingConfig.id);
                                            setNewOverrideWeek(1);
                                            setNewOverrideGames(existingConfig.gamesPerWeek);
                                          }}
                                          className={styles.addOverrideBtn}
                                        >
                                          + Add Override
                                        </button>
                                      )}
                                    </div>

                                    {existingConfig.gameWeekOverrides && existingConfig.gameWeekOverrides.length > 0 ? (
                                      <div className={styles.overridesList}>
                                        {existingConfig.gameWeekOverrides.map((override) => {
                                          const gameWeeks = generateGameWeeks(
                                            season.gamesStartDate || season.startDate,
                                            season.endDate
                                          );
                                          const week = gameWeeks.find(w => w.weekNumber === override.weekNumber);
                                          return (
                                            <div key={override.weekNumber} className={styles.overrideItem}>
                                              <span>
                                                Week {override.weekNumber}
                                                {week && ` (${formatWeekDateRange(week.startDate, week.endDate)})`}:
                                                {' '}{override.gamesPerWeek} game{override.gamesPerWeek !== 1 ? 's' : ''}
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => handleRemoveGameWeekOverride(season.id, existingConfig, override.weekNumber)}
                                                className={styles.removeOverrideBtn}
                                              >
                                                Remove
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <span className={styles.noOverrides}>No overrides (default {existingConfig.gamesPerWeek}/week)</span>
                                    )}

                                    {addingOverrideForConfigId === existingConfig.id && (
                                      <div className={styles.addOverrideForm}>
                                        {(() => {
                                          const gameWeeks = generateGameWeeks(
                                            season.gamesStartDate || season.startDate,
                                            season.endDate
                                          );
                                          const existingWeeks = new Set(
                                            (existingConfig.gameWeekOverrides || []).map(o => o.weekNumber)
                                          );
                                          const availableWeeks = gameWeeks.filter(w => !existingWeeks.has(w.weekNumber));

                                          return (
                                            <>
                                              <select
                                                value={newOverrideWeek}
                                                onChange={(e) => setNewOverrideWeek(parseInt(e.target.value))}
                                              >
                                                {availableWeeks.map((week) => (
                                                  <option key={week.weekNumber} value={week.weekNumber}>
                                                    Week {week.weekNumber} ({formatWeekDateRange(week.startDate, week.endDate)})
                                                  </option>
                                                ))}
                                              </select>
                                              <input
                                                type="number"
                                                min="0"
                                                value={newOverrideGames}
                                                onChange={(e) => setNewOverrideGames(parseInt(e.target.value) || 0)}
                                                placeholder="Games"
                                                style={{ width: '60px' }}
                                              />
                                              <span>games</span>
                                              <button
                                                type="button"
                                                onClick={() => handleAddGameWeekOverride(season.id, existingConfig)}
                                              >
                                                Add
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setAddingOverrideForConfigId(null)}
                                              >
                                                Cancel
                                              </button>
                                            </>
                                          );
                                        })()}
                                      </div>
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

      {/* Save Config Modal */}
      {showSaveConfigForSeasonId && (
        <SaveConfigModal
          seasonId={showSaveConfigForSeasonId}
          onClose={() => setShowSaveConfigForSeasonId(null)}
          onSaved={handleConfigSaved}
        />
      )}

      {/* Manage Configs Modal */}
      {showManageConfigsForSeasonId && (
        <ManageConfigsModal
          seasonId={showManageConfigsForSeasonId}
          onClose={() => setShowManageConfigsForSeasonId(null)}
          onRestored={handleConfigRestored}
        />
      )}
    </div>
  );
}
