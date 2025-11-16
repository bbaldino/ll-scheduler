/**
 * Field represents a physical location where practices and games can be held
 * Fields are scoped to a specific season
 */
export interface Field {
  id: string;
  seasonId: string;
  name: string;
  location?: string;
  availabilitySchedules: AvailabilitySchedule[];
  divisionCompatibility: string[]; // Array of division IDs
  blackoutDates: BlackoutDate[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Defines when a field is available on a recurring weekly basis
 */
export interface AvailabilitySchedule {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:MM format (24-hour)
  endTime: string; // HH:MM format (24-hour)
}

/**
 * Defines specific dates when a field is not available
 */
export interface BlackoutDate {
  id: string;
  date: string; // ISO date string
  reason?: string;
  allDay: boolean;
  startTime?: string; // HH:MM format (if not all day)
  endTime?: string; // HH:MM format (if not all day)
}

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 6 = Saturday

export interface CreateFieldInput {
  seasonId: string;
  name: string;
  location?: string;
  availabilitySchedules?: AvailabilitySchedule[];
  divisionCompatibility?: string[];
  blackoutDates?: BlackoutDate[];
}

export interface UpdateFieldInput {
  name?: string;
  location?: string;
  availabilitySchedules?: AvailabilitySchedule[];
  divisionCompatibility?: string[];
  blackoutDates?: BlackoutDate[];
}
