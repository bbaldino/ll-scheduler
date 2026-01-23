import { useState, useMemo, useCallback } from 'react';
import type {
  ScheduledEvent,
  Team,
  SeasonField,
  SeasonCage,
  Division,
  DivisionConfig,
  UpdateScheduledEventInput,
  CreateScheduledEventInput,
  EventType,
  AvailableSlot,
} from '@ll-scheduler/shared';
import { formatTime12Hour, formatTimeRange12Hour } from '../utils/timeFormat';
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

// Unified blackout date for calendar display
interface CalendarBlackout {
  date: string;
  description?: string;
  divisionName?: string; // If division-specific, shows "(Division Name)"
}

interface CalendarViewProps {
  events: ScheduledEvent[];
  teams: Team[];
  seasonFields: SeasonField[];
  seasonCages: SeasonCage[];
  divisions: Division[];
  divisionConfigs?: DivisionConfig[]; // For accessing division-specific settings like gameArriveBeforeHours
  seasonId?: string; // Required for creating events
  initialDate?: string; // ISO date string to start the calendar on
  seasonMilestones?: SeasonMilestones; // Key season dates to annotate
  blackoutDates?: CalendarBlackout[]; // Blackout dates to display
  availableSlots?: AvailableSlot[]; // Available resource slots to show unused time
  onEventClick?: (event: ScheduledEvent) => void;
  onEventCreate?: (input: CreateScheduledEventInput) => Promise<void>;
  onEventCreateBulk?: (inputs: CreateScheduledEventInput[]) => Promise<{ createdCount: number }>;
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
  divisionConfigs,
  seasonId,
  initialDate,
  seasonMilestones,
  blackoutDates,
  availableSlots,
  onEventClick,
  onEventCreate,
  onEventCreateBulk,
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

  // Create event state
  const [creatingForDate, setCreatingForDate] = useState<string | null>(null);
  const [createFormData, setCreateFormData] = useState<Partial<CreateScheduledEventInput>>({
    eventType: 'practice',
    startTime: '09:00',
    endTime: '10:00',
  });
  const [createError, setCreateError] = useState<string | null>(null);

  // Recurrence state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDays, setRecurringDays] = useState<number[]>([]); // 0=Sun, 1=Mon, ..., 6=Sat
  const [recurringEndType, setRecurringEndType] = useState<'date' | 'count'>('count');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [recurringCount, setRecurringCount] = useState(8);

