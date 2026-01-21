import type {
  GenerateScheduleRequest,
  GenerateScheduleResult,
  ScheduleEvaluationResult,
  ScheduleGenerationLog,
  ScheduleComparisonResult,
} from '@ll-scheduler/shared';
import { API_BASE } from './config';

export async function fetchLatestGenerationLog(
  seasonId: string
): Promise<ScheduleGenerationLog | null> {
  const response = await fetch(`${API_BASE}/schedule-generator/logs/${seasonId}/latest`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Failed to fetch generation log');
  }

  return response.json();
}

export async function fetchGenerationLogs(
  seasonId: string,
  limit: number = 10
): Promise<ScheduleGenerationLog[]> {
  const response = await fetch(`${API_BASE}/schedule-generator/logs/${seasonId}?limit=${limit}`);

  if (!response.ok) {
    throw new Error('Failed to fetch generation logs');
  }

  return response.json();
}

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

export async function evaluateSchedule(
  seasonId: string
): Promise<ScheduleEvaluationResult> {
  const response = await fetch(`${API_BASE}/schedule-generator/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonId }),
  });

  if (!response.ok) {
    throw new Error('Failed to evaluate schedule');
  }

  return response.json();
}

export async function evaluateSavedSchedule(
  savedScheduleId: string
): Promise<ScheduleEvaluationResult> {
  const response = await fetch(`${API_BASE}/schedule-generator/evaluate-saved/${savedScheduleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Failed to evaluate saved schedule');
  }

  return response.json();
}

export async function compareSchedules(
  seasonId: string,
  savedScheduleId: string
): Promise<ScheduleComparisonResult> {
  const response = await fetch(`${API_BASE}/schedule-generator/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonId, savedScheduleId }),
  });

  if (!response.ok) {
    throw new Error('Failed to compare schedules');
  }

  return response.json();
}
