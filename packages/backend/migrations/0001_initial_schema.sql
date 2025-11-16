-- Create seasons table
CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'regular',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create fields table (season-scoped)
CREATE TABLE fields (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Create field availability schedules
CREATE TABLE field_availability_schedules (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL, -- 0=Sunday, 6=Saturday
  start_time TEXT NOT NULL, -- HH:MM format
  end_time TEXT NOT NULL, -- HH:MM format
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);

-- Create field blackout dates
CREATE TABLE field_blackout_dates (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  date TEXT NOT NULL, -- ISO date
  reason TEXT,
  all_day INTEGER NOT NULL DEFAULT 1, -- boolean: 1=true, 0=false
  start_time TEXT, -- HH:MM format (if not all day)
  end_time TEXT, -- HH:MM format (if not all day)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);

-- Create divisions table (season-scoped)
CREATE TABLE divisions (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  practices_per_week INTEGER NOT NULL,
  practice_duration_hours REAL NOT NULL,
  games_per_week INTEGER,
  game_duration_hours REAL,
  min_consecutive_day_gap INTEGER, -- Minimum days between events for a team
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Create field-division compatibility junction table
CREATE TABLE field_division_compatibility (
  field_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  PRIMARY KEY (field_id, division_id),
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
  FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE
);

-- Create teams table (season-scoped)
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  name TEXT NOT NULL,
  coach_name TEXT,
  coach_email TEXT,
  coach_phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE
);

-- Create practices table (season-scoped)
CREATE TABLE practices (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  date TEXT NOT NULL, -- ISO date
  start_time TEXT NOT NULL, -- HH:MM format
  end_time TEXT NOT NULL, -- HH:MM format
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);

-- Create games table (season-scoped)
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  date TEXT NOT NULL, -- ISO date
  start_time TEXT NOT NULL, -- HH:MM format
  end_time TEXT NOT NULL, -- HH:MM format
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_score INTEGER,
  away_score INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);

-- Create indexes for common queries
CREATE INDEX idx_fields_season_id ON fields(season_id);
CREATE INDEX idx_divisions_season_id ON divisions(season_id);
CREATE INDEX idx_teams_season_id ON teams(season_id);
CREATE INDEX idx_teams_division_id ON teams(division_id);
CREATE INDEX idx_practices_season_id ON practices(season_id);
CREATE INDEX idx_practices_team_id ON practices(team_id);
CREATE INDEX idx_practices_field_id ON practices(field_id);
CREATE INDEX idx_practices_date ON practices(date);
CREATE INDEX idx_games_season_id ON games(season_id);
CREATE INDEX idx_games_field_id ON games(field_id);
CREATE INDEX idx_games_date ON games(date);
CREATE INDEX idx_field_availability_field_id ON field_availability_schedules(field_id);
CREATE INDEX idx_field_blackout_field_id ON field_blackout_dates(field_id);
