import { useState, useEffect } from 'react';
import { fetchDivisions } from '../api/divisions';
import {
  fetchBattingCages,
  createBattingCage,
  updateBattingCage,
  deleteBattingCage,
} from '../api/batting-cages';
import {
  fetchCageAvailabilities,
  createCageAvailability,
  deleteCageAvailability,
} from '../api/cage-availabilities';
import {
  fetchCageDateOverrides,
  createCageDateOverride,
  deleteCageDateOverride,
} from '../api/cage-date-overrides';
import type {
  BattingCage,
  CreateBattingCageInput,
  Division,
  CageAvailability,
  CreateCageAvailabilityInput,
  CageDateOverride,
  CreateCageDateOverrideInput,
  OverrideType,
} from '@ll-scheduler/shared';
import styles from './BattingCagesPage.module.css';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function BattingCagesPage() {
  const [cages, setCages] = useState<BattingCage[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateBattingCageInput>({
    name: '',
    location: '',
    divisionCompatibility: [],
  });
  const [editFormData, setEditFormData] = useState<CreateBattingCageInput>({
    name: '',
    location: '',
    divisionCompatibility: [],
  });

  // Availability management state
  const [managingCageId, setManagingCageId] = useState<string | null>(null);
  const [availabilities, setAvailabilities] = useState<Record<string, CageAvailability[]>>({});
  const [overrides, setOverrides] = useState<Record<string, CageDateOverride[]>>({});
  const [availabilityFormData, setAvailabilityFormData] = useState<Omit<CreateCageAvailabilityInput, 'cageId'>>({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
  });
  const [overrideFormData, setOverrideFormData] = useState<Omit<CreateCageDateOverrideInput, 'cageId'>>({
    date: '',
    overrideType: 'blackout',
    startTime: null,
    endTime: null,
    reason: '',
  });

  useEffect(() => {
    loadCages();
    loadDivisions();
  }, []);

  const loadCages = async () => {
    try {
      const data = await fetchBattingCages();
      setCages(data);
      // Load availabilities and overrides for all cages
      for (const cage of data) {
        await loadCageAvailabilities(cage.id);
        await loadCageOverrides(cage.id);
      }
    } catch (error) {
      console.error('Failed to fetch batting cages:', error);
    }
  };

  const loadDivisions = async () => {
    try {
      const data = await fetchDivisions();
      setDivisions(data);
    } catch (error) {
      console.error('Failed to load divisions:', error);
    }
  };

  const loadCageAvailabilities = async (cageId: string) => {
    try {
      const data = await fetchCageAvailabilities(cageId);
      setAvailabilities((prev) => ({ ...prev, [cageId]: data }));
    } catch (error) {
      console.error('Failed to fetch cage availabilities:', error);
    }
  };

  const loadCageOverrides = async (cageId: string) => {
    try {
      const data = await fetchCageDateOverrides(cageId);
      setOverrides((prev) => ({ ...prev, [cageId]: data }));
    } catch (error) {
      console.error('Failed to fetch cage date overrides:', error);
    }
  };

  const toggleDivisionCompatibility = (divisionId: string, isEditing: boolean = false) => {
    const data = isEditing ? editFormData : formData;
    const setData = isEditing ? setEditFormData : setFormData;
    const current = data.divisionCompatibility || [];
    const updated = current.includes(divisionId)
      ? current.filter((id) => id !== divisionId)
      : [...current, divisionId];
    setData({ ...data, divisionCompatibility: updated });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createBattingCage(formData);
      await loadCages();
      setIsCreating(false);
      setFormData({ name: '', location: '', divisionCompatibility: [] });
    } catch (error) {
      console.error('Failed to create batting cage:', error);
      alert('Failed to create batting cage');
    }
  };

  const startEditing = (cage: BattingCage) => {
    setEditingId(cage.id);
    setEditFormData({
      name: cage.name,
      location: cage.location,
      divisionCompatibility: cage.divisionCompatibility,
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;

    try {
      await updateBattingCage(editingId, editFormData);
      await loadCages();
      setEditingId(null);
      setEditFormData({ name: '', location: '', divisionCompatibility: [] });
    } catch (error) {
      console.error('Failed to update batting cage:', error);
      alert('Failed to update batting cage');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this batting cage?')) {
      return;
    }
    try {
      await deleteBattingCage(id);
      await loadCages();
    } catch (error) {
      console.error('Failed to delete batting cage:', error);
      alert('Failed to delete batting cage');
    }
  };

  const handleCreateAvailability = async (cageId: string) => {
    try {
      await createCageAvailability({ ...availabilityFormData, cageId });
      await loadCageAvailabilities(cageId);
      setAvailabilityFormData({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
      });
    } catch (error) {
      console.error('Failed to create availability:', error);
      alert('Failed to create availability');
    }
  };

  const handleDeleteAvailability = async (cageId: string, availabilityId: string) => {
    if (!confirm('Are you sure you want to delete this availability?')) return;
    try {
      await deleteCageAvailability(availabilityId);
      await loadCageAvailabilities(cageId);
    } catch (error) {
      console.error('Failed to delete availability:', error);
      alert('Failed to delete availability');
    }
  };

  const handleCreateOverride = async (cageId: string) => {
    if (!overrideFormData.date) {
      alert('Please select a date');
      return;
    }
    try {
      await createCageDateOverride({ ...overrideFormData, cageId });
      await loadCageOverrides(cageId);
      setOverrideFormData({
        date: '',
        overrideType: 'blackout',
        startTime: null,
        endTime: null,
        reason: '',
      });
    } catch (error) {
      console.error('Failed to create override:', error);
      alert('Failed to create override');
    }
  };

  const handleDeleteOverride = async (cageId: string, overrideId: string) => {
    if (!confirm('Are you sure you want to delete this override?')) return;
    try {
      await deleteCageDateOverride(overrideId);
      await loadCageOverrides(cageId);
    } catch (error) {
      console.error('Failed to delete override:', error);
      alert('Failed to delete override');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Batting Cages</h2>
        <button onClick={() => setIsCreating(true)}>Create Batting Cage</button>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className={styles.form}>
          <h3>Create New Batting Cage</h3>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Main Cage, South Cage"
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="location">Location</label>
            <input
              id="location"
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="e.g., Behind Field 1, North Complex"
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label>Division Compatibility</label>
            <div className={styles.checkboxGroup}>
              {divisions.map((division) => (
                <label key={division.id} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={formData.divisionCompatibility?.includes(division.id)}
                    onChange={() => toggleDivisionCompatibility(division.id, false)}
                  />
                  {division.name}
                </label>
              ))}
            </div>
          </div>
          <div className={styles.formActions}>
            <button type="submit">Create</button>
            <button type="button" onClick={() => setIsCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={styles.cageList}>
        {cages.map((cage) => (
          <div key={cage.id} className={styles.cageCard}>
            {editingId === cage.id ? (
              <form onSubmit={handleUpdate} className={styles.editForm}>
                <div className={styles.formGroup}>
                  <label htmlFor="edit-name">Name</label>
                  <input
                    id="edit-name"
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    required
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="edit-location">Location</label>
                  <input
                    id="edit-location"
                    type="text"
                    value={editFormData.location}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, location: e.target.value })
                    }
                    required
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Division Compatibility</label>
                  <div className={styles.checkboxGroup}>
                    {divisions.map((division) => (
                      <label key={division.id} className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={editFormData.divisionCompatibility?.includes(division.id)}
                          onChange={() => toggleDivisionCompatibility(division.id, true)}
                        />
                        {division.name}
                      </label>
                    ))}
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
                <div className={styles.cageHeader}>
                  <h3>{cage.name}</h3>
                  <div className={styles.cageActions}>
                    <button
                      onClick={() => setManagingCageId(managingCageId === cage.id ? null : cage.id)}
                    >
                      {managingCageId === cage.id ? 'Close' : 'Manage Availability'}
                    </button>
                    <button onClick={() => startEditing(cage)}>Edit</button>
                    <button onClick={() => handleDelete(cage.id)}>Delete</button>
                  </div>
                </div>
                <div className={styles.cageDetails}>
                  <p>
                    <strong>Location:</strong> {cage.location}
                  </p>
                  {cage.divisionCompatibility.length > 0 && (
                    <p>
                      <strong>Compatible Divisions:</strong>{' '}
                      {cage.divisionCompatibility
                        .map((id) => divisions.find((d) => d.id === id)?.name || 'Unknown')
                        .join(', ')}
                    </p>
                  )}
                  {cage.divisionCompatibility.length === 0 && (
                    <p>
                      <strong>Compatible Divisions:</strong> <em>None configured</em>
                    </p>
                  )}

                  {availabilities[cage.id]?.length > 0 && (
                    <div>
                      <strong>Weekly Availability:</strong>
                      <ul>
                        {availabilities[cage.id].map((avail) => (
                          <li key={avail.id}>
                            {DAYS_OF_WEEK[avail.dayOfWeek]} {avail.startTime} - {avail.endTime}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {overrides[cage.id]?.length > 0 && (
                    <div>
                      <strong>Date Overrides:</strong>
                      <ul>
                        {overrides[cage.id].map((override) => (
                          <li key={override.id}>
                            {override.date} - {override.overrideType === 'blackout' ? 'Blackout' : 'Added'}
                            {override.startTime && ` (${override.startTime} - ${override.endTime})`}
                            {override.reason && ` - ${override.reason}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {managingCageId === cage.id && (
                  <div className={styles.availabilityManagement}>
                    <div className={styles.availabilitySection}>
                      <h4>Weekly Availability</h4>
                      <div className={styles.availabilityForm}>
                        <select
                          value={availabilityFormData.dayOfWeek}
                          onChange={(e) =>
                            setAvailabilityFormData({
                              ...availabilityFormData,
                              dayOfWeek: parseInt(e.target.value) as number,
                            })
                          }
                        >
                          {DAYS_OF_WEEK.map((day, i) => (
                            <option key={i} value={i}>
                              {day}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={availabilityFormData.startTime}
                          onChange={(e) =>
                            setAvailabilityFormData({ ...availabilityFormData, startTime: e.target.value })
                          }
                        />
                        <span>to</span>
                        <input
                          type="time"
                          value={availabilityFormData.endTime}
                          onChange={(e) =>
                            setAvailabilityFormData({ ...availabilityFormData, endTime: e.target.value })
                          }
                        />
                        <button type="button" onClick={() => handleCreateAvailability(cage.id)}>
                          Add
                        </button>
                      </div>
                      {availabilities[cage.id]?.length > 0 && (
                        <div className={styles.availabilityList}>
                          {availabilities[cage.id].map((avail) => (
                            <div key={avail.id} className={styles.availabilityItem}>
                              <span>
                                {DAYS_OF_WEEK[avail.dayOfWeek]} {avail.startTime} - {avail.endTime}
                              </span>
                              <button onClick={() => handleDeleteAvailability(cage.id, avail.id)}>
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className={styles.availabilitySection}>
                      <h4>Date Overrides</h4>
                      <div className={styles.overrideForm}>
                        <input
                          type="date"
                          value={overrideFormData.date}
                          onChange={(e) =>
                            setOverrideFormData({ ...overrideFormData, date: e.target.value })
                          }
                        />
                        <select
                          value={overrideFormData.overrideType}
                          onChange={(e) =>
                            setOverrideFormData({
                              ...overrideFormData,
                              overrideType: e.target.value as OverrideType,
                            })
                          }
                        >
                          <option value="blackout">Blackout</option>
                          <option value="added">Added</option>
                        </select>
                        <input
                          type="time"
                          value={overrideFormData.startTime || ''}
                          onChange={(e) =>
                            setOverrideFormData({
                              ...overrideFormData,
                              startTime: e.target.value || null,
                            })
                          }
                          placeholder="Start (optional)"
                        />
                        <input
                          type="time"
                          value={overrideFormData.endTime || ''}
                          onChange={(e) =>
                            setOverrideFormData({ ...overrideFormData, endTime: e.target.value || null })
                          }
                          placeholder="End (optional)"
                        />
                        <input
                          type="text"
                          value={overrideFormData.reason || ''}
                          onChange={(e) =>
                            setOverrideFormData({ ...overrideFormData, reason: e.target.value })
                          }
                          placeholder="Reason (optional)"
                        />
                        <button type="button" onClick={() => handleCreateOverride(cage.id)}>
                          Add
                        </button>
                      </div>
                      {overrides[cage.id]?.length > 0 && (
                        <div className={styles.availabilityList}>
                          {overrides[cage.id].map((override) => (
                            <div key={override.id} className={styles.availabilityItem}>
                              <span>
                                {override.date} - {override.overrideType === 'blackout' ? 'Blackout' : 'Added'}
                                {override.startTime && ` (${override.startTime} - ${override.endTime})`}
                                {override.reason && ` - ${override.reason}`}
                              </span>
                              <button onClick={() => handleDeleteOverride(cage.id, override.id)}>
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {cages.length === 0 && !isCreating && (
        <div className={styles.empty}>
          <p>No batting cages yet. Create one to get started!</p>
        </div>
      )}
    </div>
  );
}
