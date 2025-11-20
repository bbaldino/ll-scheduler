import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { fetchFields, createField, updateField, deleteField } from '../api/fields';
import { fetchDivisions } from '../api/divisions';
import {
  fetchFieldAvailabilities,
  createFieldAvailability,
  updateFieldAvailability,
  deleteFieldAvailability,
} from '../api/field-availabilities';
import {
  fetchFieldDateOverrides,
  createFieldDateOverride,
  updateFieldDateOverride,
  deleteFieldDateOverride,
} from '../api/field-date-overrides';
import type {
  Field,
  CreateFieldInput,
  Division,
  FieldAvailability,
  CreateFieldAvailabilityInput,
  FieldDateOverride,
  CreateFieldDateOverrideInput,
  OverrideType,
} from '@ll-scheduler/shared';
import styles from './FieldsPage.module.css';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function FieldsPage() {
  const { currentSeason } = useSeason();
  const [fields, setFields] = useState<Field[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<CreateFieldInput>({
    seasonId: '',
    name: '',
    location: '',
    divisionCompatibility: [],
  });

  // Availability management state
  const [managingFieldId, setManagingFieldId] = useState<string | null>(null);
  const [availabilities, setAvailabilities] = useState<Record<string, FieldAvailability[]>>({});
  const [overrides, setOverrides] = useState<Record<string, FieldDateOverride[]>>({});
  const [availabilityFormData, setAvailabilityFormData] = useState<Omit<CreateFieldAvailabilityInput, 'fieldId'>>({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
  });
  const [overrideFormData, setOverrideFormData] = useState<Omit<CreateFieldDateOverrideInput, 'fieldId'>>({
    date: '',
    overrideType: 'blackout',
    startTime: null,
    endTime: null,
    reason: '',
  });

  useEffect(() => {
    loadDivisions();
  }, []);

  useEffect(() => {
    if (currentSeason) {
      loadFields();
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

  const loadFields = async () => {
    if (!currentSeason) return;
    try {
      const data = await fetchFields(currentSeason.id);
      setFields(data);
      // Load availabilities and overrides for all fields
      for (const field of data) {
        await loadFieldAvailabilities(field.id);
        await loadFieldOverrides(field.id);
      }
    } catch (error) {
      console.error('Failed to fetch fields:', error);
    }
  };

  const loadFieldAvailabilities = async (fieldId: string) => {
    try {
      const data = await fetchFieldAvailabilities(fieldId);
      setAvailabilities((prev) => ({ ...prev, [fieldId]: data }));
    } catch (error) {
      console.error('Failed to fetch field availabilities:', error);
    }
  };

  const loadFieldOverrides = async (fieldId: string) => {
    try {
      const data = await fetchFieldDateOverrides(fieldId);
      setOverrides((prev) => ({ ...prev, [fieldId]: data }));
    } catch (error) {
      console.error('Failed to fetch field date overrides:', error);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSeason) return;

    try {
      await createField({ ...formData, seasonId: currentSeason.id });
      await loadFields();
      setIsCreating(false);
      setFormData({
        seasonId: '',
        name: '',
        location: '',
        divisionCompatibility: [],
      });
    } catch (error) {
      console.error('Failed to create field:', error);
      alert('Failed to create field');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this field?')) {
      return;
    }
    try {
      await deleteField(id);
      await loadFields();
    } catch (error) {
      console.error('Failed to delete field:', error);
      alert('Failed to delete field');
    }
  };

  const handleCreateAvailability = async (fieldId: string) => {
    try {
      await createFieldAvailability({ ...availabilityFormData, fieldId });
      await loadFieldAvailabilities(fieldId);
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

  const handleDeleteAvailability = async (fieldId: string, availabilityId: string) => {
    if (!confirm('Are you sure you want to delete this availability?')) return;
    try {
      await deleteFieldAvailability(availabilityId);
      await loadFieldAvailabilities(fieldId);
    } catch (error) {
      console.error('Failed to delete availability:', error);
      alert('Failed to delete availability');
    }
  };

  const handleCreateOverride = async (fieldId: string) => {
    if (!overrideFormData.date) {
      alert('Please select a date');
      return;
    }
    try {
      await createFieldDateOverride({ ...overrideFormData, fieldId });
      await loadFieldOverrides(fieldId);
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

  const handleDeleteOverride = async (fieldId: string, overrideId: string) => {
    if (!confirm('Are you sure you want to delete this override?')) return;
    try {
      await deleteFieldDateOverride(overrideId);
      await loadFieldOverrides(fieldId);
    } catch (error) {
      console.error('Failed to delete override:', error);
      alert('Failed to delete override');
    }
  };

  const toggleDivisionCompatibility = (divisionId: string) => {
    const current = formData.divisionCompatibility || [];
    const updated = current.includes(divisionId)
      ? current.filter((id) => id !== divisionId)
      : [...current, divisionId];
    setFormData({ ...formData, divisionCompatibility: updated });
  };

  if (!currentSeason) {
    return (
      <div className={styles.container}>
        <p>Please select a season to manage fields.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Fields - {currentSeason.name}</h2>
        <button onClick={() => setIsCreating(true)}>Create Field</button>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className={styles.form}>
          <h3>Create New Field</h3>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Field 1"
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="location">Location (optional)</label>
            <input
              id="location"
              type="text"
              value={formData.location || ''}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="e.g., 123 Main St"
            />
          </div>

          <div className={styles.section}>
            <h4>Division Compatibility</h4>
            <p className={styles.sectionDescription}>
              Select which divisions can use this field
            </p>
            {divisions.length === 0 ? (
              <p className={styles.noDivisions}>
                No divisions available. Create divisions first in the Divisions page.
              </p>
            ) : (
              <div className={styles.divisionCheckboxes}>
                {divisions.map((division) => (
                  <label key={division.id} className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={formData.divisionCompatibility?.includes(division.id) || false}
                      onChange={() => toggleDivisionCompatibility(division.id)}
                    />
                    <span>{division.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <p className={styles.sectionDescription}>
              After creating the field, you can manage its availability schedule and date overrides.
            </p>
          </div>

          <div className={styles.formActions}>
            <button type="submit">Create</button>
            <button type="button" onClick={() => setIsCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={styles.fieldList}>
        {fields.map((field) => (
          <div key={field.id} className={styles.fieldCard}>
            <div className={styles.fieldHeader}>
              <h3>{field.name}</h3>
              <div className={styles.fieldActions}>
                <button
                  onClick={() => setManagingFieldId(managingFieldId === field.id ? null : field.id)}
                >
                  {managingFieldId === field.id ? 'Close' : 'Manage Availability'}
                </button>
                <button onClick={() => handleDelete(field.id)}>Delete</button>
              </div>
            </div>
            <div className={styles.fieldDetails}>
              {field.location && (
                <p>
                  <strong>Location:</strong> {field.location}
                </p>
              )}
              {field.divisionCompatibility.length > 0 && (
                <p>
                  <strong>Compatible Divisions:</strong>{' '}
                  {field.divisionCompatibility
                    .map((divId) => divisions.find((d) => d.id === divId)?.name || 'Unknown')
                    .join(', ')}
                </p>
              )}

              {availabilities[field.id]?.length > 0 && (
                <div>
                  <strong>Weekly Availability:</strong>
                  <ul>
                    {availabilities[field.id].map((avail) => (
                      <li key={avail.id}>
                        {DAYS_OF_WEEK[avail.dayOfWeek]} {avail.startTime} - {avail.endTime}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {overrides[field.id]?.length > 0 && (
                <div>
                  <strong>Date Overrides:</strong>
                  <ul>
                    {overrides[field.id].map((override) => (
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

            {managingFieldId === field.id && (
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
                    <button type="button" onClick={() => handleCreateAvailability(field.id)}>
                      Add
                    </button>
                  </div>
                  {availabilities[field.id]?.length > 0 && (
                    <div className={styles.availabilityList}>
                      {availabilities[field.id].map((avail) => (
                        <div key={avail.id} className={styles.availabilityItem}>
                          <span>
                            {DAYS_OF_WEEK[avail.dayOfWeek]} {avail.startTime} - {avail.endTime}
                          </span>
                          <button onClick={() => handleDeleteAvailability(field.id, avail.id)}>
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
                    <button type="button" onClick={() => handleCreateOverride(field.id)}>
                      Add
                    </button>
                  </div>
                  {overrides[field.id]?.length > 0 && (
                    <div className={styles.availabilityList}>
                      {overrides[field.id].map((override) => (
                        <div key={override.id} className={styles.availabilityItem}>
                          <span>
                            {override.date} - {override.overrideType === 'blackout' ? 'Blackout' : 'Added'}
                            {override.startTime && ` (${override.startTime} - ${override.endTime})`}
                            {override.reason && ` - ${override.reason}`}
                          </span>
                          <button onClick={() => handleDeleteOverride(field.id, override.id)}>
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {fields.length === 0 && !isCreating && (
        <div className={styles.empty}>
          <p>No fields yet. Create one to get started!</p>
        </div>
      )}
    </div>
  );
}
