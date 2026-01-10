import { useState, useMemo } from 'react';
import type {
  ScheduledEvent,
  Team,
  SeasonField,
  SeasonCage,
  Division,
  UpdateScheduledEventInput,
} from '@ll-scheduler/shared';
import styles from './CalendarView.module.css';

type ViewType = 'month' | 'week' | 'day';

const EVENT_TYPE_LABELS: Record<string, string> = {
  game: 'Game',
  practice: 'Practice',
  cage: 'Cage',
};

interface SeasonMilestones {
  startDate?: string;
  gamesStartDate?: string;
  endDate?: string;
}

interface CalendarViewProps {
  events: ScheduledEvent[];
  teams: Team[];
  seasonFields: SeasonField[];
  seasonCages: SeasonCage[];
  divisions: Division[];
  initialDate?: string; // ISO date string to start the calendar on
  seasonMilestones?: SeasonMilestones; // Key season dates to annotate
  onEventClick?: (event: ScheduledEvent) => void;
  onEventUpdate?: (id: string, input: UpdateScheduledEventInput) => Promise<void>;
  onEventDelete?: (id: string) => Promise<void>;
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function CalendarView({
  events,
  teams,
  seasonFields,
  seasonCages,
  divisions,
  initialDate,
  seasonMilestones,
  onEventClick,
  onEventUpdate,
  onEventDelete,
}: CalendarViewProps) {
  const [viewType, setViewType] = useState<ViewType>('month');
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialDate) {
      return new Date(initialDate + 'T00:00:00');
    }
    return new Date();
  });
  const [editingEvent, setEditingEvent] = useState<ScheduledEvent | null>(null);
  const [editFormData, setEditFormData] = useState<UpdateScheduledEventInput>({});

  const handleEventClick = (event: ScheduledEvent) => {
    if (onEventUpdate) {
      // If we have update capability, open the edit modal
      setEditingEvent(event);
      setEditFormData({
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        status: event.status,
        fieldId: event.fieldId,
        cageId: event.cageId,
        homeTeamId: event.homeTeamId,
        awayTeamId: event.awayTeamId,
        teamId: event.teamId,
      });
    }
    onEventClick?.(event);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEvent || !onEventUpdate) return;

    try {
      await onEventUpdate(editingEvent.id, editFormData);
      setEditingEvent(null);
      setEditFormData({});
    } catch (error) {
      console.error('Failed to update event:', error);
      alert('Failed to update event');
    }
  };

  const handleDelete = async () => {
    if (!editingEvent || !onEventDelete) return;
    if (!confirm('Are you sure you want to delete this event?')) return;

    try {
      await onEventDelete(editingEvent.id);
      setEditingEvent(null);
      setEditFormData({});
    } catch (error) {
      console.error('Failed to delete event:', error);
      alert('Failed to delete event');
    }
  };

  const closeModal = () => {
    setEditingEvent(null);
    setEditFormData({});
  };

  const getTeamName = (teamId?: string) => {
    if (!teamId) return '';
    return teams.find((t) => t.id === teamId)?.name || 'Unknown Team';
  };

  const getFieldName = (fieldId?: string) => {
    if (!fieldId) return '';
    const sf = seasonFields.find((f) => f.fieldId === fieldId);
    return sf?.fieldName || sf?.field?.name || 'Unknown Field';
  };

  const getCageName = (cageId?: string) => {
    if (!cageId) return '';
    const sc = seasonCages.find((c) => c.cageId === cageId);
    return sc?.cageName || sc?.cage?.name || 'Unknown Cage';
  };

  const getDivisionName = (divisionId: string) => {
    return divisions.find((d) => d.id === divisionId)?.name || 'Unknown Division';
  };

  const formatEventSummary = (event: ScheduledEvent) => {
    const time = `${event.startTime}-${event.endTime}`;
    const division = getDivisionName(event.divisionId);

    if (event.eventType === 'game') {
      const homeTeam = getTeamName(event.homeTeamId);
      const awayTeam = getTeamName(event.awayTeamId);
      const field = getFieldName(event.fieldId);
      return `${time}: ${homeTeam} vs ${awayTeam} @ ${field} (${division})`;
    } else if (event.eventType === 'practice') {
      const team = getTeamName(event.teamId);
      const field = getFieldName(event.fieldId);
      return `${time}: ${team} Practice @ ${field} (${division})`;
    } else {
      const team = getTeamName(event.teamId);
      const cage = getCageName(event.cageId);
      return `${time}: ${team} Cage @ ${cage} (${division})`;
    }
  };

  // Month view helpers
  const getMonthDays = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];

    // Add empty slots for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    // Add all days in month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  };

  const getEventsForDate = (date: Date | null) => {
    if (!date) return [];
    const dateStr = date.toISOString().split('T')[0];
    return events.filter((e) => e.date === dateStr);
  };

  // Get season milestones for a specific date
  const getMilestonesForDate = (dateStr: string): string[] => {
    if (!seasonMilestones) return [];
    const milestones: string[] = [];
    if (seasonMilestones.startDate === dateStr) {
      milestones.push('Season Start');
    }
    if (seasonMilestones.gamesStartDate === dateStr && seasonMilestones.gamesStartDate !== seasonMilestones.startDate) {
      milestones.push('Games Start');
    }
    if (seasonMilestones.endDate === dateStr) {
      milestones.push('Season End');
    }
    return milestones;
  };

  // Week view helpers - starts on Monday
  const getWeekDates = (date: Date) => {
    const week: Date[] = [];
    const day = date.getDay();
    // Adjust to get Monday: if Sunday (0), go back 6 days; otherwise go back (day - 1) days
    const diff = date.getDate() - (day === 0 ? 6 : day - 1);

    for (let i = 0; i < 7; i++) {
      week.push(new Date(date.getFullYear(), date.getMonth(), diff + i));
    }

    return week;
  };

  // Constants for time-based layout
  const START_HOUR = 6;
  const END_HOUR = 22;
  const HOUR_HEIGHT = 60; // pixels per hour

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    return slots;
  }, []);

  // Convert time string to minutes from midnight
  const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Get events for a specific date
  const getEventsForDateStr = (dateStr: string): ScheduledEvent[] => {
    return events.filter((e) => e.date === dateStr);
  };

  // Calculate overlapping event groups and assign columns
  const layoutEvents = (dayEvents: ScheduledEvent[]): Array<{
    event: ScheduledEvent;
    column: number;
    totalColumns: number;
    top: number;
    height: number;
  }> => {
    if (dayEvents.length === 0) return [];

    // Sort events by start time, then by end time
    const sortedEvents = [...dayEvents].sort((a, b) => {
      const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      if (startDiff !== 0) return startDiff;
      return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
    });

    // Find overlapping groups and assign columns
    const layoutInfo: Array<{
      event: ScheduledEvent;
      column: number;
      totalColumns: number;
      top: number;
      height: number;
    }> = [];

    // Track active columns (end time for each column)
    const columns: number[] = [];

    for (const event of sortedEvents) {
      const startMinutes = timeToMinutes(event.startTime);
      const endMinutes = timeToMinutes(event.endTime);
      const startFromBase = startMinutes - START_HOUR * 60;
      const duration = endMinutes - startMinutes;

      // Find the first available column
      let column = 0;
      while (column < columns.length && columns[column] > startMinutes) {
        column++;
      }

      // Assign event to this column
      if (column < columns.length) {
        columns[column] = endMinutes;
      } else {
        columns.push(endMinutes);
      }

      layoutInfo.push({
        event,
        column,
        totalColumns: 0, // Will be calculated later
        top: (startFromBase / 60) * HOUR_HEIGHT,
        height: (duration / 60) * HOUR_HEIGHT,
      });
    }

    // Calculate total columns for each event based on overlapping events
    for (const info of layoutInfo) {
      const startMinutes = timeToMinutes(info.event.startTime);
      const endMinutes = timeToMinutes(info.event.endTime);

      // Find max column among overlapping events
      let maxColumn = info.column;
      for (const other of layoutInfo) {
        const otherStart = timeToMinutes(other.event.startTime);
        const otherEnd = timeToMinutes(other.event.endTime);

        // Check if events overlap
        if (startMinutes < otherEnd && endMinutes > otherStart) {
          maxColumn = Math.max(maxColumn, other.column);
        }
      }

      info.totalColumns = maxColumn + 1;
    }

    return layoutInfo;
  };

  // Navigation helpers
  const goToPreviousPeriod = () => {
    const newDate = new Date(currentDate);
    if (viewType === 'month') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (viewType === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() - 1);
    }
    setCurrentDate(newDate);
  };

  const goToNextPeriod = () => {
    const newDate = new Date(currentDate);
    if (viewType === 'month') {
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (viewType === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Render functions
  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = getMonthDays(year, month);

    return (
      <div className={styles.monthView}>
        <div className={styles.monthGrid}>
          {DAYS_OF_WEEK.map((day) => (
            <div key={day} className={styles.dayHeader}>
              {day}
            </div>
          ))}
          {days.map((date, index) => {
            const dateStr = date ? date.toISOString().split('T')[0] : '';
            const milestones = date ? getMilestonesForDate(dateStr) : [];
            return (
              <div
                key={index}
                className={`${styles.dayCell} ${!date ? styles.emptyDay : ''} ${
                  date && date.toDateString() === new Date().toDateString() ? styles.today : ''
                }`}
              >
                {date && (
                  <>
                    <div className={styles.dayNumber}>{date.getDate()}</div>
                    {milestones.length > 0 && (
                      <div className={styles.milestones}>
                        {milestones.map((milestone) => (
                          <div key={milestone} className={styles.milestone}>
                            {milestone}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.dayEvents}>
                      {getEventsForDate(date).map((event) => (
                        <div
                          key={event.id}
                          className={`${styles.eventItem} ${styles[event.eventType]}`}
                          onClick={() => handleEventClick(event)}
                          title={formatEventSummary(event)}
                        >
                          {event.startTime} {event.eventType === 'game' ? '⚾' : event.eventType === 'practice' ? '🏃' : '🏏'}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDates = getWeekDates(currentDate);
    const totalHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;

    return (
      <div className={styles.weekView}>
        <div className={styles.weekGrid}>
          <div className={styles.timeColumn}>
            <div className={styles.timeHeader}></div>
            {timeSlots.map((slot) => (
              <div key={slot} className={styles.timeSlot}>
                {slot}
              </div>
            ))}
          </div>
          {weekDates.map((date) => {
            const dateStr = date.toISOString().split('T')[0];
            const dayEvents = getEventsForDateStr(dateStr);
            const layoutInfo = layoutEvents(dayEvents);
            const milestones = getMilestonesForDate(dateStr);

            return (
              <div key={date.toISOString()} className={styles.dayColumn}>
                <div className={styles.weekDayHeader}>
                  <div className={styles.weekDayName}>{DAYS_OF_WEEK[date.getDay()]}</div>
                  <div className={`${styles.weekDayDate} ${
                    date.toDateString() === new Date().toDateString() ? styles.today : ''
                  }`}>
                    {date.getDate()}
                  </div>
                  {milestones.length > 0 && (
                    <div className={styles.weekMilestones}>
                      {milestones.map((milestone) => (
                        <div key={milestone} className={styles.weekMilestone}>
                          {milestone}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.weekDayBody} style={{ height: totalHeight, position: 'relative' }}>
                  {/* Grid lines for hours */}
                  {timeSlots.map((slot) => (
                    <div key={slot} className={styles.weekTimeSlotLine}></div>
                  ))}
                  {/* Events positioned absolutely */}
                  {layoutInfo.map(({ event, column, totalColumns, top, height }) => (
                    <div
                      key={event.id}
                      className={`${styles.weekEventItem} ${styles[event.eventType]}`}
                      onClick={() => handleEventClick(event)}
                      title={formatEventSummary(event)}
                      style={{
                        position: 'absolute',
                        top: `${top}px`,
                        height: `${Math.max(height, 20)}px`,
                        left: `${(column / totalColumns) * 100}%`,
                        width: `${(1 / totalColumns) * 100 - 1}%`,
                        overflow: 'hidden',
                      }}
                    >
                      <div className={styles.eventTime}>{event.startTime}-{event.endTime}</div>
                      <div className={styles.eventDetails}>
                        {event.eventType === 'game' && (
                          <>
                            <div>{getTeamName(event.homeTeamId)} vs {getTeamName(event.awayTeamId)}</div>
                            <div className={styles.eventLocation}>@ {getFieldName(event.fieldId)}</div>
                          </>
                        )}
                        {event.eventType === 'practice' && (
                          <>
                            <div>{getTeamName(event.teamId)}</div>
                            <div className={styles.eventLocation}>@ {getFieldName(event.fieldId)}</div>
                          </>
                        )}
                        {event.eventType === 'cage' && (
                          <>
                            <div>{getTeamName(event.teamId)}</div>
                            <div className={styles.eventLocation}>@ {getCageName(event.cageId)}</div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayEvents = events.filter((e) => e.date === dateStr);
    const layoutInfo = layoutEvents(dayEvents);
    const totalHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;

    return (
      <div className={styles.dayView}>
        <div className={styles.dayGrid}>
          <div className={styles.dayTimeColumn}>
            {timeSlots.map((slot) => (
              <div key={slot} className={styles.dayTimeLabel}>{slot}</div>
            ))}
          </div>
          <div className={styles.dayEventsColumn} style={{ height: totalHeight, position: 'relative' }}>
            {/* Grid lines for hours */}
            {timeSlots.map((slot) => (
              <div key={slot} className={styles.dayTimeSlotLine}></div>
            ))}
            {/* Events positioned absolutely */}
            {layoutInfo.map(({ event, column, totalColumns, top, height }) => (
              <div
                key={event.id}
                className={`${styles.dayEventItem} ${styles[event.eventType]}`}
                onClick={() => handleEventClick(event)}
                style={{
                  position: 'absolute',
                  top: `${top}px`,
                  height: `${Math.max(height, 40)}px`,
                  left: `${(column / totalColumns) * 100}%`,
                  width: `${(1 / totalColumns) * 100 - 1}%`,
                  overflow: 'hidden',
                }}
              >
                <div className={styles.eventTime}>
                  {event.startTime} - {event.endTime}
                </div>
                <div className={styles.eventType}>
                  {event.eventType === 'game' ? 'Game' : event.eventType === 'practice' ? 'Practice' : 'Cage Time'}
                </div>
                {event.eventType === 'game' && (
                  <div className={styles.eventTeams}>
                    {getTeamName(event.homeTeamId)} vs {getTeamName(event.awayTeamId)}
                  </div>
                )}
                {(event.eventType === 'practice' || event.eventType === 'cage') && (
                  <div className={styles.eventTeams}>{getTeamName(event.teamId)}</div>
                )}
                <div className={styles.eventLocation}>
                  {event.eventType === 'cage' ? getCageName(event.cageId) : getFieldName(event.fieldId)}
                </div>
                <div className={styles.eventDivision}>
                  {getDivisionName(event.divisionId)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const getHeaderTitle = () => {
    if (viewType === 'month') {
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    } else if (viewType === 'week') {
      const weekDates = getWeekDates(currentDate);
      const start = weekDates[0];
      const end = weekDates[6];
      return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} - ${
        start.getMonth() !== end.getMonth() ? MONTH_NAMES[end.getMonth()] + ' ' : ''
      }${end.getDate()}, ${end.getFullYear()}`;
    } else {
      return currentDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  };

  return (
    <div className={styles.calendarView}>
      <div className={styles.calendarHeader}>
        <div className={styles.viewTabs}>
          <button
            className={viewType === 'month' ? styles.activeTab : ''}
            onClick={() => setViewType('month')}
          >
            Month
          </button>
          <button
            className={viewType === 'week' ? styles.activeTab : ''}
            onClick={() => setViewType('week')}
          >
            Week
          </button>
          <button
            className={viewType === 'day' ? styles.activeTab : ''}
            onClick={() => setViewType('day')}
          >
            Day
          </button>
        </div>
        <div className={styles.navigation}>
          <button onClick={goToPreviousPeriod}>←</button>
          <button onClick={goToToday}>Today</button>
          <button onClick={goToNextPeriod}>→</button>
        </div>
        <div className={styles.currentPeriod}>{getHeaderTitle()}</div>
      </div>
      <div className={styles.calendarContent}>
        {viewType === 'month' && renderMonthView()}
        {viewType === 'week' && renderWeekView()}
        {viewType === 'day' && renderDayView()}
      </div>

      {/* Edit Event Modal */}
      {editingEvent && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Edit {EVENT_TYPE_LABELS[editingEvent.eventType]}</h3>
              <button className={styles.closeButton} onClick={closeModal}>
                ×
              </button>
            </div>
            <form onSubmit={handleUpdate} className={styles.editForm}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Date</label>
                  <input
                    type="date"
                    value={editFormData.date || editingEvent.date}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, date: e.target.value })
                    }
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Start Time</label>
                  <input
                    type="time"
                    value={editFormData.startTime || editingEvent.startTime}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, startTime: e.target.value })
                    }
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>End Time</label>
                  <input
                    type="time"
                    value={editFormData.endTime || editingEvent.endTime}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, endTime: e.target.value })
                    }
                  />
                </div>
              </div>

              {/* Team display for practices */}
              {editingEvent.eventType === 'practice' && (
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Team</label>
                    <span className={styles.teamDisplay}>
                      {getTeamName(editingEvent.teamId)}
                    </span>
                  </div>
                </div>
              )}

              {/* Field selection for games and practices */}
              {(editingEvent.eventType === 'game' || editingEvent.eventType === 'practice') && (
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Field</label>
                    <select
                      value={editFormData.fieldId || editingEvent.fieldId || ''}
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
              {editingEvent.eventType === 'cage' && (
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Team</label>
                    <span className={styles.teamDisplay}>
                      {getTeamName(editingEvent.teamId)}
                    </span>
                  </div>
                  <div className={styles.formGroup}>
                    <label>Cage</label>
                    <select
                      value={editFormData.cageId || editingEvent.cageId || ''}
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
              {editingEvent.eventType === 'game' && (
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Home Team</label>
                    <span className={styles.teamDisplay}>
                      {getTeamName(editFormData.homeTeamId || editingEvent.homeTeamId)}
                    </span>
                  </div>
                  <div className={styles.formGroup}>
                    <label>Away Team</label>
                    <span className={styles.teamDisplay}>
                      {getTeamName(editFormData.awayTeamId || editingEvent.awayTeamId)}
                    </span>
                  </div>
                  <div className={styles.formGroup}>
                    <button
                      type="button"
                      className={styles.swapButton}
                      onClick={() => {
                        const currentHome = editFormData.homeTeamId || editingEvent.homeTeamId;
                        const currentAway = editFormData.awayTeamId || editingEvent.awayTeamId;
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
                <button type="submit" className={styles.saveButton}>Save</button>
                {onEventDelete && (
                  <button type="button" className={styles.deleteButton} onClick={handleDelete}>
                    Delete
                  </button>
                )}
                <button type="button" className={styles.cancelButton} onClick={closeModal}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
