import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSeason } from '../contexts/SeasonContext';
import CalendarView from '../components/CalendarView';
import ScheduleEvaluationReport from '../components/ScheduleEvaluationReport';
import {
  fetchScheduledEvents,
  createScheduledEvent,
  updateScheduledEvent,
  deleteScheduledEvent,
} from '../api/scheduled-events';
import { fetchSeasonPeriods } from '../api/season-periods';
import { fetchDivisions } from '../api/divisions';
import { fetchTeams } from '../api/teams';
import { fetchSeasonFields } from '../api/fields';
import { fetchSeasonCages } from '../api/batting-cages';
import { evaluateSchedule } from '../api/schedule-generator';
import type {
  ScheduledEvent,
  CreateScheduledEventInput,
  UpdateScheduledEventInput,
  SeasonPeriod,
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
  const [seasonPeriods, setSeasonPeriods] = useState<SeasonPeriod[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasonFields, setSeasonFields] = useState<SeasonField[]>([]);
  const [seasonCages, setSeasonCages] = useState<SeasonCage[]>([]);

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filter state
  const [filterPeriod, setFilterPeriod] = useState<string>('');
  const [filterDivision, setFilterDivision] = useState<string>('');
  const [filterType, setFilterType] = useState<EventType | ''>('');
  const [filterTeam, setFilterTeam] = useState<string>('');

  // View state
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar');

  // Evaluation state
  const [evaluationResult, setEvaluationResult] = useState<ScheduleEvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const [formData, setFormData] = useState<CreateScheduledEventInput>({
    seasonPeriodId: '',
    divisionId: '',
    eventType: 'practice',
    date: '',
    startTime: '17:00',
    endTime: '18:00',
    status: 'scheduled',
  });

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
  }, [currentSeason, filterPeriod, filterDivision, filterType]);

  const loadData = async () => {
    if (!currentSeason) return;
    try {
      const [periodsData, divisionsData, teamsData, fieldsData, cagesData] = await Promise.all([
        fetchSeasonPeriods(currentSeason.id),
        fetchDivisions(),
        fetchTeams(currentSeason.id),
        fetchSeasonFields(currentSeason.id),
        fetchSeasonCages(currentSeason.id),
      ]);
      setSeasonPeriods(periodsData);
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
        seasonPeriodId: filterPeriod || undefined,
        divisionId: filterDivision || undefined,
        eventType: filterType || undefined,
      });
      setEvents(data);
    } catch (error) {
      console.error('Failed to fetch events:', error);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createScheduledEvent(formData);
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

  const resetForm = () => {
    setFormData({
      seasonPeriodId: '',
      divisionId: '',
      eventType: 'practice',
      date: '',
      startTime: '17:00',
      endTime: '18:00',
      status: 'scheduled',
    });
  };

  const handleEvaluate = async () => {
    if (seasonPeriods.length === 0) {
      alert('No season periods available to evaluate');
      return;
    }

    setIsEvaluating(true);
    try {
      const periodIds = seasonPeriods.map((p) => p.id);
      const result = await evaluateSchedule(periodIds);
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

  const getPeriodName = (periodId: string) => {
    return seasonPeriods.find((p) => p.id === periodId)?.name || 'Unknown';
  };

  if (!currentSeason) {
    return (
      <div className={styles.container}>
        <p>Please select a season to view scheduled events.</p>
      </div>
    );
  }

  // Filter events by team (for calendar view - API already filters by division/type/period)
  const filteredEvents = filterTeam
    ? events.filter(
        (e) =>
          e.teamId === filterTeam ||
          e.homeTeamId === filterTeam ||
          e.awayTeamId === filterTeam
      )
    : events;

  // Group events by date
  const eventsByDate = filteredEvents.reduce((acc, event) => {
    if (!acc[event.date]) {
      acc[event.date] = [];
    }
    acc[event.date].push(event);
    return acc;
  }, {} as Record<string, ScheduledEvent[]>);

  const sortedDates = Object.keys(eventsByDate).sort();

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
          <button onClick={() => setIsCreating(true)}>Create Event</button>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label>Period:</label>
          <select value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}>
            <option value="">All Periods</option>
            {seasonPeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </div>
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
        {filterTeam && (
          <button
            className={styles.clearFilterButton}
            onClick={() => {
              setFilterTeam('');
              setFilterDivision('');
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {isCreating && (
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
              <label>Season Period *</label>
              <select
                value={formData.seasonPeriodId}
                onChange={(e) => setFormData({ ...formData, seasonPeriodId: e.target.value })}
                required
              >
                <option value="">Select Period</option>
                {seasonPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name}
                  </option>
                ))}
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
              <label>Date *</label>
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
            onEventClick={(event) => setEditingId(event.id)}
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
                          <p>
                            <strong>Period:</strong> {getPeriodName(event.seasonPeriodId)}
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
    </div>
  );
}
