/**
 * Availability types for fields and batting cages
 * Define recurring weekly schedules and one-off date overrides
 */

// Field Availability - recurring weekly schedule
export interface FieldAvailability {
  id: string;
  fieldId: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startTime: string; // HH:MM format (e.g., "17:00")
  endTime: string; // HH:MM format
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldAvailabilityInput {
  fieldId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface UpdateFieldAvailabilityInput {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
}

// Cage Availability - recurring weekly schedule
export interface CageAvailability {
  id: string;
  cageId: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  createdAt: string;
  updatedAt: string;
}

export interface CreateCageAvailabilityInput {
  cageId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface UpdateCageAvailabilityInput {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
}

// Field Date Override - one-off exceptions to regular schedule
export type OverrideType = 'blackout' | 'added';

export interface FieldDateOverride {
  id: string;
  fieldId: string;
  date: string; // ISO date (YYYY-MM-DD)
  overrideType: OverrideType;
  startTime: string | null; // null for all-day blackout
  endTime: string | null; // null for all-day blackout
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldDateOverrideInput {
  fieldId: string;
  date: string;
  overrideType: OverrideType;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string;
}

export interface UpdateFieldDateOverrideInput {
  date?: string;
  overrideType?: OverrideType;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string;
}

// Cage Date Override - one-off exceptions to regular schedule
export interface CageDateOverride {
  id: string;
  cageId: string;
  date: string; // ISO date (YYYY-MM-DD)
  overrideType: OverrideType;
  startTime: string | null; // null for all-day blackout
  endTime: string | null; // null for all-day blackout
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCageDateOverrideInput {
  cageId: string;
  date: string;
  overrideType: OverrideType;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string;
}

export interface UpdateCageDateOverrideInput {
  date?: string;
  overrideType?: OverrideType;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string;
}
