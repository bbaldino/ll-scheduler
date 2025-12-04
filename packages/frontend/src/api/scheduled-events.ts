import type {
  ScheduledEvent,
  CreateScheduledEventInput,
  UpdateScheduledEventInput,
  ScheduledEventQuery,
} from '@ll-scheduler/shared';

const API_BASE = '/api';

export async function fetchScheduledEvents(
  query: ScheduledEventQuery = {}
): Promise<ScheduledEvent[]> {
  const params = new URLSearchParams();

  if (query.seasonId) params.append('seasonId', query.seasonId);
  if (query.divisionId) params.append('divisionId', query.divisionId);
  if (query.teamId) params.append('teamId', query.teamId);
  if (query.fieldId) params.append('fieldId', query.fieldId);
  if (query.cageId) params.append('cageId', query.cageId);
  if (query.eventType) params.append('eventType', query.eventType);
  if (query.status) params.append('status', query.status);
  if (query.startDate) params.append('startDate', query.startDate);
  if (query.endDate) params.append('endDate', query.endDate);

  const queryString = params.toString();
  const url = `${API_BASE}/scheduled-events${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch scheduled events');
  }
  return response.json();
}

export async function fetchScheduledEventById(id: string): Promise<ScheduledEvent> {
  const response = await fetch(`${API_BASE}/scheduled-events/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch scheduled event');
  }
  return response.json();
}

export async function createScheduledEvent(
  input: CreateScheduledEventInput
): Promise<ScheduledEvent> {
  const response = await fetch(`${API_BASE}/scheduled-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create scheduled event');
  }
  return response.json();
}

export async function updateScheduledEvent(
  id: string,
  input: UpdateScheduledEventInput
): Promise<ScheduledEvent> {
  const response = await fetch(`${API_BASE}/scheduled-events/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to update scheduled event');
  }
  return response.json();
}

export async function deleteScheduledEvent(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/scheduled-events/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete scheduled event');
  }
}
