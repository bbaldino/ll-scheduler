import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { fetchTeams, createTeam, updateTeam, deleteTeam } from '../api/teams';
import { fetchDivisions } from '../api/divisions';
import type { Team, Division } from '@ll-scheduler/shared';
import styles from './TeamsPage.module.css';

export default function TeamsPage() {
  const { currentSeason } = useSeason();
  const [teams, setTeams] = useState<Team[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>('');
  const [filterDivisionId, setFilterDivisionId] = useState<string>('');
  const [teamNames, setTeamNames] = useState<string[]>(['']);
  const [editFormData, setEditFormData] = useState({
    name: '',
    divisionId: '',
  });

  useEffect(() => {
    loadDivisions();
  }, []);

  useEffect(() => {
    if (currentSeason) {
      loadTeams();
    }
  }, [currentSeason]);

  const loadDivisions = async () => {
    try {
      const data = await fetchDivisions();
      setDivisions(data);
    } catch (error) {
      console.error('Failed to load divisions:', error);
    }
  };

  const loadTeams = async () => {
    if (!currentSeason) return;
    try {
      const data = await fetchTeams(currentSeason.id);
      setTeams(data);
    } catch (error) {
      console.error('Failed to fetch teams:', error);
    }
  };

  const addTeamNameField = () => {
    setTeamNames([...teamNames, '']);
  };

  const removeTeamNameField = (index: number) => {
    const updated = teamNames.filter((_, i) => i !== index);
    setTeamNames(updated.length > 0 ? updated : ['']);
  };

  const updateTeamName = (index: number, value: string) => {
    const updated = [...teamNames];
    updated[index] = value;
    setTeamNames(updated);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSeason || !selectedDivisionId) return;

    // Filter out empty team names
    const validNames = teamNames.filter((name) => name.trim() !== '');

    if (validNames.length === 0) {
      alert('Please enter at least one team name');
      return;
    }

    try {
      // Create all teams
      await Promise.all(
        validNames.map((name) =>
          createTeam({
            seasonId: currentSeason.id,
            divisionId: selectedDivisionId,
            name: name.trim(),
          })
        )
      );

      await loadTeams();
      setIsCreating(false);
      setSelectedDivisionId('');
      setTeamNames(['']);
    } catch (error) {
      console.error('Failed to create teams:', error);
      alert('Failed to create teams');
    }
  };

  const startEditing = (team: Team) => {
    setEditingId(team.id);
    setEditFormData({
      name: team.name,
      divisionId: team.divisionId,
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;

    try {
      await updateTeam(editingId, {
        name: editFormData.name,
        divisionId: editFormData.divisionId,
      });
      await loadTeams();
      setEditingId(null);
      setEditFormData({
        name: '',
        divisionId: '',
      });
    } catch (error) {
      console.error('Failed to update team:', error);
      alert('Failed to update team');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this team?')) {
      return;
    }
    try {
      await deleteTeam(id);
      await loadTeams();
    } catch (error) {
      console.error('Failed to delete team:', error);
      alert('Failed to delete team');
    }
  };

  if (!currentSeason) {
    return (
      <div className={styles.container}>
        <p>Please select a season to manage teams.</p>
      </div>
    );
  }

  const filteredTeams = filterDivisionId
    ? teams.filter((team) => team.divisionId === filterDivisionId)
    : [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Teams - {currentSeason.name}</h2>
        <button onClick={() => setIsCreating(true)}>Create Team</button>
      </div>

      <div className={styles.filterSection}>
        <label htmlFor="filter-division">Filter by Division:</label>
        <select
          id="filter-division"
          value={filterDivisionId}
          onChange={(e) => setFilterDivisionId(e.target.value)}
        >
          <option value="">Select a division to view teams</option>
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name}
            </option>
          ))}
        </select>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className={styles.form}>
          <h3>Create Teams for Division</h3>
          <div className={styles.formGroup}>
            <label htmlFor="division">Division</label>
            <select
              id="division"
              value={selectedDivisionId}
              onChange={(e) => setSelectedDivisionId(e.target.value)}
              required
            >
              <option value="">Select a division</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <div className={styles.teamNamesHeader}>
              <label>Team Names</label>
              <button type="button" onClick={addTeamNameField} className={styles.addButton}>
                + Add Another Team
              </button>
            </div>
            {teamNames.map((name, index) => (
              <div key={index} className={styles.teamNameRow}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => updateTeamName(index, e.target.value)}
                  placeholder={`Team ${index + 1} name (e.g., Red Sox)`}
                />
                {teamNames.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTeamNameField(index)}
                    className={styles.removeButton}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className={styles.formActions}>
            <button type="submit">Create Teams</button>
            <button type="button" onClick={() => {
              setIsCreating(false);
              setSelectedDivisionId('');
              setTeamNames(['']);
            }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={styles.teamList}>
        {filteredTeams.map((team) => (
          <div key={team.id} className={styles.teamCard}>
            {editingId === team.id ? (
              <form onSubmit={handleUpdate} className={styles.editForm}>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label htmlFor="edit-name">Team Name</label>
                    <input
                      id="edit-name"
                      type="text"
                      value={editFormData.name}
                      onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label htmlFor="edit-division">Division</label>
                    <select
                      id="edit-division"
                      value={editFormData.divisionId}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, divisionId: e.target.value })
                      }
                      required
                    >
                      {divisions.map((division) => (
                        <option key={division.id} value={division.id}>
                          {division.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className={styles.teamHeader}>
                  <h3>{team.name}</h3>
                  <div className={styles.teamActions}>
                    <button onClick={() => startEditing(team)}>Edit</button>
                    <button onClick={() => handleDelete(team.id)}>Delete</button>
                  </div>
                </div>
                <div className={styles.teamDetails}>
                  <p>
                    <strong>Division:</strong>{' '}
                    {divisions.find((d) => d.id === team.divisionId)?.name || 'Unknown'}
                  </p>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {!filterDivisionId && !isCreating && (
        <div className={styles.empty}>
          <p>Select a division to view its teams.</p>
        </div>
      )}

      {filterDivisionId && filteredTeams.length === 0 && !isCreating && (
        <div className={styles.empty}>
          <p>No teams in this division yet. Create one to get started!</p>
        </div>
      )}
    </div>
  );
}
