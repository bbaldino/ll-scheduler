/**
 * Saved configuration snapshot for a season
 * Captures all settings needed to regenerate a schedule
 */
export interface SavedConfig {
  id: string;
  seasonId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedConfigInput {
  seasonId: string;
  name: string;
  description?: string;
}

export interface UpdateSavedConfigInput {
  name: string;
  description?: string;
}

export interface RestoreConfigResult {
  divisionConfigsRestored: number;
  fieldAvailabilitiesRestored: number;
  cageAvailabilitiesRestored: number;
  fieldDateOverridesRestored: number;
  cageDateOverridesRestored: number;
}
