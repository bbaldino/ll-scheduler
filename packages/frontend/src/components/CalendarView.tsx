import { useState, useMemo } from 'react';
import type { ScheduledEvent, Team, SeasonField, SeasonCage, Division } from '@ll-scheduler/shared';
import styles from './CalendarView.module.css';

type ViewType = 'month' | 'week' | 'day';

interface CalendarViewProps {
  events: ScheduledEvent[];
  teams: Team[];
  seasonFields: SeasonField[];
  seasonCages: SeasonCage[];
  divisions: Division[];
  onEventClick?: (event: ScheduledEvent) => void;
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
  onEventClick,
}: CalendarViewProps) {
  const [viewType, setViewType] = useState<ViewType>('month');
  const [currentDate, setCurrentDate] = useState(new Date());

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

    if (event.eventType === 'game') {
      const homeTeam = getTeamName(event.homeTeamId);
      const awayTeam = getTeamName(event.awayTeamId);
      const field = getFieldName(event.fieldId);
      return `${time}: ${homeTeam} vs ${awayTeam} @ ${field}`;
    } else if (event.eventType === 'practice') {
      const team = getTeamName(event.teamId);
      const field = getFieldName(event.fieldId);
      return `${time}: ${team} Practice @ ${field}`;
    } else {
      const team = getTeamName(event.teamId);
      const cage = getCageName(event.cageId);
      return `${time}: ${team} Cage @ ${cage}`;
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

  // Week view helpers
  const getWeekDates = (date: Date) => {
    const week: Date[] = [];
    const day = date.getDay();
    const diff = date.getDate() - day; // Get Sunday of current week

    for (let i = 0; i < 7; i++) {
      week.push(new Date(date.getFullYear(), date.getMonth(), diff + i));
    }

    return week;
  };

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let hour = 6; hour <= 22; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    return slots;
  }, []);

  const getEventsInTimeSlot = (date: Date, timeSlot: string) => {
    const dateStr = date.toISOString().split('T')[0];
    const slotHour = parseInt(timeSlot.split(':')[0]);

    return events.filter((e) => {
      if (e.date !== dateStr) return false;
      const eventHour = parseInt(e.startTime.split(':')[0]);
      return eventHour === slotHour;
    });
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
          {days.map((date, index) => (
            <div
              key={index}
              className={`${styles.dayCell} ${!date ? styles.emptyDay : ''} ${
                date && date.toDateString() === new Date().toDateString() ? styles.today : ''
              }`}
            >
              {date && (
                <>
                  <div className={styles.dayNumber}>{date.getDate()}</div>
                  <div className={styles.dayEvents}>
                    {getEventsForDate(date).map((event) => (
                      <div
                        key={event.id}
                        className={`${styles.eventItem} ${styles[event.eventType]}`}
                        onClick={() => onEventClick?.(event)}
                        title={formatEventSummary(event)}
                      >
                        {event.startTime} {event.eventType === 'game' ? '⚾' : event.eventType === 'practice' ? '🏃' : '🏏'}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDates = getWeekDates(currentDate);

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
          {weekDates.map((date) => (
            <div key={date.toISOString()} className={styles.dayColumn}>
              <div className={styles.weekDayHeader}>
                <div className={styles.weekDayName}>{DAYS_OF_WEEK[date.getDay()]}</div>
                <div className={`${styles.weekDayDate} ${
                  date.toDateString() === new Date().toDateString() ? styles.today : ''
                }`}>
                  {date.getDate()}
                </div>
              </div>
              {timeSlots.map((slot) => (
                <div key={slot} className={styles.weekTimeSlot}>
                  {getEventsInTimeSlot(date, slot).map((event) => (
                    <div
                      key={event.id}
                      className={`${styles.weekEventItem} ${styles[event.eventType]}`}
                      onClick={() => onEventClick?.(event)}
                      title={formatEventSummary(event)}
                    >
                      <div className={styles.eventTime}>{event.startTime}-{event.endTime}</div>
                      <div className={styles.eventDetails}>
                        {event.eventType === 'game' && (
                          <>
                            <div>{getTeamName(event.homeTeamId)} vs</div>
                            <div>{getTeamName(event.awayTeamId)}</div>
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
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayEvents = events.filter((e) => e.date === dateStr);

    return (
      <div className={styles.dayView}>
        <div className={styles.dayGrid}>
          {timeSlots.map((slot) => {
            const slotHour = parseInt(slot.split(':')[0]);
            const slotEvents = dayEvents.filter((e) => {
              const eventHour = parseInt(e.startTime.split(':')[0]);
              return eventHour === slotHour;
            });

            return (
              <div key={slot} className={styles.dayTimeSlot}>
                <div className={styles.dayTimeLabel}>{slot}</div>
                <div className={styles.dayTimeEvents}>
                  {slotEvents.map((event) => (
                    <div
                      key={event.id}
                      className={`${styles.dayEventItem} ${styles[event.eventType]}`}
                      onClick={() => onEventClick?.(event)}
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
            );
          })}
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
    </div>
  );
}
