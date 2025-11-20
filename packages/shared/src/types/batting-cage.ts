/**
 * BattingCage represents a batting cage resource that can be scheduled for team use
 */
export interface BattingCage {
  id: string;
  name: string;
  location: string;
  divisionCompatibility: string[]; // Array of division IDs
  createdAt: string;
  updatedAt: string;
}

export interface CreateBattingCageInput {
  name: string;
  location: string;
  divisionCompatibility?: string[];
}

export interface UpdateBattingCageInput {
  name?: string;
  location?: string;
  divisionCompatibility?: string[];
}
