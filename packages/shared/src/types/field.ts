/**
 * Field represents a physical location where practices and games can be held.
 * Fields are global resources that can be linked to seasons via SeasonField.
 * Division compatibility is configured globally on the field itself.
 */
export interface Field {
  id: string;
  name: string;
  divisionCompatibility: string[]; // Array of division IDs - which divisions can use this field
  practiceOnly: boolean; // If true, field can only be used for practices, not games
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldInput {
  name: string;
  divisionCompatibility?: string[];
  practiceOnly?: boolean;
}

export interface UpdateFieldInput {
  name?: string;
  divisionCompatibility?: string[];
  practiceOnly?: boolean;
}

/**
 * SeasonField links a field to a season with season-specific configuration.
 * Availability is configured per-season; division compatibility comes from the global Field.
 */
export interface SeasonField {
  id: string;
  seasonId: string;
  fieldId: string;
  createdAt: string;
  updatedAt: string;
  // Populated from joins
  field?: Field;
  fieldName?: string; // Convenience field populated from join
  divisionCompatibility?: string[]; // Populated from joined Field
}

export interface CreateSeasonFieldInput {
  seasonId: string;
  fieldId: string;
}

export interface UpdateSeasonFieldInput {
  // Currently no updatable fields - availability is managed separately
}

/**
 * Field availability is now scoped to a SeasonField
 */
export interface FieldAvailability {
  id: string;
  seasonFieldId: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldAvailabilityInput {
  seasonFieldId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface UpdateFieldAvailabilityInput {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
}

/**
 * Field date overrides are now scoped to a SeasonField
 */
export interface FieldDateOverride {
  id: string;
  seasonFieldId: string;
  date: string; // ISO date (YYYY-MM-DD)
  overrideType: 'blackout' | 'added';
  startTime?: string; // HH:MM format (null for all-day)
  endTime?: string; // HH:MM format (null for all-day)
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldDateOverrideInput {
  seasonFieldId: string;
  date: string;
  overrideType: 'blackout' | 'added';
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface UpdateFieldDateOverrideInput {
  date?: string;
  overrideType?: 'blackout' | 'added';
  startTime?: string;
  endTime?: string;
  reason?: string;
}
