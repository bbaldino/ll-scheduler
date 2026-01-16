import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSeason } from '../contexts/SeasonContext';
import CalendarView from '../components/CalendarView';
import ScheduleEvaluationReport from '../components/ScheduleEvaluationReport';
import { SaveScheduleModal } from '../components/SaveScheduleModal';
import { RestoreScheduleModal } from '../components/RestoreScheduleModal';
import {
  fetchScheduledEvents,
  createScheduledEvent,
  createScheduledEventsBulk,
  updateScheduledEvent,
  deleteScheduledEvent,
} from '../api/scheduled-events';
import { fetchDivisions } from '../api/divisions';
import { fetchTeams } from '../api/teams';
import { fetchSeasonFields } from '../api/fields';
import { fetchSeasonCages } from '../api/batting-cages';
import { evaluateSchedule } from '../api/schedule-generator';
import type {
  ScheduledEvent,
  CreateScheduledEventInput,
  UpdateScheduledEventInput,
  Division,
  Team,
  SeasonField,
  SeasonCage,
  EventType,
  EventStatus,
  ScheduleEvaluationResult,
} from '@ll-scheduler/shared';
import styles from './ScheduledEventsPage.module.css';

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  game: 'Game',
  practice: 'Practice',
  cage: 'Cage Time',
};

const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
};

