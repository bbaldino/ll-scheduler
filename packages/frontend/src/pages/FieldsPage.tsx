import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import { fetchFields, createField, updateField, deleteField } from '../api/fields';
import { fetchDivisions } from '../api/divisions';
import type { Field, CreateFieldInput, AvailabilitySchedule, BlackoutDate, DayOfWeek, Division } from '@ll-scheduler/shared';
import styles from './FieldsPage.module.css';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export default function FieldsPage() {
  const { currentSeason } = useSeason();
  const [fields, setFields] = useState<Field[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateFieldInput>({
    seasonId: '',
    name: '',
    location: '',
    availabilitySchedules: [],
    divisionCompatibility: [],
    blackoutDates: [],
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
    } catch (error) {
      console.error('Failed to fetch fields:', error);
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
        availabilitySchedules: [],
        divisionCompatibility: [],
        blackoutDates: [],
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

  const addAvailabilitySchedule = () => {
    setFormData({
      ...formData,
      availabilitySchedules: [
        ...(formData.availabilitySchedules || []),
        {
          id: generateId(),
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '17:00',
        },
      ],
    });
  };

  const removeAvailabilitySchedule = (index: number) => {
    const schedules = [...(formData.availabilitySchedules || [])];
    schedules.splice(index, 1);
    setFormData({ ...formData, availabilitySchedules: schedules });
  };

  const updateAvailabilitySchedule = (index: number, updates: Partial<AvailabilitySchedule>) => {
    const schedules = [...(formData.availabilitySchedules || [])];
    schedules[index] = { ...schedules[index], ...updates };
    setFormData({ ...formData, availabilitySchedules: schedules });
  };

  const addBlackoutDate = () => {
    setFormData({
      ...formData,
      blackoutDates: [
        ...(formData.blackoutDates || []),
        {
          id: generateId(),
          date: '',
          allDay: true,
          reason: '',
        },
      ],
    });
  };

  const removeBlackoutDate = (index: number) => {
    const blackouts = [...(formData.blackoutDates || [])];
    blackouts.splice(index, 1);
    setFormData({ ...formData, blackoutDates: blackouts });
  };

  const updateBlackoutDate = (index: number, updates: Partial<BlackoutDate>) => {
    const blackouts = [...(formData.blackoutDates || [])];
    blackouts[index] = { ...blackouts[index], ...updates };
    setFormData({ ...formData, blackoutDates: blackouts });
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
            <div className={styles.sectionHeader}>
              <h4>Availability Schedules</h4>
              <button type="button" onClick={addAvailabilitySchedule}>
                Add Schedule
              </button>
            </div>
            {formData.availabilitySchedules?.map((schedule, index) => (
              <div key={schedule.id} className={styles.scheduleRow}>
                <select
                  value={schedule.dayOfWeek}
                  onChange={(e) =>
                    updateAvailabilitySchedule(index, {
                      dayOfWeek: parseInt(e.target.value) as DayOfWeek,
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
                  value={schedule.startTime}
                  onChange={(e) => updateAvailabilitySchedule(index, { startTime: e.target.value })}
                />
                <span>to</span>
                <input
                  type="time"
                  value={schedule.endTime}
                  onChange={(e) => updateAvailabilitySchedule(index, { endTime: e.target.value })}
                />
                <button type="button" onClick={() => removeAvailabilitySchedule(index)}>
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h4>Blackout Dates</h4>
              <button type="button" onClick={addBlackoutDate}>
                Add Blackout
              </button>
            </div>
            {formData.blackoutDates?.map((blackout, index) => (
              <div key={blackout.id} className={styles.blackoutRow}>
                <input
                  type="date"
                  value={blackout.date}
                  onChange={(e) => updateBlackoutDate(index, { date: e.target.value })}
                  required
                />
                <input
                  type="text"
                  value={blackout.reason || ''}
                  onChange={(e) => updateBlackoutDate(index, { reason: e.target.value })}
                  placeholder="Reason (optional)"
                />
                <button type="button" onClick={() => removeBlackoutDate(index)}>
                  Remove
                </button>
              </div>
            ))}
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
              {field.availabilitySchedules.length > 0 && (
                <div>
                  <strong>Availability:</strong>
                  <ul>
                    {field.availabilitySchedules.map((schedule) => (
                      <li key={schedule.id}>
                        {DAYS_OF_WEEK[schedule.dayOfWeek]} {schedule.startTime} - {schedule.endTime}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {field.blackoutDates.length > 0 && (
                <div>
                  <strong>Blackout Dates:</strong>
                  <ul>
                    {field.blackoutDates.map((blackout) => (
                      <li key={blackout.id}>
                        {blackout.date}
                        {blackout.reason && ` - ${blackout.reason}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
