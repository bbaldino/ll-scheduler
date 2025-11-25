/**
 * BattingCage represents a batting cage resource that can be scheduled for team use.
 * Cages are global resources that can be linked to seasons via SeasonCage.
 * Division compatibility is configured globally on the cage itself.
 */
export interface BattingCage {
  id: string;
  name: string;
  divisionCompatibility: string[]; // Array of division IDs - which divisions can use this cage
  createdAt: string;
  updatedAt: string;
}

export interface CreateBattingCageInput {
  name: string;
  divisionCompatibility?: string[];
}

export interface UpdateBattingCageInput {
  name?: string;
  divisionCompatibility?: string[];
}

/**
 * SeasonCage links a cage to a season with season-specific configuration.
 * Availability is configured per-season; division compatibility comes from the global BattingCage.
 */
export interface SeasonCage {
  id: string;
  seasonId: string;
  cageId: string;
  createdAt: string;
  updatedAt: string;
  // Populated from joins
  cage?: BattingCage;
  cageName?: string; // Convenience field populated from join
  divisionCompatibility?: string[]; // Populated from joined BattingCage
}

export interface CreateSeasonCageInput {
  seasonId: string;
  cageId: string;
}

export interface UpdateSeasonCageInput {
  // Currently no updatable fields - availability is managed separately
}

/**
 * Cage availability is now scoped to a SeasonCage
 */
export interface CageAvailability {
  id: string;
  seasonCageId: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  createdAt: string;
  updatedAt: string;
}

export interface CreateCageAvailabilityInput {
  seasonCageId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface UpdateCageAvailabilityInput {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
}

/**
 * Cage date overrides are now scoped to a SeasonCage
 */
export interface CageDateOverride {
  id: string;
  seasonCageId: string;
  date: string; // ISO date (YYYY-MM-DD)
  overrideType: 'blackout' | 'added';
  startTime?: string; // HH:MM format (null for all-day)
  endTime?: string; // HH:MM format (null for all-day)
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCageDateOverrideInput {
  seasonCageId: string;
  date: string;
  overrideType: 'blackout' | 'added';
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface UpdateCageDateOverrideInput {
  date?: string;
  overrideType?: 'blackout' | 'added';
  startTime?: string;
  endTime?: string;
  reason?: string;
}
