/**
 * Field represents a physical location where practices and games can be held
 * Fields are scoped to a specific season
 *
 * Note: Availability schedules and date overrides are managed separately via
 * the FieldAvailability and FieldDateOverride entities.
 */
export interface Field {
  id: string;
  seasonId: string;
  name: string;
  location?: string;
  divisionCompatibility: string[]; // Array of division IDs
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldInput {
  seasonId: string;
  name: string;
  location?: string;
  divisionCompatibility?: string[];
}

export interface UpdateFieldInput {
  name?: string;
  location?: string;
  divisionCompatibility?: string[];
}
