-- Remove location column from fields table
ALTER TABLE fields DROP COLUMN location;

-- Remove location column from batting_cages table
ALTER TABLE batting_cages DROP COLUMN location;
