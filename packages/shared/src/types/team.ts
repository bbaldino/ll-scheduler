/**
 * Team represents a group of players within a division
 * Teams are scoped to a specific season
 */
export interface Team {
  id: string;
  seasonId: string;
  divisionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamInput {
  seasonId: string;
  divisionId: string;
  name: string;
}

export interface UpdateTeamInput {
  name?: string;
  divisionId?: string;
}