export default function ScheduledEventsPage() {
  const { currentSeason } = useSeason();
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasonFields, setSeasonFields] = useState<SeasonField[]>([]);
  const [seasonCages, setSeasonCages] = useState<SeasonCage[]>([]);

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filter state
  const [filterDivision, setFilterDivision] = useState<string>('');
  const [filterType, setFilterType] = useState<EventType | ''>('');
  const [filterTeam, setFilterTeam] = useState<string>('');
  const [filterField, setFilterField] = useState<string>('');
  const [filterCage, setFilterCage] = useState<string>('');

  // View state
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar');

  // Evaluation state
  const [evaluationResult, setEvaluationResult] = useState<ScheduleEvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Save/Restore modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  const [formData, setFormData] = useState<CreateScheduledEventInput>({
    seasonId: '',
    divisionId: '',
    eventType: 'practice',
    date: '',
    startTime: '17:00',
    endTime: '18:00',
    status: 'scheduled',
  });

  // Recurrence state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDays, setRecurringDays] = useState<number[]>([]); // 0=Sun, 1=Mon, ..., 6=Sat
  const [recurringEndType, setRecurringEndType] = useState<'date' | 'count'>('count');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [recurringCount, setRecurringCount] = useState(8);

  const [editFormData, setEditFormData] = useState<UpdateScheduledEventInput>({});

  useEffect(() => {
    if (currentSeason) {
      loadData();
    }
  }, [currentSeason]);

  useEffect(() => {
    if (currentSeason) {
      loadEvents();
    }
  }, [currentSeason, filterDivision, filterType]);

  const loadData = async () => {
    if (!currentSeason) return;
    try {
      const [divisionsData, teamsData, fieldsData, cagesData] = await Promise.all([
        fetchDivisions(),
        fetchTeams(currentSeason.id),
        fetchSeasonFields(currentSeason.id),
        fetchSeasonCages(currentSeason.id),
      ]);
      setDivisions(divisionsData);
      setTeams(teamsData);
      setSeasonFields(fieldsData);
      setSeasonCages(cagesData);
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const loadEvents = async () => {
    if (!currentSeason) return;
    try {
      const data = await fetchScheduledEvents({
        seasonId: currentSeason.id,
        divisionId: filterDivision || undefined,
        eventType: filterType || undefined,
      });
      setEvents(data);
    } catch (error) {
      console.error('Failed to fetch events:', error);
    }
  };

  // Generate dates for recurring events
  const generateRecurringDates = (
    startDate: string,
    daysOfWeek: number[],
    endCondition: { type: 'date'; endDate: string } | { type: 'count'; count: number }
  ): string[] => {
    const dates: string[] = [];
    const start = new Date(startDate + 'T00:00:00');
    const maxDates = 100; // Safety limit

    if (endCondition.type === 'date') {
      const end = new Date(endCondition.endDate + 'T23:59:59');
      const current = new Date(start);

      while (current <= end && dates.length < maxDates) {
        if (daysOfWeek.includes(current.getDay())) {
          dates.push(current.toISOString().split('T')[0]);
        }
        current.setDate(current.getDate() + 1);
      }
    } else {
      const current = new Date(start);
      let count = 0;

      while (count < endCondition.count && dates.length < maxDates) {
        if (daysOfWeek.includes(current.getDay())) {
          dates.push(current.toISOString().split('T')[0]);
          count++;
        }
        current.setDate(current.getDate() + 1);
      }
    }

    return dates;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isRecurring) {
        // Validate recurrence settings
        if (recurringDays.length === 0) {
          alert('Please select at least one day of the week for recurring events.');
          return;
        }
        if (recurringEndType === 'date' && !recurringEndDate) {
          alert('Please select an end date for recurring events.');
          return;
        }
        if (recurringEndType === 'count' && recurringCount < 1) {
          alert('Please enter a valid number of occurrences.');
          return;
        }

        // Generate all dates
        const dates = generateRecurringDates(
          formData.date,
          recurringDays,
          recurringEndType === 'date'
            ? { type: 'date', endDate: recurringEndDate }
            : { type: 'count', count: recurringCount }
        );

        if (dates.length === 0) {
          alert('No dates match the selected pattern. Please check your settings.');
          return;
        }

        // Create events for all dates
        const events = dates.map((date) => ({
          ...formData,
          seasonId: currentSeason!.id,
          date,
        }));

        const result = await createScheduledEventsBulk(events);
        alert(`Created ${result.createdCount} events.`);
      } else {
        await createScheduledEvent({ ...formData, seasonId: currentSeason!.id });
      }
      await loadEvents();
      setIsCreating(false);
      resetForm();
    } catch (error) {
      console.error('Failed to create event:', error);
      alert('Failed to create event. Please check all required fields.');
    }
  };

  const startEditing = (event: ScheduledEvent) => {
    setEditingId(event.id);
    setEditFormData({
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      status: event.status,
      notes: event.notes,
      fieldId: event.fieldId,
      cageId: event.cageId,
      homeTeamId: event.homeTeamId,
      awayTeamId: event.awayTeamId,
      teamId: event.teamId,
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;

    try {
      await updateScheduledEvent(editingId, editFormData);
      await loadEvents();
      setEditingId(null);
      setEditFormData({});
    } catch (error) {
      console.error('Failed to update event:', error);
      alert('Failed to update event');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this event?')) return;
    try {
      await deleteScheduledEvent(id);
      await loadEvents();
    } catch (error) {
      console.error('Failed to delete event:', error);
      alert('Failed to delete event');
    }
  };

  // Wrapper for CalendarView that handles update without confirmation
  const handleCalendarUpdate = async (id: string, input: UpdateScheduledEventInput) => {
    await updateScheduledEvent(id, input);
    await loadEvents();
  };

  // Wrapper for CalendarView delete (confirmation handled in CalendarView)
  const handleCalendarDelete = async (id: string) => {
    await deleteScheduledEvent(id);
    await loadEvents();
  };

  const resetForm = () => {
    setFormData({
      seasonId: currentSeason?.id || '',
      divisionId: '',
      eventType: 'practice',
      date: '',
      startTime: '17:00',
      endTime: '18:00',
      status: 'scheduled',
    });
    setIsRecurring(false);
    setRecurringDays([]);
    setRecurringEndType('count');
    setRecurringEndDate('');
    setRecurringCount(8);
  };

  const handleEvaluate = async () => {
    if (!currentSeason) {
      alert('No season selected');
      return;
    }

    setIsEvaluating(true);
    try {
      const result = await evaluateSchedule(currentSeason.id);
      setEvaluationResult(result);
    } catch (error) {
      console.error('Failed to evaluate schedule:', error);
      alert('Failed to evaluate schedule');
    } finally {
      setIsEvaluating(false);
    }
  };

  const getTeamName = (teamId?: string) => {
    if (!teamId) return 'N/A';
    return teams.find((t) => t.id === teamId)?.name || 'Unknown';
  };

  const getFieldName = (fieldId?: string) => {
    if (!fieldId) return 'Unassigned';
    const sf = seasonFields.find((f) => f.fieldId === fieldId);
    return sf?.fieldName || sf?.field?.name || 'Unknown';
  };

  const getCageName = (cageId?: string) => {
    if (!cageId) return 'Unassigned';
    const sc = seasonCages.find((c) => c.cageId === cageId);
    return sc?.cageName || sc?.cage?.name || 'Unknown';
  };

  const getDivisionName = (divisionId: string) => {
    return divisions.find((d) => d.id === divisionId)?.name || 'Unknown';
  };

  // Filter events by team/field/cage (API already filters by division/type)
  // Must be before early return to maintain hooks order
  const filteredEvents = useMemo(() => {
    let result = events;

    if (filterTeam) {
      result = result.filter(
        (e) =>
          e.teamId === filterTeam ||
          e.homeTeamId === filterTeam ||
          e.awayTeamId === filterTeam
      );
    }

    if (filterField) {
      result = result.filter((e) => e.fieldId === filterField);
    }

    if (filterCage) {
      result = result.filter((e) => e.cageId === filterCage);
    }

    return result;
  }, [events, filterTeam, filterField, filterCage]);

  // Helper to expand a date range into individual dates
  const expandDateRange = (startDate: string, endDate?: string): string[] => {
    if (!endDate) return [startDate];
    const dates: string[] = [];
    const current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  // Combine season blackout dates for calendar display
  const calendarBlackoutDates = useMemo(() => {
    const blackouts: Array<{ date: string; description?: string; divisionName?: string }> = [];

    // Add season-level blackouts (may apply to all divisions or specific ones)
    if (currentSeason?.blackoutDates) {
      for (const blackout of currentSeason.blackoutDates) {
        const dates = expandDateRange(blackout.date, blackout.endDate);
        // Get division names if this blackout is division-specific
        let divisionName: string | undefined;
        if (blackout.divisionIds && blackout.divisionIds.length > 0) {
          const divisionNames = blackout.divisionIds
            .map(id => divisions.find(d => d.id === id)?.name)
            .filter(Boolean);
          divisionName = divisionNames.join(', ');
        }
        for (const date of dates) {
          blackouts.push({
            date,
            description: blackout.reason,
            divisionName,
          });
        }
      }
    }

    return blackouts;
  }, [currentSeason, divisions]);

  // Group events by date
  const eventsByDate = useMemo(() => {
    return filteredEvents.reduce((acc, event) => {
      if (!acc[event.date]) {
        acc[event.date] = [];
      }
      acc[event.date].push(event);
      return acc;
    }, {} as Record<string, ScheduledEvent[]>);
  }, [filteredEvents]);

  const sortedDates = useMemo(() => Object.keys(eventsByDate).sort(), [eventsByDate]);

  if (!currentSeason) {
    return (
      <div className={styles.container}>
        <p>Please select a season to view scheduled events.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Scheduled Events - {currentSeason.name}</h2>
        <div className={styles.headerActions}>
          <div className={styles.viewToggle}>
            <button
              className={viewMode === 'list' ? styles.active : ''}
              onClick={() => setViewMode('list')}
            >
              List View
            </button>
            <button
              className={viewMode === 'calendar' ? styles.active : ''}
              onClick={() => setViewMode('calendar')}
            >
              Calendar View
            </button>
          </div>
          <Link to="/generation-logs" className={styles.linkButton}>
            View Generation Logs
          </Link>
          <button onClick={handleEvaluate} disabled={isEvaluating}>
            {isEvaluating ? 'Evaluating...' : 'Evaluate Schedule'}
          </button>
          <button onClick={() => setShowSaveModal(true)}>Save Schedule</button>
          <button onClick={() => setShowRestoreModal(true)}>Manage Saved</button>
          {viewMode === 'list' && (
            <button onClick={() => setIsCreating(true)}>Create Event</button>
          )}
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label>Division:</label>
          <select value={filterDivision} onChange={(e) => setFilterDivision(e.target.value)}>
            <option value="">All Divisions</option>
            {divisions.map((div) => (
              <option key={div.id} value={div.id}>
                {div.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label>Type:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as EventType | '')}
          >
            <option value="">All Types</option>
            <option value="game">Games</option>
            <option value="practice">Practices</option>
            <option value="cage">Cage Time</option>
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label>Team:</label>
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
          >
            <option value="">All Teams</option>
            {teams
              .filter((t) => !filterDivision || t.divisionId === filterDivision)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label>Field:</label>
          <select
            value={filterField}
            onChange={(e) => setFilterField(e.target.value)}
          >
            <option value="">All Fields</option>
            {seasonFields
              .sort((a, b) => (a.fieldName || '').localeCompare(b.fieldName || ''))
              .map((sf) => (
                <option key={sf.fieldId} value={sf.fieldId}>
                  {sf.fieldName || sf.field?.name}
                </option>
              ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label>Cage:</label>
          <select
            value={filterCage}
            onChange={(e) => setFilterCage(e.target.value)}
          >
            <option value="">All Cages</option>
            {seasonCages
              .sort((a, b) => (a.cageName || '').localeCompare(b.cageName || ''))
              .map((sc) => (
                <option key={sc.cageId} value={sc.cageId}>
                  {sc.cageName || sc.cage?.name}
                </option>
              ))}
          </select>
        </div>
        {(filterTeam || filterField || filterCage) && (
          <button
            className={styles.clearFilterButton}
            onClick={() => {
              setFilterTeam('');
              setFilterField('');
              setFilterCage('');
              setFilterDivision('');
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {isCreating && viewMode === 'list' && (
        <form onSubmit={handleCreate} className={styles.form}>
          <h3>Create New Event</h3>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Event Type *</label>
              <select
                value={formData.eventType}
                onChange={(e) =>
                  setFormData({ ...formData, eventType: e.target.value as EventType })
                }
                required
              >
                <option value="practice">Practice</option>
                <option value="game">Game</option>
                <option value="cage">Cage Time</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Division *</label>
              <select
                value={formData.divisionId}
                onChange={(e) => setFormData({ ...formData, divisionId: e.target.value })}
                required
              >
                <option value="">Select Division</option>
                {divisions.map((div) => (
                  <option key={div.id} value={div.id}>
                    {div.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>{isRecurring ? 'Start Date *' : 'Date *'}</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
            <div className={styles.formGroup}>
              <label>Start Time *</label>
              <input
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                required
              />
            </div>
            <div className={styles.formGroup}>
              <label>End Time *</label>
              <input
                type="time"
                value={formData.endTime}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Recurrence Section */}
          <div className={styles.recurrenceSection}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
              />
              Make recurring
            </label>

            {isRecurring && (
              <div className={styles.recurrenceOptions}>
                <div className={styles.formGroup}>
                  <label>Repeat on days:</label>
                  <div className={styles.dayCheckboxes}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                      <label key={day} className={styles.dayCheckbox}>
                        <input
                          type="checkbox"
                          checked={recurringDays.includes(index)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRecurringDays([...recurringDays, index].sort());
                            } else {
                              setRecurringDays(recurringDays.filter((d) => d !== index));
                            }
                          }}
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>End:</label>
                  <div className={styles.endCondition}>
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        name="recurringEndType"
                        checked={recurringEndType === 'count'}
                        onChange={() => setRecurringEndType('count')}
                      />
                      After
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={recurringCount}
                        onChange={(e) => setRecurringCount(parseInt(e.target.value) || 1)}
                        disabled={recurringEndType !== 'count'}
                        className={styles.countInput}
                      />
                      occurrences
                    </label>
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        name="recurringEndType"
                        checked={recurringEndType === 'date'}
                        onChange={() => setRecurringEndType('date')}
                      />
                      On date
                      <input
                        type="date"
                        value={recurringEndDate}
                        onChange={(e) => setRecurringEndDate(e.target.value)}
                        disabled={recurringEndType !== 'date'}
                        min={formData.date}
                        className={styles.endDateInput}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {formData.eventType === 'game' && (
            <>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Home Team *</label>
                  <select
                    value={formData.homeTeamId || ''}
                    onChange={(e) => setFormData({ ...formData, homeTeamId: e.target.value })}
                    required
                  >
                    <option value="">Select Team</option>
                    {teams
                      .filter((t) => t.divisionId === formData.divisionId)
                      .map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Away Team *</label>
                  <select
                    value={formData.awayTeamId || ''}
                    onChange={(e) => setFormData({ ...formData, awayTeamId: e.target.value })}
                    required
                  >
                    <option value="">Select Team</option>
                    {teams
                      .filter((t) => t.divisionId === formData.divisionId)
                      .map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Field *</label>
                  <select
                    value={formData.fieldId || ''}
                    onChange={(e) => setFormData({ ...formData, fieldId: e.target.value })}
                    required
                  >
                    <option value="">Select Field</option>
                    {seasonFields
                      .filter((sf) => sf.divisionCompatibility?.includes(formData.divisionId) ?? true)
                      .map((sf) => (
                        <option key={sf.fieldId} value={sf.fieldId}>
                          {sf.fieldName || sf.field?.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {formData.eventType === 'practice' && (
            <>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Team *</label>
                  <select
                    value={formData.teamId || ''}
                    onChange={(e) => setFormData({ ...formData, teamId: e.target.value })}
                    required
                  >
                    <option value="">Select Team</option>
                    {teams
                      .filter((t) => t.divisionId === formData.divisionId)
                      .map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Field *</label>
                  <select
                    value={formData.fieldId || ''}
                    onChange={(e) => setFormData({ ...formData, fieldId: e.target.value })}
                    required
                  >
                    <option value="">Select Field</option>
                    {seasonFields
                      .filter((sf) => sf.divisionCompatibility?.includes(formData.divisionId) ?? true)
                      .map((sf) => (
                        <option key={sf.fieldId} value={sf.fieldId}>
                          {sf.fieldName || sf.field?.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {formData.eventType === 'cage' && (
            <>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Team *</label>
                  <select
                    value={formData.teamId || ''}
                    onChange={(e) => setFormData({ ...formData, teamId: e.target.value })}
                    required
                  >
                    <option value="">Select Team</option>
                    {teams
                      .filter((t) => t.divisionId === formData.divisionId)
                      .map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Cage *</label>
                  <select
                    value={formData.cageId || ''}
                    onChange={(e) => setFormData({ ...formData, cageId: e.target.value })}
                    required
                  >
                    <option value="">Select Cage</option>
                    {seasonCages
                      .filter((sc) => sc.divisionCompatibility?.includes(formData.divisionId) ?? true)
                      .map((sc) => (
                        <option key={sc.cageId} value={sc.cageId}>
                          {sc.cageName || sc.cage?.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </>
          )}

          <div className={styles.formGroup}>
            <label>Notes</label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Optional notes"
              rows={3}
            />
          </div>

          <div className={styles.formActions}>
            <button type="submit">Create</button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                resetForm();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={styles.eventsList}>
        {viewMode === 'calendar' ? (
          <CalendarView
            events={filteredEvents}
            teams={teams}
            seasonFields={seasonFields}
            seasonCages={seasonCages}
            divisions={divisions}
            seasonId={currentSeason?.id}
            initialDate={currentSeason?.startDate}
            seasonMilestones={currentSeason ? {
              startDate: currentSeason.startDate,
              gamesStartDate: currentSeason.gamesStartDate,
              endDate: currentSeason.endDate,
            } : undefined}
            blackoutDates={calendarBlackoutDates}
            onEventCreate={async (input) => {
              await createScheduledEvent(input);
              await loadEvents();
            }}
            onEventCreateBulk={async (inputs) => {
              const result = await createScheduledEventsBulk(inputs);
              await loadEvents();
              return result;
            }}
            onEventUpdate={handleCalendarUpdate}
            onEventDelete={handleCalendarDelete}
          />
        ) : (
          <>
            {sortedDates.length === 0 && !isCreating && (
              <div className={styles.empty}>
                <p>No events scheduled yet. Create one to get started!</p>
              </div>
            )}

            {sortedDates.map((date) => (
          <div key={date} className={styles.dateGroup}>
            <h3 className={styles.dateHeader}>{new Date(date + 'T00:00:00').toLocaleDateString()}</h3>
            <div className={styles.eventsForDate}>
              {eventsByDate[date]
                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                .map((event) => (
                  <div key={event.id} className={styles.eventCard}>
                    {editingId === event.id ? (
                      <form onSubmit={handleUpdate} className={styles.editForm}>
                        <div className={styles.formRow}>
                          <div className={styles.formGroup}>
                            <label>Date</label>
                            <input
                              type="date"
                              value={editFormData.date || event.date}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, date: e.target.value })
                              }
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label>Start Time</label>
                            <input
                              type="time"
                              value={editFormData.startTime || event.startTime}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, startTime: e.target.value })
                              }
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label>End Time</label>
                            <input
                              type="time"
                              value={editFormData.endTime || event.endTime}
                              onChange={(e) =>
                                setEditFormData({ ...editFormData, endTime: e.target.value })
                              }
                            />
                          </div>
                          <div className={styles.formGroup}>
                            <label>Status</label>
                            <select
                              value={editFormData.status || event.status}
                              onChange={(e) =>
                                setEditFormData({
                                  ...editFormData,
                                  status: e.target.value as EventStatus,
                                })
                              }
                            >
                              {Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {/* Field selection for games and practices */}
                        {(event.eventType === 'game' || event.eventType === 'practice') && (
                          <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                              <label>Field</label>
                              <select
                                value={editFormData.fieldId || event.fieldId || ''}
                                onChange={(e) =>
                                  setEditFormData({ ...editFormData, fieldId: e.target.value })
                                }
                              >
                                <option value="">Select Field</option>
                                {seasonFields.map((sf) => (
                                  <option key={sf.id} value={sf.fieldId}>
                                    {sf.field?.name || sf.fieldId}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
                        {/* Cage selection for cage events */}
                        {event.eventType === 'cage' && (
                          <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                              <label>Cage</label>
                              <select
                                value={editFormData.cageId || event.cageId || ''}
                                onChange={(e) =>
                                  setEditFormData({ ...editFormData, cageId: e.target.value })
                                }
                              >
                                <option value="">Select Cage</option>
                                {seasonCages.map((sc) => (
                                  <option key={sc.id} value={sc.cageId}>
                                    {sc.cage?.name || sc.cageId}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
                        {/* Home/Away swap for games */}
                        {event.eventType === 'game' && (
                          <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                              <label>Home Team</label>
                              <span className={styles.teamDisplay}>
                                {getTeamName(editFormData.homeTeamId || event.homeTeamId)}
                              </span>
                            </div>
                            <div className={styles.formGroup}>
                              <label>Away Team</label>
                              <span className={styles.teamDisplay}>
                                {getTeamName(editFormData.awayTeamId || event.awayTeamId)}
                              </span>
                            </div>
                            <div className={styles.formGroup}>
                              <button
                                type="button"
                                className={styles.swapButton}
                                onClick={() => {
                                  const currentHome = editFormData.homeTeamId || event.homeTeamId;
                                  const currentAway = editFormData.awayTeamId || event.awayTeamId;
                                  setEditFormData({
                                    ...editFormData,
                                    homeTeamId: currentAway,
                                    awayTeamId: currentHome,
                                  });
                                }}
                              >
                                ⇄ Swap Home/Away
                              </button>
                            </div>
                          </div>
                        )}
                        <div className={styles.formActions}>
                          <button type="submit">Save</button>
                          <button type="button" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className={styles.eventHeader}>
                          <div className={styles.eventTitle}>
                            <span className={`${styles.eventType} ${styles[event.eventType]}`}>
                              {EVENT_TYPE_LABELS[event.eventType]}
                            </span>
                            <span className={styles.eventTime}>
                              {event.startTime} - {event.endTime}
                            </span>
                            <span className={`${styles.eventStatus} ${styles[event.status]}`}>
                              {EVENT_STATUS_LABELS[event.status]}
                            </span>
                          </div>
                          <div className={styles.eventActions}>
                            <button onClick={() => startEditing(event)}>Edit</button>
                            <button onClick={() => handleDelete(event.id)}>Delete</button>
                          </div>
                        </div>
                        <div className={styles.eventDetails}>
                          <p>
                            <strong>Division:</strong> {getDivisionName(event.divisionId)}
                          </p>
                          {event.eventType === 'game' && (
                            <>
                              <p>
                                <strong>Matchup:</strong> {getTeamName(event.homeTeamId)} vs{' '}
                                {getTeamName(event.awayTeamId)}
                              </p>
                              <p>
                                <strong>Field:</strong> {getFieldName(event.fieldId)}
                              </p>
                            </>
                          )}
                          {event.eventType === 'practice' && (
                            <>
                              <p>
                                <strong>Team:</strong> {getTeamName(event.teamId)}
                              </p>
                              <p>
                                <strong>Field:</strong> {getFieldName(event.fieldId)}
                              </p>
                            </>
                          )}
                          {event.eventType === 'cage' && (
                            <>
                              <p>
                                <strong>Team:</strong> {getTeamName(event.teamId)}
                              </p>
                              <p>
                                <strong>Cage:</strong> {getCageName(event.cageId)}
                              </p>
                            </>
                          )}
                          {event.notes && (
                            <p>
                              <strong>Notes:</strong> {event.notes}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
          </>
        )}
      </div>

      {evaluationResult && (
        <ScheduleEvaluationReport
          result={evaluationResult}
          onClose={() => setEvaluationResult(null)}
        />
      )}

      {showSaveModal && (
        <SaveScheduleModal
          seasonId={currentSeason.id}
          currentEventCount={events.length}
          onClose={() => setShowSaveModal(false)}
          onSaved={() => {
            setShowSaveModal(false);
            alert('Schedule saved successfully!');
          }}
        />
      )}

      {showRestoreModal && (
        <RestoreScheduleModal
          seasonId={currentSeason.id}
          currentEventCount={events.length}
          onClose={() => setShowRestoreModal(false)}
          onRestored={(restoredCount) => {
            setShowRestoreModal(false);
            loadEvents();
            alert(`Restored ${restoredCount} events successfully!`);
          }}
        />
      )}
    </div>
  );
}
