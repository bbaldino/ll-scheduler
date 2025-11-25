/**
 * Availability types for fields and batting cages
 * Define recurring weekly schedules and one-off date overrides
 *
 * Note: These are now scoped to season via SeasonField/SeasonCage
 */

export type OverrideType = 'blackout' | 'added';

// Re-export availability types from field.ts and batting-cage.ts
export type {
  FieldAvailability,
  CreateFieldAvailabilityInput,
  UpdateFieldAvailabilityInput,
  FieldDateOverride,
  CreateFieldDateOverrideInput,
  UpdateFieldDateOverrideInput,
} from './field.js';

export type {
  CageAvailability,
  CreateCageAvailabilityInput,
  UpdateCageAvailabilityInput,
  CageDateOverride,
  CreateCageDateOverrideInput,
  UpdateCageDateOverrideInput,
} from './batting-cage.js';
