import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import {
  fetchFields,
  createField,
  updateField,
  deleteField,
  fetchSeasonFields,
  createSeasonField,
  deleteSeasonField,
  fetchFieldAvailabilities,
  createFieldAvailability,
  updateFieldAvailability,
  deleteFieldAvailability,
  fetchFieldDateOverrides,
  createFieldDateOverride,
  updateFieldDateOverride,
  deleteFieldDateOverride,
} from '../api/fields';
import { fetchDivisions } from '../api/divisions';
import type {
  Field,
  CreateFieldInput,
  SeasonField,
  Division,
  FieldAvailability,
  FieldDateOverride,
} from '@ll-scheduler/shared';
import {
  AvailabilityForm,
  AvailabilityList,
  type AvailabilityFormData,
  type AvailabilityDisplayData,
  formatTime12Hour,
} from '../components/AvailabilityForm';
import {
  OverrideForm,
  OverrideList,
  type OverrideFormData,
  type OverrideDisplayData,
} from '../components/OverrideForm';
import styles from './FieldsPage.module.css';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function FieldsPage() {
  const { currentSeason } = useSeason();

  // Global fields
  const [globalFields, setGlobalFields] = useState<Field[]>([]);
  const [isCreatingGlobalField, setIsCreatingGlobalField] = useState(false);
  const [globalFieldFormData, setGlobalFieldFormData] = useState<CreateFieldInput>({ name: '' });

  // Season fields (fields linked to current season)
  const [seasonFields, setSeasonFields] = useState<SeasonField[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);

  // Availability management state
  const [managingSeasonFieldId, setManagingSeasonFieldId] = useState<string | null>(null);
  const [availabilities, setAvailabilities] = useState<Record<string, FieldAvailability[]>>({});
  const [overrides, setOverrides] = useState<Record<string, FieldDateOverride[]>>({});
  const [availabilityFormData, setAvailabilityFormData] = useState<AvailabilityFormData>({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
    singleEventOnly: false,
  });
  const [overrideFormData, setOverrideFormData] = useState<OverrideFormData>({
    date: '',
    overrideType: 'blackout',
    startTime: undefined,
    endTime: undefined,
    reason: '',
    singleEventOnly: false,
  });

  // Edit state
  const [editingAvailabilityId, setEditingAvailabilityId] = useState<string | null>(null);
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);

  useEffect(() => {
    loadGlobalFields();
    loadDivisions();
  }, []);

  useEffect(() => {
    if (currentSeason) {
      loadSeasonFields();
    } else {
      setSeasonFields([]);
    }
  }, [currentSeason]);

  const loadGlobalFields = async () => {
    try {
      const data = await fetchFields();
      setGlobalFields(data);
    } catch (error) {
      console.error('Failed to load global fields:', error);
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

  const loadSeasonFields = async () => {
    if (!currentSeason) return;
    try {
      const data = await fetchSeasonFields(currentSeason.id);
      setSeasonFields(data);
      // Load availabilities and overrides for all season fields
      for (const sf of data) {
        await loadSeasonFieldAvailabilities(sf.id);
        await loadSeasonFieldOverrides(sf.id);
      }
    } catch (error) {
      console.error('Failed to fetch season fields:', error);
    }
  };

  const loadSeasonFieldAvailabilities = async (seasonFieldId: string) => {
    try {
      const data = await fetchFieldAvailabilities(seasonFieldId);
      setAvailabilities((prev) => ({ ...prev, [seasonFieldId]: data }));
    } catch (error) {
      console.error('Failed to fetch field availabilities:', error);
    }
  };

  const loadSeasonFieldOverrides = async (seasonFieldId: string) => {
    try {
      const data = await fetchFieldDateOverrides(seasonFieldId);
      setOverrides((prev) => ({ ...prev, [seasonFieldId]: data }));
    } catch (error) {
      console.error('Failed to fetch field date overrides:', error);
    }
  };

  const handleCreateGlobalField = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createField(globalFieldFormData);
      await loadGlobalFields();
      setIsCreatingGlobalField(false);
      setGlobalFieldFormData({ name: '' });
    } catch (error) {
      console.error('Failed to create field:', error);
      alert('Failed to create field');
    }
  };

  const handleDeleteGlobalField = async (id: string) => {
    if (!confirm('Are you sure you want to delete this field? This will remove it from all seasons.')) {
      return;
    }
    try {
      await deleteField(id);
      await loadGlobalFields();
      if (currentSeason) {
        await loadSeasonFields();
      }
    } catch (error) {
      console.error('Failed to delete field:', error);
      alert('Failed to delete field');
    }
  };

  const handleAddFieldToSeason = async (fieldId: string) => {
    if (!currentSeason) return;
    try {
      await createSeasonField({
        seasonId: currentSeason.id,
        fieldId,
      });
      await loadSeasonFields();
    } catch (error) {
      console.error('Failed to add field to season:', error);
      alert('Failed to add field to season');
    }
  };

  const handleRemoveFieldFromSeason = async (seasonFieldId: string) => {
    if (!confirm('Remove this field from the season? This will delete its availability settings.')) {
      return;
    }
    try {
      await deleteSeasonField(seasonFieldId);
      await loadSeasonFields();
    } catch (error) {
      console.error('Failed to remove field from season:', error);
      alert('Failed to remove field from season');
    }
  };

  const toggleDivisionCompatibility = async (field: Field, divisionId: string) => {
    const current = field.divisionCompatibility || [];
    const updated = current.includes(divisionId)
      ? current.filter((id) => id !== divisionId)
      : [...current, divisionId];
    try {
      await updateField(field.id, { divisionCompatibility: updated });
      await loadGlobalFields();
      // Reload season fields too since they get divisionCompatibility from the global field
      if (currentSeason) {
        await loadSeasonFields();
      }
    } catch (error) {
      console.error('Failed to update division compatibility:', error);
      alert('Failed to update division compatibility');
    }
  };

  const togglePracticeOnly = async (field: Field) => {
    try {
      await updateField(field.id, { practiceOnly: !field.practiceOnly });
      await loadGlobalFields();
      if (currentSeason) {
        await loadSeasonFields();
      }
    } catch (error) {
      console.error('Failed to update practice-only setting:', error);
      alert('Failed to update practice-only setting');
    }
  };

  const handleCreateAvailability = async (seasonFieldId: string) => {
    try {
      await createFieldAvailability({ ...availabilityFormData, seasonFieldId });
      await loadSeasonFieldAvailabilities(seasonFieldId);
      // Keep the same times, just advance to next day for convenience
      setAvailabilityFormData((prev) => ({
        ...prev,
        dayOfWeek: (prev.dayOfWeek + 1) % 7,
      }));
    } catch (error) {
      console.error('Failed to create availability:', error);
      alert('Failed to create availability');
    }
  };

  const handleStartEditAvailability = (avail: AvailabilityDisplayData) => {
    setEditingAvailabilityId(avail.id);
    setAvailabilityFormData({
      dayOfWeek: avail.dayOfWeek,
      startTime: avail.startTime,
      endTime: avail.endTime,
      singleEventOnly: avail.singleEventOnly,
    });
  };

  const handleUpdateAvailability = async (seasonFieldId: string) => {
    if (!editingAvailabilityId) return;
    try {
      await updateFieldAvailability(editingAvailabilityId, availabilityFormData);
      await loadSeasonFieldAvailabilities(seasonFieldId);
      setEditingAvailabilityId(null);
      // Reset form to defaults
      setAvailabilityFormData({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
        singleEventOnly: false,
      });
    } catch (error) {
      console.error('Failed to update availability:', error);
      alert('Failed to update availability');
    }
  };

  const handleCancelEditAvailability = () => {
    setEditingAvailabilityId(null);
    setAvailabilityFormData({
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '17:00',
      singleEventOnly: false,
    });
  };

  const handleDeleteAvailability = async (seasonFieldId: string, availabilityId: string) => {
    try {
      await deleteFieldAvailability(availabilityId);
      await loadSeasonFieldAvailabilities(seasonFieldId);
    } catch (error) {
      console.error('Failed to delete availability:', error);
    }
  };

  const handleCreateOverride = async (seasonFieldId: string) => {
    if (!overrideFormData.date) {
      alert('Please select a date');
      return;
    }
    try {
      await createFieldDateOverride({ ...overrideFormData, seasonFieldId });
      await loadSeasonFieldOverrides(seasonFieldId);
      setOverrideFormData({
        date: '',
        overrideType: 'blackout',
        startTime: undefined,
        endTime: undefined,
        reason: '',
        singleEventOnly: false,
      });
    } catch (error) {
      console.error('Failed to create override:', error);
      alert('Failed to create override');
    }
  };

  const handleStartEditOverride = (override: OverrideDisplayData) => {
    setEditingOverrideId(override.id);
    setOverrideFormData({
      date: override.date,
      overrideType: override.overrideType,
      startTime: override.startTime,
      endTime: override.endTime,
      reason: override.reason || '',
      singleEventOnly: override.singleEventOnly,
    });
  };

  const handleUpdateOverride = async (seasonFieldId: string) => {
    if (!editingOverrideId) return;
    try {
      await updateFieldDateOverride(editingOverrideId, overrideFormData);
      await loadSeasonFieldOverrides(seasonFieldId);
      setEditingOverrideId(null);
      setOverrideFormData({
        date: '',
        overrideType: 'blackout',
        startTime: undefined,
        endTime: undefined,
        reason: '',
        singleEventOnly: false,
      });
    } catch (error) {
      console.error('Failed to update override:', error);
      alert('Failed to update override');
    }
  };

  const handleCancelEditOverride = () => {
    setEditingOverrideId(null);
    setOverrideFormData({
      date: '',
      overrideType: 'blackout',
      startTime: undefined,
      endTime: undefined,
      reason: '',
      singleEventOnly: false,
    });
  };

  const handleDeleteOverride = async (seasonFieldId: string, overrideId: string) => {
    try {
      await deleteFieldDateOverride(overrideId);
      await loadSeasonFieldOverrides(seasonFieldId);
    } catch (error) {
      console.error('Failed to delete override:', error);
    }
  };

  const handleCopyScheduleFrom = async (targetSeasonFieldId: string, sourceSeasonFieldId: string) => {
    const sourceAvailabilities = availabilities[sourceSeasonFieldId] || [];
    const sourceOverrides = overrides[sourceSeasonFieldId] || [];

    try {
      // Copy availabilities
      for (const avail of sourceAvailabilities) {
        await createFieldAvailability({
          seasonFieldId: targetSeasonFieldId,
          dayOfWeek: avail.dayOfWeek,
          startTime: avail.startTime,
          endTime: avail.endTime,
          singleEventOnly: avail.singleEventOnly,
        });
      }

      // Copy overrides
      for (const override of sourceOverrides) {
        await createFieldDateOverride({
          seasonFieldId: targetSeasonFieldId,
          date: override.date,
          overrideType: override.overrideType,
          startTime: override.startTime,
          endTime: override.endTime,
          reason: override.reason,
          singleEventOnly: override.singleEventOnly,
        });
      }

      // Reload the target field's data
      await loadSeasonFieldAvailabilities(targetSeasonFieldId);
      await loadSeasonFieldOverrides(targetSeasonFieldId);
    } catch (error) {
      console.error('Failed to copy schedule:', error);
    }
  };

  // Check which global fields are already added to the current season
  const getFieldsNotInSeason = () => {
    const seasonFieldIds = new Set(seasonFields.map(sf => sf.fieldId));
    return globalFields.filter(f => !seasonFieldIds.has(f.id));
  };

  return (
    <div className={styles.container}>
      {/* Global Fields Section */}
      <section className={styles.section}>
        <div className={styles.header}>
          <h2>Global Fields</h2>
          <button onClick={() => setIsCreatingGlobalField(true)}>Create Field</button>
        </div>
        <p className={styles.sectionDescription}>
          These fields are available to add to any season. Create fields here, then add them to seasons below.
        </p>

        {isCreatingGlobalField && (
          <form onSubmit={handleCreateGlobalField} className={styles.form}>
            <h3>Create New Field</h3>
            <div className={styles.formGroup}>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={globalFieldFormData.name}
                onChange={(e) => setGlobalFieldFormData({ ...globalFieldFormData, name: e.target.value })}
                placeholder="e.g., Field 1"
                required
              />
            </div>
            <div className={styles.formActions}>
              <button type="submit">Create</button>
              <button type="button" onClick={() => setIsCreatingGlobalField(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className={styles.globalFieldList}>
          {globalFields.map((field) => (
            <div key={field.id} className={styles.fieldCard}>
              <div className={styles.fieldHeader}>
                <h3>
                  {field.name}
                  {field.practiceOnly && <span className={styles.practiceOnlyBadge}>Practice Only</span>}
                </h3>
                <button onClick={() => handleDeleteGlobalField(field.id)}>Delete</button>
              </div>
              <div className={styles.fieldDetails}>
                <div className={styles.practiceOnlySection}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={field.practiceOnly || false}
                      onChange={() => togglePracticeOnly(field)}
                    />
                    <span>Practice only (cannot be used for games)</span>
                  </label>
                </div>
                <div className={styles.divisionSection}>
                  <strong>Division Compatibility:</strong>
                  {divisions.length === 0 ? (
                    <p className={styles.noDivisions}>No divisions available.</p>
                  ) : (
                    <div className={styles.divisionCheckboxes}>
                      {divisions.map((division) => (
                        <label key={division.id} className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={field.divisionCompatibility?.includes(division.id) || false}
                            onChange={() => toggleDivisionCompatibility(field, division.id)}
                          />
                          <span>{division.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {globalFields.length === 0 && !isCreatingGlobalField && (
            <p className={styles.empty}>No fields created yet.</p>
          )}
        </div>
      </section>

      {/* Season Fields Section */}
      {currentSeason ? (
        <section className={styles.section}>
          <div className={styles.header}>
            <h2>Fields for {currentSeason.name}</h2>
          </div>

          {/* Add fields to season */}
          {getFieldsNotInSeason().length > 0 && (
            <div className={styles.addFieldsSection}>
              <h4>Add Fields to Season</h4>
              <div className={styles.availableFields}>
                {getFieldsNotInSeason().map((field) => (
                  <button
                    key={field.id}
                    className={styles.addFieldButton}
                    onClick={() => handleAddFieldToSeason(field.id)}
                  >
                    + {field.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Season field cards */}
          <div className={styles.fieldList}>
            {seasonFields.map((seasonField) => {
              const isExpanded = managingSeasonFieldId === seasonField.id;
              return (
                <div
                  key={seasonField.id}
                  className={`${styles.seasonFieldCard} ${isExpanded ? styles.expanded : ''}`}
                >
                  <div className={styles.fieldHeader}>
                    <h3>{seasonField.fieldName}</h3>
                    <div className={styles.fieldActions}>
                      <button
                        onClick={() =>
                          setManagingSeasonFieldId(isExpanded ? null : seasonField.id)
                        }
                      >
                        {isExpanded ? 'Close' : 'Manage Availability'}
                      </button>
                      <button onClick={() => handleRemoveFieldFromSeason(seasonField.id)}>
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className={styles.seasonFieldContent}>
                    {/* Left side: Field summary */}
                    <div className={styles.seasonFieldSummary}>
                      <div className={styles.fieldDetails}>
                        {/* Division Compatibility (read-only, from global field) */}
                        <div className={styles.divisionSection}>
                          <strong>Compatible Divisions:</strong>{' '}
                          {seasonField.divisionCompatibility && seasonField.divisionCompatibility.length > 0 ? (
                            <span className={styles.divisionList}>
                              {seasonField.divisionCompatibility
                                .map((divId) => divisions.find((d) => d.id === divId)?.name)
                                .filter(Boolean)
                                .join(', ') || 'None configured'}
                            </span>
                          ) : (
                            <span className={styles.noDivisions}>All divisions</span>
                          )}
                        </div>

                        {/* Availability summary */}
                        <div>
                          <strong>Weekly Availability:</strong>
                          {availabilities[seasonField.id]?.length > 0 ? (
                            <ul>
                              {availabilities[seasonField.id].map((avail) => (
                                <li key={avail.id}>
                                  {DAYS_OF_WEEK[avail.dayOfWeek]} {formatTime12Hour(avail.startTime)} - {formatTime12Hour(avail.endTime)}
                                  {avail.singleEventOnly && ' (single event)'}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className={styles.noDivisions}>None configured</p>
                          )}
                        </div>

                        {/* Overrides summary */}
                        <div>
                          <strong>Date Overrides:</strong>
                          {overrides[seasonField.id]?.length > 0 ? (
                            <ul>
                              {overrides[seasonField.id].map((override) => (
                                <li key={override.id}>
                                  {override.date} - {override.overrideType === 'blackout' ? 'Blackout' : 'Added'}
                                  {override.startTime && override.endTime && ` (${formatTime12Hour(override.startTime)} - ${formatTime12Hour(override.endTime)})`}
                                  {override.reason && ` - ${override.reason}`}
                                  {override.singleEventOnly && ' (single event)'}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className={styles.noDivisions}>None configured</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right side: Availability management (when expanded) */}
                    {isExpanded && (
                      <div className={styles.seasonFieldManagement}>
                        {/* Copy from another field */}
                        {seasonFields.filter((sf) => sf.id !== seasonField.id && (availabilities[sf.id]?.length > 0 || overrides[sf.id]?.length > 0)).length > 0 && (
                          <div className={styles.copyFromSection}>
                            <label>Copy from:</label>
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleCopyScheduleFrom(seasonField.id, e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            >
                              <option value="">Select a field...</option>
                              {seasonFields
                                .filter((sf) => sf.id !== seasonField.id && (availabilities[sf.id]?.length > 0 || overrides[sf.id]?.length > 0))
                                .map((sf) => (
                                  <option key={sf.id} value={sf.id}>
                                    {sf.fieldName}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}

                        <div className={styles.seasonFieldManagementForms}>
                          <div className={styles.availabilitySection}>
                            <h4>{editingAvailabilityId ? 'Edit' : 'Add'} Weekly Availability</h4>
                            <AvailabilityForm
                              formData={availabilityFormData}
                              onChange={setAvailabilityFormData}
                              onSubmit={() =>
                                editingAvailabilityId
                                  ? handleUpdateAvailability(seasonField.id)
                                  : handleCreateAvailability(seasonField.id)
                              }
                              onCancel={handleCancelEditAvailability}
                              isEditing={!!editingAvailabilityId}
                            />
                            <AvailabilityList
                              items={availabilities[seasonField.id] || []}
                              onEdit={handleStartEditAvailability}
                              onDelete={(id) => handleDeleteAvailability(seasonField.id, id)}
                              editingId={editingAvailabilityId}
                            />
                          </div>

                          <div className={styles.availabilitySection}>
                            <h4>{editingOverrideId ? 'Edit' : 'Add'} Date Override</h4>
                            <OverrideForm
                              formData={overrideFormData}
                              onChange={setOverrideFormData}
                              onSubmit={() =>
                                editingOverrideId
                                  ? handleUpdateOverride(seasonField.id)
                                  : handleCreateOverride(seasonField.id)
                              }
                              onCancel={handleCancelEditOverride}
                              isEditing={!!editingOverrideId}
                            />
                            <OverrideList
                              items={overrides[seasonField.id] || []}
                              onEdit={handleStartEditOverride}
                              onDelete={(id) => handleDeleteOverride(seasonField.id, id)}
                              editingId={editingOverrideId}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {seasonFields.length === 0 && (
              <div className={styles.empty}>
                <p>No fields added to this season yet. Add fields from the list above.</p>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className={styles.section}>
          <p>Select a season to manage which fields are available for that season.</p>
        </section>
      )}
    </div>
  );
}
