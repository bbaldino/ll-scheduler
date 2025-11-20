import type {
  GenerateScheduleRequest,
  GenerateScheduleResult,
} from '@ll-scheduler/shared';

const API_BASE = 'http://localhost:8787/api';

export async function generateSchedule(
  request: GenerateScheduleRequest
): Promise<GenerateScheduleResult> {
  const response = await fetch(`${API_BASE}/schedule-generator/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to generate schedule');
  }

  return response.json();
}