  // Swap mode state
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapFilters, setSwapFilters] = useState({ sameDivision: true, sameEventType: true });
  const [selectedSwapDate, setSelectedSwapDate] = useState<string | null>(null); // For day zoom
  const [selectedSwapTarget, setSelectedSwapTarget] = useState<ScheduledEvent | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);

  // Date picker mode state (for moving single event)
  const [isDatePickerMode, setIsDatePickerMode] = useState(false);
  const [datePickerFilters, setDatePickerFilters] = useState({ sameDivision: true, sameEventType: true });
  const [selectedDatePickerDate, setSelectedDatePickerDate] = useState<string | null>(null);
  const [datePickerTime, setDatePickerTime] = useState({ startTime: '', endTime: '' });

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
    setIsSwapMode(false);
    setIsDatePickerMode(false);
    setSelectedSwapDate(null);
    setSelectedSwapTarget(null);
    setSwapFilters({ sameDivision: true, sameEventType: true });
    setDatePickerFilters({ sameDivision: true, sameEventType: true });
    setSelectedDatePickerDate(null);
    setDatePickerTime({ startTime: '', endTime: '' });
  };

  // Execute swap between two events
  const executeSwap = async () => {
    if (!editingEvent || !selectedSwapTarget || !onEventUpdate) return;
    setIsSwapping(true);
    try {
      const slotA = {
        date: editingEvent.date,
        startTime: editingEvent.startTime,
        endTime: editingEvent.endTime,
        fieldId: editingEvent.fieldId,
        cageId: editingEvent.cageId,
      };
      const slotB = {
        date: selectedSwapTarget.date,
        startTime: selectedSwapTarget.startTime,
        endTime: selectedSwapTarget.endTime,
        fieldId: selectedSwapTarget.fieldId,
        cageId: selectedSwapTarget.cageId,
      };

      await onEventUpdate(editingEvent.id, slotB);
      await onEventUpdate(selectedSwapTarget.id, slotA);

      // Close modal and reset state
      setEditingEvent(null);
      setEditFormData({});
      setIsSwapMode(false);
      setSelectedSwapDate(null);
      setSelectedSwapTarget(null);
      setSwapFilters({ sameDivision: true, sameEventType: true });
    } catch (error) {
      console.error('Failed to swap events:', error);
      alert('Failed to swap events');
    } finally {
      setIsSwapping(false);
    }
  };

  // Check for conflicting events when editing
  // Returns events that overlap with the given slot (excluding the event being edited)
  const findSlotConflicts = useCallback(
    (
      excludeEventId: string,
      date: string,
      startTime: string,
      endTime: string,
      fieldId?: string,
      cageId?: string
    ): ScheduledEvent[] => {
      return events.filter((e) => {
        // Don't conflict with self
        if (e.id === excludeEventId) return false;
        // Must be on the same date
        if (e.date !== date) return false;
        // Must use the same resource
        const sameField = fieldId && e.fieldId === fieldId;
        const sameCage = cageId && e.cageId === cageId;
        if (!sameField && !sameCage) return false;
        // Check time overlap
        const overlaps = startTime < e.endTime && endTime > e.startTime;
        return overlaps;
      });
    },
    [events]
  );

  // Compute conflicts for both events after swap (for confirmation dialog)
  const swapConflicts = useMemo(() => {
    if (!editingEvent || !selectedSwapTarget) return { sourceConflicts: [], targetConflicts: [] };

    // Check conflicts for source event moving to target slot
    const sourceConflicts = findSlotConflicts(
      editingEvent.id,
      selectedSwapTarget.date,
      selectedSwapTarget.startTime,
      selectedSwapTarget.endTime,
      selectedSwapTarget.fieldId || undefined,
      selectedSwapTarget.cageId || undefined
    ).filter((e) => e.id !== selectedSwapTarget.id);

    // Check conflicts for target event moving to source slot
    const targetConflicts = findSlotConflicts(
      selectedSwapTarget.id,
      editingEvent.date,
      editingEvent.startTime,
      editingEvent.endTime,
      editingEvent.fieldId || undefined,
      editingEvent.cageId || undefined
    ).filter((e) => e.id !== editingEvent.id);

    return { sourceConflicts, targetConflicts };
  }, [editingEvent, selectedSwapTarget, findSlotConflicts]);

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

  // Create event handlers
  const handleDayClick = (dateStr: string) => {
    if (!onEventCreate || !seasonId) return;
    setCreatingForDate(dateStr);
    setCreateFormData({
      eventType: 'practice',
      startTime: '09:00',
      endTime: '10:00',
    });
    setCreateError(null);
    setIsRecurring(false);
    setRecurringDays([]);
    setRecurringEndType('count');
    setRecurringEndDate('');
    setRecurringCount(8);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onEventCreate || !seasonId || !creatingForDate) return;

    if (!createFormData.divisionId) {
      setCreateError('Please select a division');
      return;
    }

    try {
      if (isRecurring) {
        // Validate recurrence settings
        if (recurringDays.length === 0) {
          setCreateError('Please select at least one day of the week for recurring events.');
          return;
        }
        if (recurringEndType === 'date' && !recurringEndDate) {
          setCreateError('Please select an end date for recurring events.');
          return;
        }
        if (recurringEndType === 'count' && recurringCount < 1) {
          setCreateError('Please enter a valid number of occurrences.');
          return;
        }

        if (!onEventCreateBulk) {
          setCreateError('Bulk creation not available');
          return;
        }

        // Generate all dates
        const dates = generateRecurringDates(
          creatingForDate,
          recurringDays,
          recurringEndType === 'date'
            ? { type: 'date', endDate: recurringEndDate }
            : { type: 'count', count: recurringCount }
        );

        if (dates.length === 0) {
          setCreateError('No dates match the selected pattern. Please check your settings.');
          return;
        }

        // Create events for all dates
        const events = dates.map((date) => ({
          seasonId,
          divisionId: createFormData.divisionId!,
          eventType: createFormData.eventType || 'practice',
          date,
          startTime: createFormData.startTime || '09:00',
          endTime: createFormData.endTime || '10:00',
          fieldId: createFormData.fieldId,
          cageId: createFormData.cageId,
          homeTeamId: createFormData.homeTeamId,
          awayTeamId: createFormData.awayTeamId,
          teamId: createFormData.teamId,
        } as CreateScheduledEventInput));

        const result = await onEventCreateBulk(events);
        alert(`Created ${result.createdCount} events.`);
      } else {
        await onEventCreate({
          seasonId,
          divisionId: createFormData.divisionId,
          eventType: createFormData.eventType || 'practice',
          date: creatingForDate,
          startTime: createFormData.startTime || '09:00',
          endTime: createFormData.endTime || '10:00',
          fieldId: createFormData.fieldId,
          cageId: createFormData.cageId,
          homeTeamId: createFormData.homeTeamId,
          awayTeamId: createFormData.awayTeamId,
          teamId: createFormData.teamId,
        });
      }
      setCreatingForDate(null);
      setCreateFormData({
        eventType: 'practice',
        startTime: '09:00',
        endTime: '10:00',
      });
      setCreateError(null);
      setIsRecurring(false);
      setRecurringDays([]);
    } catch (error) {
      console.error('Failed to create event:', error);
      setCreateError('Failed to create event');
    }
  };

  const closeCreateModal = () => {
    setCreatingForDate(null);
    setCreateFormData({
      eventType: 'practice',
      startTime: '09:00',
      endTime: '10:00',
    });
    setCreateError(null);
    setIsRecurring(false);
    setRecurringDays([]);
    setRecurringEndType('count');
    setRecurringEndDate('');
    setRecurringCount(8);
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

  const getDivisionConfig = (divisionId: string) => {
    return divisionConfigs?.find((dc) => dc.divisionId === divisionId);
  };

  // Compute conflicts for the event being edited
  const editConflicts = useMemo(() => {
    if (!editingEvent) return [];

    const date = editFormData.date || editingEvent.date;
    const startTime = editFormData.startTime || editingEvent.startTime;
    const endTime = editFormData.endTime || editingEvent.endTime;
    const fieldId = editFormData.fieldId !== undefined ? editFormData.fieldId : editingEvent.fieldId;
    const cageId = editFormData.cageId !== undefined ? editFormData.cageId : editingEvent.cageId;

    return findSlotConflicts(editingEvent.id, date, startTime, endTime, fieldId || undefined, cageId || undefined);
  }, [editingEvent, editFormData, findSlotConflicts]);

  // Compute swap candidates based on filters
  const swapCandidates = useMemo(() => {
    if (!editingEvent || !isSwapMode) return [];
    return events.filter((e) => {
      if (e.id === editingEvent.id) return false;
      if (swapFilters.sameDivision && e.divisionId !== editingEvent.divisionId) return false;
      if (swapFilters.sameEventType && e.eventType !== editingEvent.eventType) return false;
      return true;
    });
  }, [events, editingEvent, isSwapMode, swapFilters]);

  // Group swap candidates by date for mini calendar view
  const swapCandidatesByDate = useMemo(() => {
    const byDate = new Map<string, ScheduledEvent[]>();
    for (const candidate of swapCandidates) {
      const existing = byDate.get(candidate.date) || [];
      existing.push(candidate);
      byDate.set(candidate.date, existing);
    }
    return byDate;
  }, [swapCandidates]);

  // Compute filtered events by date for date picker calendar
  const datePickerEventsByDate = useMemo(() => {
    if (!editingEvent || !isDatePickerMode) return new Map<string, ScheduledEvent[]>();

    const filtered = events.filter((e) => {
      if (e.id === editingEvent.id) return false;
      if (datePickerFilters.sameDivision && e.divisionId !== editingEvent.divisionId) return false;
      if (datePickerFilters.sameEventType && e.eventType !== editingEvent.eventType) return false;
      return true;
    });

    const byDate = new Map<string, ScheduledEvent[]>();
    for (const event of filtered) {
      const existing = byDate.get(event.date) || [];
      existing.push(event);
      byDate.set(event.date, existing);
    }
    return byDate;
  }, [events, editingEvent, isDatePickerMode, datePickerFilters]);

  // Compute conflicts for date picker selection
  const datePickerConflicts = useMemo(() => {
    if (!editingEvent || !selectedDatePickerDate) return [];

    const startTime = datePickerTime.startTime || editingEvent.startTime;
    const endTime = datePickerTime.endTime || editingEvent.endTime;
    const fieldId = editFormData.fieldId !== undefined ? editFormData.fieldId : editingEvent.fieldId;
    const cageId = editFormData.cageId !== undefined ? editFormData.cageId : editingEvent.cageId;

    return findSlotConflicts(
      editingEvent.id,
      selectedDatePickerDate,
      startTime,
      endTime,
      fieldId || undefined,
      cageId || undefined
    );
  }, [editingEvent, selectedDatePickerDate, datePickerTime, editFormData, findSlotConflicts]);

  // Get all events on the selected date picker date (unfiltered, for display)
  const allEventsOnSelectedDate = useMemo(() => {
    if (!selectedDatePickerDate) return [];
    return events.filter((e) => e.date === selectedDatePickerDate && e.id !== editingEvent?.id);
  }, [events, selectedDatePickerDate, editingEvent]);

  // Get date range for swap calendar (use season dates if available, otherwise +/- 6 weeks)
  const swapCalendarRange = useMemo(() => {
    if (!editingEvent) return { start: new Date(), end: new Date() };

    // Use season milestones if available
    if (seasonMilestones?.startDate && seasonMilestones?.endDate) {
      return {
        start: new Date(seasonMilestones.startDate + 'T00:00:00'),
        end: new Date(seasonMilestones.endDate + 'T00:00:00'),
      };
    }

    // Fallback to +/- 6 weeks from event date
    const eventDate = new Date(editingEvent.date + 'T00:00:00');
    const start = new Date(eventDate);
    start.setDate(start.getDate() - 42);
    const end = new Date(eventDate);
    end.setDate(end.getDate() + 42);
    return { start, end };
  }, [editingEvent, seasonMilestones]);

  // For games, calculate the actual game start time (block start + arrive before time)
  const getGameStartTime = (event: ScheduledEvent): string | null => {
    if (event.eventType !== 'game') return null;
    const config = getDivisionConfig(event.divisionId);
    const arriveBeforeHours = config?.gameArriveBeforeHours || 0;
    if (arriveBeforeHours === 0) return null; // No arrive-before time configured

    // Parse start time and add arrive-before hours
    const [hours, minutes] = event.startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + Math.round(arriveBeforeHours * 60);
    const gameHours = Math.floor(totalMinutes / 60);
    const gameMinutes = totalMinutes % 60;
    return `${gameHours.toString().padStart(2, '0')}:${gameMinutes.toString().padStart(2, '0')}`;
  };

  const formatEventSummary = (event: ScheduledEvent) => {
    const time = formatTimeRange12Hour(event.startTime, event.endTime);
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

  // Get blackout dates for a specific date
  const getBlackoutsForDate = (dateStr: string): CalendarBlackout[] => {
    if (!blackoutDates) return [];
    return blackoutDates.filter((b) => b.date === dateStr);
  };

  // Calculate unused slots for a date by subtracting scheduled events from available slots
  interface UnusedSlot {
    resourceType: 'field' | 'cage';
    resourceId: string;
    resourceName: string;
    startTime: string;
    endTime: string;
  }

  const getUnusedSlotsForDate = (dateStr: string): UnusedSlot[] => {
    if (!availableSlots) {
      return [];
    }

    const slotsForDate = availableSlots.filter((s) => s.date === dateStr);
    const eventsForDate = events.filter((e) => e.date === dateStr);
    const unusedSlots: UnusedSlot[] = [];

    for (const slot of slotsForDate) {
      // Get events that overlap with this slot's resource
      const overlappingEvents = eventsForDate.filter((e) =>
        (slot.resourceType === 'field' && e.fieldId === slot.resourceId) ||
        (slot.resourceType === 'cage' && e.cageId === slot.resourceId)
      );

      if (overlappingEvents.length === 0) {
        // No events, entire slot is unused
        unusedSlots.push({
          resourceType: slot.resourceType,
          resourceId: slot.resourceId,
          resourceName: slot.resourceName,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      } else {
        // Subtract event time ranges from slot time range
        const remaining = subtractTimeRanges(
          { start: slot.startTime, end: slot.endTime },
          overlappingEvents.map((e) => ({ start: e.startTime, end: e.endTime }))
        );

        for (const window of remaining) {
          unusedSlots.push({
            resourceType: slot.resourceType,
            resourceId: slot.resourceId,
            resourceName: slot.resourceName,
            startTime: window.start,
            endTime: window.end,
          });
        }
      }
    }

    return unusedSlots;
  };

  // Subtract multiple time ranges from a slot, returning remaining windows
  const subtractTimeRanges = (
    slot: { start: string; end: string },
    ranges: Array<{ start: string; end: string }>
  ): Array<{ start: string; end: string }> => {
    if (ranges.length === 0) {
      return [slot];
    }

    // Sort ranges by start time
    const sortedRanges = [...ranges].sort((a, b) =>
      a.start.localeCompare(b.start)
    );

    const result: Array<{ start: string; end: string }> = [];
    let currentStart = slot.start;

    for (const range of sortedRanges) {
      // If range starts after our current window ends, we're done with it
      if (range.start >= slot.end) break;

      // If range ends before our current window starts, skip it
      if (range.end <= currentStart) continue;

      // If there's a gap before this range, add it as unused
      if (range.start > currentStart) {
        result.push({
          start: currentStart,
          end: range.start < slot.end ? range.start : slot.end,
        });
      }

      // Move current start past this range
      currentStart = range.end > currentStart ? range.end : currentStart;
    }

    // If there's remaining time after all ranges, add it
    if (currentStart < slot.end) {
      result.push({
        start: currentStart,
        end: slot.end,
      });
    }

    return result;
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
            const blackouts = date ? getBlackoutsForDate(dateStr) : [];
            return (
              <div
                key={index}
                className={`${styles.dayCell} ${!date ? styles.emptyDay : ''} ${
                  date && date.toDateString() === new Date().toDateString() ? styles.today : ''
                } ${date && onEventCreate ? styles.clickable : ''} ${blackouts.length > 0 ? styles.hasBlackout : ''}`}
                onClick={() => date && handleDayClick(dateStr)}
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
                    {blackouts.length > 0 && (
                      <div className={styles.blackouts}>
                        {blackouts.map((blackout, idx) => {
                          const titleParts: string[] = [];
                          if (blackout.description) titleParts.push(blackout.description);
                          if (blackout.divisionName) titleParts.push(`Divisions: ${blackout.divisionName}`);
                          const title = titleParts.length > 0 ? titleParts.join('\n') : 'Blackout (all divisions)';
                          return (
                            <div key={idx} className={styles.blackout} title={title}>
                              {blackout.description || 'Blackout'}
                              {blackout.divisionName && ` (${blackout.divisionName})`}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className={styles.dayEvents}>
                      {getEventsForDate(date).map((event) => (
                        <div
                          key={event.id}
                          className={`${styles.eventItem} ${styles[event.eventType]}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEventClick(event);
                          }}
                          title={formatEventSummary(event)}
                        >
                          {formatTime12Hour(event.startTime)} {event.eventType === 'game' ? '⚾' : event.eventType === 'practice' ? '🏃' : '🏏'}
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const unusedSlots = getUnusedSlotsForDate(dateStr);
                      if (unusedSlots.length === 0) return null;
                      return (
                        <div className={styles.availableSlotsSection}>
                          {unusedSlots.map((slot, idx) => (
                            <div
                              key={`avail-${slot.resourceId}-${idx}`}
                              className={`${styles.availableSlotItem} ${styles[`available${slot.resourceType.charAt(0).toUpperCase() + slot.resourceType.slice(1)}`]}`}
                              title={`${slot.resourceName}: ${formatTimeRange12Hour(slot.startTime, slot.endTime)}`}
                            >
                              <span className={styles.availableSlotTime}>{formatTime12Hour(slot.startTime)}</span>
                              <span className={styles.availableSlotName}>{slot.resourceName}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
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
            const blackouts = getBlackoutsForDate(dateStr);

            return (
              <div key={date.toISOString()} className={`${styles.dayColumn} ${blackouts.length > 0 ? styles.hasBlackout : ''}`}>
                <div
                  className={`${styles.weekDayHeader} ${onEventCreate ? styles.clickable : ''}`}
                  onClick={() => handleDayClick(dateStr)}
                >
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
                  {blackouts.length > 0 && (
                    <div className={styles.weekBlackouts}>
                      {blackouts.map((blackout, idx) => {
                        const titleParts: string[] = [];
                        if (blackout.description) titleParts.push(blackout.description);
                        if (blackout.divisionName) titleParts.push(`Divisions: ${blackout.divisionName}`);
                        const title = titleParts.length > 0 ? titleParts.join('\n') : 'Blackout (all divisions)';
                        return (
                          <div key={idx} className={styles.weekBlackout} title={title}>
                            {blackout.description || 'Blackout'}
                            {blackout.divisionName && ` (${blackout.divisionName})`}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={styles.weekDayBody} style={{ height: totalHeight, position: 'relative' }}>
                  {/* Grid lines for hours */}
                  {timeSlots.map((slot) => (
                    <div key={slot} className={styles.weekTimeSlotLine}></div>
                  ))}
                  {/* Unused slots rendered behind events */}
                  {getUnusedSlotsForDate(dateStr).map((slot, idx) => {
                    const startMinutes = timeToMinutes(slot.startTime);
                    const endMinutes = timeToMinutes(slot.endTime);
                    const startFromBase = startMinutes - START_HOUR * 60;
                    const duration = endMinutes - startMinutes;
                    const top = (startFromBase / 60) * HOUR_HEIGHT;
                    const height = (duration / 60) * HOUR_HEIGHT;

                    return (
                      <div
                        key={`unused-${slot.resourceId}-${idx}`}
                        className={`${styles.unusedSlot} ${styles[`unused${slot.resourceType.charAt(0).toUpperCase() + slot.resourceType.slice(1)}`]}`}
                        title={`${slot.resourceName} available: ${formatTimeRange12Hour(slot.startTime, slot.endTime)}`}
                        style={{
                          position: 'absolute',
                          top: `${top}px`,
                          height: `${Math.max(height, 15)}px`,
                          left: '2px',
                          right: '2px',
                          zIndex: 0,
                        }}
                      >
                        <span className={styles.unusedSlotLabel}>{slot.resourceName}</span>
                      </div>
                    );
                  })}
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
                      <div className={styles.eventTime}>{formatTimeRange12Hour(event.startTime, event.endTime)}</div>
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
            {/* Unused slots rendered behind events */}
            {getUnusedSlotsForDate(dateStr).map((slot, idx) => {
              const startMinutes = timeToMinutes(slot.startTime);
              const endMinutes = timeToMinutes(slot.endTime);
              const startFromBase = startMinutes - START_HOUR * 60;
              const duration = endMinutes - startMinutes;
              const topPos = (startFromBase / 60) * HOUR_HEIGHT;
              const heightVal = (duration / 60) * HOUR_HEIGHT;

              return (
                <div
                  key={`unused-${slot.resourceId}-${idx}`}
                  className={`${styles.unusedSlot} ${styles[`unused${slot.resourceType.charAt(0).toUpperCase() + slot.resourceType.slice(1)}`]}`}
                  title={`${slot.resourceName} available: ${formatTimeRange12Hour(slot.startTime, slot.endTime)}`}
                  style={{
                    position: 'absolute',
                    top: `${topPos}px`,
                    height: `${Math.max(heightVal, 20)}px`,
                    left: '4px',
                    right: '4px',
                    zIndex: 0,
                  }}
                >
                  <span className={styles.unusedSlotLabel}>{slot.resourceName}</span>
                  <span className={styles.unusedSlotTime}>{formatTimeRange12Hour(slot.startTime, slot.endTime)}</span>
                </div>
              );
            })}
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
                  {formatTimeRange12Hour(event.startTime, event.endTime)}
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
              <h3>
                {selectedSwapTarget
                  ? 'Confirm Swap'
                  : isSwapMode
                    ? 'Swap Time Slot'
                    : `Edit ${EVENT_TYPE_LABELS[editingEvent.eventType]}`}
              </h3>
              <button className={styles.closeButton} onClick={closeModal}>
                ×
              </button>
            </div>

            {/* Confirmation Dialog */}
            {selectedSwapTarget ? (
              <div className={styles.swapConfirmation}>
                <p className={styles.swapConfirmText}>
                  You are about to swap time slots between these two events:
                </p>

                <div className={styles.swapPreview}>
                  <div className={styles.swapPreviewEvent}>
                    <div className={styles.swapPreviewLabel}>This event:</div>
                    <div className={styles.swapPreviewDetails}>
                      {editingEvent.eventType === 'game' ? (
                        <>{getTeamName(editingEvent.homeTeamId)} vs {getTeamName(editingEvent.awayTeamId)}</>
                      ) : (
                        <>{getTeamName(editingEvent.teamId)} {EVENT_TYPE_LABELS[editingEvent.eventType]}</>
                      )}
                    </div>
                    <div className={styles.swapPreviewSlot}>
                      <span className={styles.swapSlotOld}>
                        {editingEvent.date} {formatTimeRange12Hour(editingEvent.startTime, editingEvent.endTime)}
                        {editingEvent.fieldId && ` @ ${getFieldName(editingEvent.fieldId)}`}
                        {editingEvent.cageId && ` @ ${getCageName(editingEvent.cageId)}`}
                      </span>
                      <span className={styles.swapArrow}>→</span>
                      <span className={styles.swapSlotNew}>
                        {selectedSwapTarget.date} {formatTimeRange12Hour(selectedSwapTarget.startTime, selectedSwapTarget.endTime)}
                        {selectedSwapTarget.fieldId && ` @ ${getFieldName(selectedSwapTarget.fieldId)}`}
                        {selectedSwapTarget.cageId && ` @ ${getCageName(selectedSwapTarget.cageId)}`}
                      </span>
                    </div>
                  </div>

                  <div className={styles.swapPreviewEvent}>
                    <div className={styles.swapPreviewLabel}>Target event:</div>
                    <div className={styles.swapPreviewDetails}>
                      {selectedSwapTarget.eventType === 'game' ? (
                        <>{getTeamName(selectedSwapTarget.homeTeamId)} vs {getTeamName(selectedSwapTarget.awayTeamId)}</>
                      ) : (
                        <>{getTeamName(selectedSwapTarget.teamId)} {EVENT_TYPE_LABELS[selectedSwapTarget.eventType]}</>
                      )}
                    </div>
                    <div className={styles.swapPreviewSlot}>
                      <span className={styles.swapSlotOld}>
                        {selectedSwapTarget.date} {formatTimeRange12Hour(selectedSwapTarget.startTime, selectedSwapTarget.endTime)}
                        {selectedSwapTarget.fieldId && ` @ ${getFieldName(selectedSwapTarget.fieldId)}`}
                        {selectedSwapTarget.cageId && ` @ ${getCageName(selectedSwapTarget.cageId)}`}
                      </span>
                      <span className={styles.swapArrow}>→</span>
                      <span className={styles.swapSlotNew}>
                        {editingEvent.date} {formatTimeRange12Hour(editingEvent.startTime, editingEvent.endTime)}
                        {editingEvent.fieldId && ` @ ${getFieldName(editingEvent.fieldId)}`}
                        {editingEvent.cageId && ` @ ${getCageName(editingEvent.cageId)}`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Conflict warnings */}
                {(swapConflicts.sourceConflicts.length > 0 || swapConflicts.targetConflicts.length > 0) && (
                  <div className={styles.conflictWarning}>
                    <strong>Warning:</strong> This swap will create conflicts:
                    <ul>
                      {swapConflicts.sourceConflicts.map((conflict) => (
                        <li key={`source-${conflict.id}`}>
                          Source event will conflict with: {getDivisionName(conflict.divisionId)} {EVENT_TYPE_LABELS[conflict.eventType]}
                          {' - '}
                          {formatTimeRange12Hour(conflict.startTime, conflict.endTime)}
                        </li>
                      ))}
                      {swapConflicts.targetConflicts.map((conflict) => (
                        <li key={`target-${conflict.id}`}>
                          Target event will conflict with: {getDivisionName(conflict.divisionId)} {EVENT_TYPE_LABELS[conflict.eventType]}
                          {' - '}
                          {formatTimeRange12Hour(conflict.startTime, conflict.endTime)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.saveButton}
                    onClick={executeSwap}
                    disabled={isSwapping}
                  >
                    {isSwapping ? 'Swapping...' : 'Confirm Swap'}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => setSelectedSwapTarget(null)}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : isSwapMode ? (
              /* Swap Mode - Mini Calendar + Day Detail */
              <div className={styles.swapModeContent}>
                <button
                  type="button"
                  className={styles.backButton}
                  onClick={() => {
                    if (selectedSwapDate) {
                      setSelectedSwapDate(null);
                    } else {
                      setIsSwapMode(false);
                    }
                  }}
                >
                  ← {selectedSwapDate ? 'Back to Calendar' : 'Back to Edit'}
                </button>

                {/* Current event info */}
                <div className={styles.swapSourceEvent}>
                  <div className={styles.swapSourceLabel}>Swapping time slot for:</div>
                  <div className={styles.swapSourceDetails}>
                    <span className={styles.swapSourceTeams}>
                      {editingEvent.eventType === 'game' ? (
                        <>{getTeamName(editingEvent.homeTeamId)} vs {getTeamName(editingEvent.awayTeamId)}</>
                      ) : (
                        <>{getTeamName(editingEvent.teamId)} {EVENT_TYPE_LABELS[editingEvent.eventType]}</>
                      )}
                    </span>
                    <span className={styles.swapSourceMeta}>
                      {editingEvent.date} {formatTimeRange12Hour(editingEvent.startTime, editingEvent.endTime)}
                      {editingEvent.fieldId && ` @ ${getFieldName(editingEvent.fieldId)}`}
                      {editingEvent.cageId && ` @ ${getCageName(editingEvent.cageId)}`}
                      {' · '}{getDivisionName(editingEvent.divisionId)}
                    </span>
                  </div>
                </div>

                <div className={styles.swapFilters}>
                  <label className={styles.filterCheckbox}>
                    <input
                      type="checkbox"
                      checked={swapFilters.sameDivision}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSwapFilters((prev) => ({ ...prev, sameDivision: checked }));
                      }}
                    />
                    Same division
                  </label>
                  <label className={styles.filterCheckbox}>
                    <input
                      type="checkbox"
                      checked={swapFilters.sameEventType}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSwapFilters((prev) => ({ ...prev, sameEventType: checked }));
                      }}
                    />
                    Same event type
                  </label>
                  <span className={styles.candidateCount}>
                    {swapCandidates.length} event{swapCandidates.length !== 1 ? 's' : ''} on {swapCandidatesByDate.size} day{swapCandidatesByDate.size !== 1 ? 's' : ''}
                  </span>
                </div>

                {selectedSwapDate ? (
                  /* Day Detail View */
                  <div className={styles.swapDayDetail}>
                    <div className={styles.swapDayHeader}>
                      {new Date(selectedSwapDate + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                    <div className={styles.swapCandidatesList}>
                      {(swapCandidatesByDate.get(selectedSwapDate) || []).map((candidate) => (
                        <div key={candidate.id} className={styles.swapCandidate}>
                          <div className={styles.candidateInfo}>
                            <div className={styles.candidateDate}>
                              {formatTimeRange12Hour(candidate.startTime, candidate.endTime)}
                            </div>
                            <div className={styles.candidateDetails}>
                              {candidate.eventType === 'game' ? (
                                <>{getTeamName(candidate.homeTeamId)} vs {getTeamName(candidate.awayTeamId)}</>
                              ) : (
                                <>{getTeamName(candidate.teamId)} {EVENT_TYPE_LABELS[candidate.eventType]}</>
                              )}
                            </div>
                            <div className={styles.candidateMeta}>
                              {candidate.fieldId && `@ ${getFieldName(candidate.fieldId)}`}
                              {candidate.cageId && `@ ${getCageName(candidate.cageId)}`}
                              {' - '}
                              {getDivisionName(candidate.divisionId)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={styles.selectButton}
                            onClick={() => setSelectedSwapTarget(candidate)}
                          >
                            Select
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Mini Calendar View */
                  <div className={styles.swapMiniCalendar}>
                    {swapCandidates.length === 0 ? (
                      <div className={styles.noCandidates}>
                        No matching events found. Try unchecking the filters above.
                      </div>
                    ) : (
                      (() => {
                        // Generate weeks for the calendar
                        const weeks: Date[][] = [];
                        const current = new Date(swapCalendarRange.start);
                        // Align to start of week (Sunday)
                        current.setDate(current.getDate() - current.getDay());

                        while (current <= swapCalendarRange.end) {
                          const week: Date[] = [];
                          for (let i = 0; i < 7; i++) {
                            week.push(new Date(current));
                            current.setDate(current.getDate() + 1);
                          }
                          weeks.push(week);
                        }

                        return (
                          <>
                            <div className={styles.miniCalendarHeader}>
                              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                                <div key={d} className={styles.miniCalendarDayHeader}>{d}</div>
                              ))}
                            </div>
                            <div className={styles.miniCalendarBody}>
                              {weeks.map((week, weekIdx) => {
                                // Check if this week starts in a new month compared to previous week
                                const firstDayOfWeek = week[0];
                                const prevWeek = weeks[weekIdx - 1];
                                const showMonthLabel = weekIdx === 0 ||
                                  (prevWeek && prevWeek[0].getMonth() !== firstDayOfWeek.getMonth());

                                return (
                                  <div key={weekIdx}>
                                    {showMonthLabel && (
                                      <div className={styles.miniCalendarMonthLabel}>
                                        {firstDayOfWeek.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                      </div>
                                    )}
                                    <div className={styles.miniCalendarWeek}>
                                      {week.map((date) => {
                                        const dateStr = date.toISOString().split('T')[0];
                                        const candidates = swapCandidatesByDate.get(dateStr) || [];
                                        const isCurrentEventDate = editingEvent?.date === dateStr;
                                        const isToday = date.toDateString() === new Date().toDateString();

                                        return (
                                          <div
                                            key={dateStr}
                                            className={`${styles.miniCalendarDay} ${
                                              candidates.length > 0 ? styles.hasSwapCandidates : ''
                                            } ${isCurrentEventDate ? styles.isCurrentEvent : ''} ${
                                              isToday ? styles.isToday : ''
                                            }`}
                                            onClick={() => {
                                              if (candidates.length > 0) {
                                                setSelectedSwapDate(dateStr);
                                              }
                                            }}
                                          >
                                            <span className={styles.miniDayNumber}>{date.getDate()}</span>
                                            {candidates.length > 0 && (
                                              <span className={styles.miniDayDots}>
                                                {candidates.length <= 3 ? (
                                                  candidates.map((_, i) => (
                                                    <span key={i} className={styles.miniDayDot} />
                                                  ))
                                                ) : (
                                                  <span className={styles.miniDayCount}>{candidates.length}</span>
                                                )}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>
            ) : isDatePickerMode ? (
              /* Date Picker Mode */
              <div className={styles.datePickerMode}>
                <button
                  type="button"
                  className={styles.backButton}
                  onClick={() => {
                    if (selectedDatePickerDate) {
                      setSelectedDatePickerDate(null);
                      setDatePickerTime({ startTime: '', endTime: '' });
                    } else {
                      setIsDatePickerMode(false);
                    }
                  }}
                >
                  ← {selectedDatePickerDate ? 'Back to Calendar' : 'Back to Edit'}
                </button>

                <div className={styles.datePickerInfo}>
                  <div className={styles.datePickerLabel}>Select new date for:</div>
                  <div className={styles.datePickerEvent}>
                    {editingEvent.eventType === 'game' ? (
                      <>{getTeamName(editingEvent.homeTeamId)} vs {getTeamName(editingEvent.awayTeamId)}</>
                    ) : (
                      <>{getTeamName(editingEvent.teamId)} {EVENT_TYPE_LABELS[editingEvent.eventType]}</>
                    )}
                    <span className={styles.datePickerEventMeta}>
                      {' · '}{getDivisionName(editingEvent.divisionId)}
                    </span>
                  </div>
                  <div className={styles.datePickerCurrent}>
                    Current: {new Date((editFormData.date || editingEvent.date) + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })} {formatTimeRange12Hour(
                      editFormData.startTime || editingEvent.startTime,
                      editFormData.endTime || editingEvent.endTime
                    )}
                  </div>
                </div>

                {selectedDatePickerDate ? (
                  /* Day Detail View */
                  <div className={styles.datePickerDayDetail}>
                    <div className={styles.swapDayHeader}>
                      {new Date(selectedDatePickerDate + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>

                    <div className={styles.datePickerTimeSection}>
                      <div className={styles.datePickerTimeLabel}>Select time:</div>
                      <div className={styles.datePickerTimeInputs}>
                        <div className={styles.formGroup}>
                          <label>Start Time</label>
                          <input
                            type="time"
                            value={datePickerTime.startTime || editingEvent.startTime}
                            onChange={(e) =>
                              setDatePickerTime((prev) => ({ ...prev, startTime: e.target.value }))
                            }
                          />
                        </div>
                        <div className={styles.formGroup}>
                          <label>End Time</label>
                          <input
                            type="time"
                            value={datePickerTime.endTime || editingEvent.endTime}
                            onChange={(e) =>
                              setDatePickerTime((prev) => ({ ...prev, endTime: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {/* Conflict warning */}
                    {datePickerConflicts.length > 0 && (
                      <div className={styles.conflictWarning}>
                        <strong>Warning:</strong> This slot conflicts with {datePickerConflicts.length} existing event{datePickerConflicts.length > 1 ? 's' : ''}:
                        <ul>
                          {datePickerConflicts.map((conflict) => (
                            <li key={conflict.id}>
                              {getDivisionName(conflict.divisionId)} {EVENT_TYPE_LABELS[conflict.eventType]}
                              {' - '}
                              {formatTimeRange12Hour(conflict.startTime, conflict.endTime)}
                              {conflict.eventType === 'game' && (
                                <> ({getTeamName(conflict.homeTeamId)} vs {getTeamName(conflict.awayTeamId)})</>
                              )}
                              {conflict.eventType === 'practice' && (
                                <> ({getTeamName(conflict.teamId)})</>
                              )}
                              {conflict.eventType === 'cage' && (
                                <> ({getTeamName(conflict.teamId)})</>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Existing events on this day */}
                    {allEventsOnSelectedDate.length > 0 && (
                      <div className={styles.datePickerExistingEvents}>
                        <div className={styles.datePickerEventsLabel}>
                          Other events on this day ({allEventsOnSelectedDate.length}):
                        </div>
                        <div className={styles.datePickerEventsList}>
                          {allEventsOnSelectedDate.map((event) => (
                            <div key={event.id} className={styles.datePickerEventItem}>
                              <span className={styles.datePickerEventTime}>
                                {formatTimeRange12Hour(event.startTime, event.endTime)}
                              </span>
                              <span className={styles.datePickerEventName}>
                                {event.eventType === 'game' ? (
                                  <>{getTeamName(event.homeTeamId)} vs {getTeamName(event.awayTeamId)}</>
                                ) : (
                                  <>{getTeamName(event.teamId)} {EVENT_TYPE_LABELS[event.eventType]}</>
                                )}
                              </span>
                              <span className={styles.datePickerEventMeta}>
                                {getDivisionName(event.divisionId)}
                                {event.fieldId && ` · ${getFieldName(event.fieldId)}`}
                                {event.cageId && ` · ${getCageName(event.cageId)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={styles.formActions}>
                      <button
                        type="button"
                        className={styles.saveButton}
                        onClick={() => {
                          setEditFormData({
                            ...editFormData,
                            date: selectedDatePickerDate,
                            startTime: datePickerTime.startTime || editingEvent.startTime,
                            endTime: datePickerTime.endTime || editingEvent.endTime,
                          });
                          setSelectedDatePickerDate(null);
                          setDatePickerTime({ startTime: '', endTime: '' });
                          setIsDatePickerMode(false);
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={() => {
                          setSelectedDatePickerDate(null);
                          setDatePickerTime({ startTime: '', endTime: '' });
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Calendar View */
                  <>
                    <div className={styles.swapFilters}>
                      <span className={styles.filterLabel}>Show events:</span>
                      <label className={styles.filterCheckbox}>
                        <input
                          type="checkbox"
                          checked={datePickerFilters.sameDivision}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setDatePickerFilters((prev) => ({ ...prev, sameDivision: checked }));
                          }}
                        />
                        Same division
                      </label>
                      <label className={styles.filterCheckbox}>
                        <input
                          type="checkbox"
                          checked={datePickerFilters.sameEventType}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setDatePickerFilters((prev) => ({ ...prev, sameEventType: checked }));
                          }}
                        />
                        Same event type
                      </label>
                    </div>

                    <div className={styles.swapMiniCalendar}>
                      {(() => {
                        const weeks: Date[][] = [];
                        const current = new Date(swapCalendarRange.start);
                        current.setDate(current.getDate() - current.getDay());

                        while (current <= swapCalendarRange.end) {
                          const week: Date[] = [];
                          for (let i = 0; i < 7; i++) {
                            week.push(new Date(current));
                            current.setDate(current.getDate() + 1);
                          }
                          weeks.push(week);
                        }

                        const selectedDate = editFormData.date || editingEvent.date;

                        return (
                          <>
                            <div className={styles.miniCalendarHeader}>
                              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                                <div key={d} className={styles.miniCalendarDayHeader}>{d}</div>
                              ))}
                            </div>
                            <div className={styles.miniCalendarBody}>
                              {weeks.map((week, weekIdx) => {
                                const firstDayOfWeek = week[0];
                                const prevWeek = weeks[weekIdx - 1];
                                const showMonthLabel = weekIdx === 0 ||
                                  (prevWeek && prevWeek[0].getMonth() !== firstDayOfWeek.getMonth());

                                return (
                                  <div key={weekIdx}>
                                    {showMonthLabel && (
                                      <div className={styles.miniCalendarMonthLabel}>
                                        {firstDayOfWeek.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                      </div>
                                    )}
                                    <div className={styles.miniCalendarWeek}>
                                      {week.map((date) => {
                                        const dateStr = date.toISOString().split('T')[0];
                                        const eventsOnDate = datePickerEventsByDate.get(dateStr) || [];
                                        const isSelected = dateStr === selectedDate;
                                        const isOriginalDate = dateStr === editingEvent.date;
                                        const isToday = date.toDateString() === new Date().toDateString();

                                        return (
                                          <div
                                            key={dateStr}
                                            className={`${styles.miniCalendarDay} ${styles.datePickerDay} ${
                                              isSelected ? styles.isSelectedDate : ''
                                            } ${isOriginalDate ? styles.isOriginalDate : ''} ${
                                              isToday ? styles.isToday : ''
                                            } ${eventsOnDate.length > 0 ? styles.hasEvents : ''}`}
                                            onClick={() => {
                                              setSelectedDatePickerDate(dateStr);
                                              setDatePickerTime({
                                                startTime: editFormData.startTime || editingEvent.startTime,
                                                endTime: editFormData.endTime || editingEvent.endTime,
                                              });
                                            }}
                                          >
                                            <span className={styles.miniDayNumber}>{date.getDate()}</span>
                                            {eventsOnDate.length > 0 && (
                                              <span className={styles.miniDayDots}>
                                                {eventsOnDate.length <= 3 ? (
                                                  eventsOnDate.map((_, i) => (
                                                    <span key={i} className={styles.miniDayDot} />
                                                  ))
                                                ) : (
                                                  <span className={styles.miniDayCount}>{eventsOnDate.length}</span>
                                                )}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Normal Edit Form */
              <form onSubmit={handleUpdate} className={styles.editForm}>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Date</label>
                    <button
                      type="button"
                      className={styles.datePickerButton}
                      onClick={() => setIsDatePickerMode(true)}
                    >
                      {new Date((editFormData.date || editingEvent.date) + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                      <span className={styles.datePickerIcon}>📅</span>
                    </button>
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

                {/* Game time breakdown: arrival vs game start */}
                {editingEvent.eventType === 'game' && (() => {
                  const gameStartTime = getGameStartTime(editingEvent);
                  if (!gameStartTime) return null;
                  const arrivalTime = editFormData.startTime || editingEvent.startTime;
                  return (
                    <div className={styles.formRow}>
                      <div className={styles.formGroup}>
                        <label>Arrival Time</label>
                        <span className={styles.teamDisplay}>
                          {formatTime12Hour(arrivalTime)}
                        </span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>Game Starts</label>
                        <span className={styles.teamDisplay}>
                          {formatTime12Hour(gameStartTime)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

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

                {/* Practice time breakdown: arrival vs practice start */}
                {editingEvent.eventType === 'practice' && (() => {
                  const config = getDivisionConfig(editingEvent.divisionId);
                  const arriveBeforeMinutes = config?.practiceArriveBeforeMinutes || 0;
                  if (arriveBeforeMinutes === 0) return null;

                  // Calculate arrival time from the current form start time
                  const startTime = editFormData.startTime || editingEvent.startTime;
                  const [hours, minutes] = startTime.split(':').map(Number);
                  const totalMinutes = hours * 60 + minutes - arriveBeforeMinutes;
                  const arrivalHours = Math.floor(totalMinutes / 60);
                  const arrivalMinutes = totalMinutes % 60;
                  const arrivalTime24 = `${arrivalHours.toString().padStart(2, '0')}:${arrivalMinutes.toString().padStart(2, '0')}`;

                  return (
                    <div className={styles.formRow}>
                      <div className={styles.formGroup}>
                        <label>Arrival Time</label>
                        <span className={styles.teamDisplay}>
                          {formatTime12Hour(arrivalTime24)}
                        </span>
                      </div>
                      <div className={styles.formGroup}>
                        <label>Practice Starts</label>
                        <span className={styles.teamDisplay}>
                          {formatTime12Hour(startTime)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

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

                {/* Conflict warning */}
                {editConflicts.length > 0 && (
                  <div className={styles.conflictWarning}>
                    <strong>Warning:</strong> This slot conflicts with {editConflicts.length} existing event{editConflicts.length > 1 ? 's' : ''}:
                    <ul>
                      {editConflicts.map((conflict) => (
                        <li key={conflict.id}>
                          {getDivisionName(conflict.divisionId)} {EVENT_TYPE_LABELS[conflict.eventType]}
                          {' - '}
                          {formatTimeRange12Hour(conflict.startTime, conflict.endTime)}
                          {conflict.eventType === 'game' && (
                            <> ({getTeamName(conflict.homeTeamId)} vs {getTeamName(conflict.awayTeamId)})</>
                          )}
                          {conflict.eventType === 'practice' && (
                            <> ({getTeamName(conflict.teamId)})</>
                          )}
                          {conflict.eventType === 'cage' && (
                            <> ({getTeamName(conflict.teamId)})</>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className={styles.formActions}>
                  <button type="submit" className={styles.saveButton}>Save</button>
                  <button
                    type="button"
                    className={styles.swapTimeSlotButton}
                    onClick={() => setIsSwapMode(true)}
                  >
                    ⇄ Swap Time Slot
                  </button>
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
            )}
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {creatingForDate && (
        <div className={styles.modalOverlay} onClick={closeCreateModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Create Event - {new Date(creatingForDate + 'T00:00:00').toLocaleDateString()}</h3>
              <button className={styles.closeButton} onClick={closeCreateModal}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreate} className={styles.editForm}>
              {createError && (
                <div className={styles.formError}>{createError}</div>
              )}

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Event Type *</label>
                  <select
                    value={createFormData.eventType || 'practice'}
                    onChange={(e) =>
                      setCreateFormData({
                        ...createFormData,
                        eventType: e.target.value as EventType,
                        // Reset type-specific fields when changing type
                        fieldId: undefined,
                        cageId: undefined,
                        homeTeamId: undefined,
                        awayTeamId: undefined,
                        teamId: undefined,
                      })
                    }
                  >
                    <option value="practice">Practice</option>
                    <option value="game">Game</option>
                    <option value="cage">Cage Time</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Division *</label>
                  <select
                    value={createFormData.divisionId || ''}
                    onChange={(e) =>
                      setCreateFormData({
                        ...createFormData,
                        divisionId: e.target.value,
                        // Reset team selections when division changes
                        fieldId: undefined,
                        cageId: undefined,
                        homeTeamId: undefined,
                        awayTeamId: undefined,
                        teamId: undefined,
                      })
                    }
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
                  <label>Start Time *</label>
                  <input
                    type="time"
                    value={createFormData.startTime || '09:00'}
                    onChange={(e) =>
                      setCreateFormData({ ...createFormData, startTime: e.target.value })
                    }
                    required
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>End Time *</label>
                  <input
                    type="time"
                    value={createFormData.endTime || '10:00'}
                    onChange={(e) =>
                      setCreateFormData({ ...createFormData, endTime: e.target.value })
                    }
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
                            name="calendarRecurringEndType"
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
                            name="calendarRecurringEndType"
                            checked={recurringEndType === 'date'}
                            onChange={() => setRecurringEndType('date')}
                          />
                          On date
                          <input
                            type="date"
                            value={recurringEndDate}
                            onChange={(e) => setRecurringEndDate(e.target.value)}
                            disabled={recurringEndType !== 'date'}
                            min={creatingForDate || ''}
                            className={styles.endDateInput}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Game-specific fields */}
              {createFormData.eventType === 'game' && createFormData.divisionId && (
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Home Team *</label>
                    <select
                      value={createFormData.homeTeamId || ''}
                      onChange={(e) =>
                        setCreateFormData({ ...createFormData, homeTeamId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Team</option>
                      {teams
                        .filter((t) => t.divisionId === createFormData.divisionId)
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
                      value={createFormData.awayTeamId || ''}
                      onChange={(e) =>
                        setCreateFormData({ ...createFormData, awayTeamId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Team</option>
                      {teams
                        .filter((t) => t.divisionId === createFormData.divisionId)
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
                      value={createFormData.fieldId || ''}
                      onChange={(e) =>
                        setCreateFormData({ ...createFormData, fieldId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Field</option>
                      {seasonFields.map((sf) => (
                        <option key={sf.fieldId} value={sf.fieldId}>
                          {sf.field?.name || sf.fieldId}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Practice-specific fields */}
              {createFormData.eventType === 'practice' && createFormData.divisionId && (
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Team *</label>
                    <select
                      value={createFormData.teamId || ''}
                      onChange={(e) =>
                        setCreateFormData({ ...createFormData, teamId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Team</option>
                      {teams
                        .filter((t) => t.divisionId === createFormData.divisionId)
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
                      value={createFormData.fieldId || ''}
                      onChange={(e) =>
                        setCreateFormData({ ...createFormData, fieldId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Field</option>
                      {seasonFields.map((sf) => (
                        <option key={sf.fieldId} value={sf.fieldId}>
                          {sf.field?.name || sf.fieldId}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Cage-specific fields */}
              {createFormData.eventType === 'cage' && createFormData.divisionId && (
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Team *</label>
                    <select
                      value={createFormData.teamId || ''}
                      onChange={(e) =>
                        setCreateFormData({ ...createFormData, teamId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Team</option>
                      {teams
                        .filter((t) => t.divisionId === createFormData.divisionId)
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
                      value={createFormData.cageId || ''}
                      onChange={(e) =>
                        setCreateFormData({ ...createFormData, cageId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Cage</option>
                      {seasonCages.map((sc) => (
                        <option key={sc.cageId} value={sc.cageId}>
                          {sc.cage?.name || sc.cageId}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className={styles.formActions}>
                <button type="submit" className={styles.saveButton}>Create</button>
                <button type="button" className={styles.cancelButton} onClick={closeCreateModal}>
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
