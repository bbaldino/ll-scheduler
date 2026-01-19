export interface AvailableSlot {
  resourceType: 'field' | 'cage';
  resourceId: string;
  resourceName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface AvailableSlotsResponse {
  fieldSlots: AvailableSlot[];
  cageSlots: AvailableSlot[];
}

export interface AvailableSlotsQuery {
  seasonId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  divisionId?: string;
}
