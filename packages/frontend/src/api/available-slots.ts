import type { AvailableSlotsResponse, AvailableSlotsQuery } from '@ll-scheduler/shared';
import { API_BASE } from './config';

export async function fetchAvailableSlots(
  query: AvailableSlotsQuery
): Promise<AvailableSlotsResponse> {
  const params = new URLSearchParams();

  params.append('seasonId', query.seasonId);
  params.append('startDate', query.startDate);
  params.append('endDate', query.endDate);
  if (query.divisionId) params.append('divisionId', query.divisionId);

  const url = `${API_BASE}/available-slots?${params.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch available slots');
  }
  return response.json();
}
