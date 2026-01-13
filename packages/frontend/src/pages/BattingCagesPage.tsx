import { useState, useEffect } from 'react';
import { useSeason } from '../contexts/SeasonContext';
import {
  fetchBattingCages,
  createBattingCage,
  updateBattingCage,
  deleteBattingCage,
  fetchSeasonCages,
  createSeasonCage,
  deleteSeasonCage,
  fetchCageAvailabilities,
  createCageAvailability,
  updateCageAvailability,
  deleteCageAvailability,
  fetchCageDateOverrides,
  createCageDateOverride,
  updateCageDateOverride,
  deleteCageDateOverride,
} from '../api/batting-cages';
import { fetchDivisions } from '../api/divisions';
import type {
  BattingCage,
  CreateBattingCageInput,
  SeasonCage,
  Division,
  CageAvailability,
  CageDateOverride,
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
import styles from './BattingCagesPage.module.css';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function BattingCagesPage() {
  const { currentSeason } = useSeason();

  // Global cages
  const [globalCages, setGlobalCages] = useState<BattingCage[]>([]);
  const [isCreatingGlobalCage, setIsCreatingGlobalCage] = useState(false);
  const [globalCageFormData, setGlobalCageFormData] = useState<CreateBattingCageInput>({ name: '' });

  // Season cages (cages linked to current season)
  const [seasonCages, setSeasonCages] = useState<SeasonCage[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);

  // Availability management state
  const [managingSeasonCageId, setManagingSeasonCageId] = useState<string | null>(null);
  const [availabilities, setAvailabilities] = useState<Record<string, CageAvailability[]>>({});
  const [overrides, setOverrides] = useState<Record<string, CageDateOverride[]>>({});
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
    loadGlobalCages();
    loadDivisions();
  }, []);

  useEffect(() => {
    if (currentSeason) {
      loadSeasonCages();
    } else {
      setSeasonCages([]);
    }
  }, [currentSeason]);

  const loadGlobalCages = async () => {
    try {
      const data = await fetchBattingCages();
      setGlobalCages(data);
    } catch (error) {
      console.error('Failed to load global cages:', error);
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

  const loadSeasonCages = async () => {
    if (!currentSeason) return;
    try {
      const data = await fetchSeasonCages(currentSeason.id);
      setSeasonCages(data);
      // Load availabilities and overrides for all season cages
      for (const sc of data) {
        await loadSeasonCageAvailabilities(sc.id);
        await loadSeasonCageOverrides(sc.id);
      }
    } catch (error) {
      console.error('Failed to fetch season cages:', error);
    }
  };

  const loadSeasonCageAvailabilities = async (seasonCageId: string) => {
    try {
      const data = await fetchCageAvailabilities(seasonCageId);
      setAvailabilities((prev) => ({ ...prev, [seasonCageId]: data }));
    } catch (error) {
      console.error('Failed to fetch cage availabilities:', error);
    }
  };

  const loadSeasonCageOverrides = async (seasonCageId: string) => {
    try {
      const data = await fetchCageDateOverrides(seasonCageId);
      setOverrides((prev) => ({ ...prev, [seasonCageId]: data }));
    } catch (error) {
      console.error('Failed to fetch cage date overrides:', error);
    }
  };

  const handleCreateGlobalCage = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createBattingCage(globalCageFormData);
      await loadGlobalCages();
      setIsCreatingGlobalCage(false);
      setGlobalCageFormData({ name: '' });
    } catch (error) {
      console.error('Failed to create cage:', error);
      alert('Failed to create cage');
    }
  };

  const handleDeleteGlobalCage = async (id: string) => {
    if (!confirm('Are you sure you want to delete this cage? This will remove it from all seasons.')) {
      return;
    }
    try {
      await deleteBattingCage(id);
      await loadGlobalCages();
      if (currentSeason) {
        await loadSeasonCages();
      }
    } catch (error) {
      console.error('Failed to delete cage:', error);
      alert('Failed to delete cage');
    }
  };

  const handleAddCageToSeason = async (cageId: string) => {
    if (!currentSeason) return;
    try {
      await createSeasonCage({
        seasonId: currentSeason.id,
        cageId,
      });
      await loadSeasonCages();
    } catch (error) {
      console.error('Failed to add cage to season:', error);
      alert('Failed to add cage to season');
    }
  };

  const handleRemoveCageFromSeason = async (seasonCageId: string) => {
    if (!confirm('Remove this cage from the season? This will delete its availability settings.')) {
      return;
    }
    try {
      await deleteSeasonCage(seasonCageId);
      await loadSeasonCages();
    } catch (error) {
      console.error('Failed to remove cage from season:', error);
      alert('Failed to remove cage from season');
    }
  };

  const toggleDivisionCompatibility = async (cage: BattingCage, divisionId: string) => {
    const current = cage.divisionCompatibility || [];
    const updated = current.includes(divisionId)
      ? current.filter((id) => id !== divisionId)
      : [...current, divisionId];
    try {
      await updateBattingCage(cage.id, { divisionCompatibility: updated });
      await loadGlobalCages();
      // Reload season cages too since they get divisionCompatibility from the global cage
      if (currentSeason) {
        await loadSeasonCages();
      }
    } catch (error) {
      console.error('Failed to update division compatibility:', error);
      alert('Failed to update division compatibility');
    }
  };

  const handleCreateAvailability = async (seasonCageId: string) => {
    try {
      await createCageAvailability({ ...availabilityFormData, seasonCageId });
      await loadSeasonCageAvailabilities(seasonCageId);
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

  const handleUpdateAvailability = async (seasonCageId: string) => {
    if (!editingAvailabilityId) return;
    try {
      await updateCageAvailability(editingAvailabilityId, availabilityFormData);
      await loadSeasonCageAvailabilities(seasonCageId);
      setEditingAvailabilityId(null);
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

  const handleDeleteAvailability = async (seasonCageId: string, availabilityId: string) => {
    try {
      await deleteCageAvailability(availabilityId);
      await loadSeasonCageAvailabilities(seasonCageId);
    } catch (error) {
      console.error('Failed to delete availability:', error);
    }
  };

  const handleCreateOverride = async (seasonCageId: string) => {
    if (!overrideFormData.date) {
      alert('Please select a date');
      return;
    }
    try {
      await createCageDateOverride({ ...overrideFormData, seasonCageId });
      await loadSeasonCageOverrides(seasonCageId);
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

  const handleUpdateOverride = async (seasonCageId: string) => {
    if (!editingOverrideId) return;
    try {
      await updateCageDateOverride(editingOverrideId, overrideFormData);
      await loadSeasonCageOverrides(seasonCageId);
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

  const handleDeleteOverride = async (seasonCageId: string, overrideId: string) => {
    try {
      await deleteCageDateOverride(overrideId);
      await loadSeasonCageOverrides(seasonCageId);
    } catch (error) {
      console.error('Failed to delete override:', error);
    }
  };

  const handleCopyScheduleFrom = async (targetSeasonCageId: string, sourceSeasonCageId: string) => {
    const sourceAvailabilities = availabilities[sourceSeasonCageId] || [];
    const sourceOverrides = overrides[sourceSeasonCageId] || [];

    try {
      // Copy availabilities
      for (const avail of sourceAvailabilities) {
        await createCageAvailability({
          seasonCageId: targetSeasonCageId,
          dayOfWeek: avail.dayOfWeek,
          startTime: avail.startTime,
          endTime: avail.endTime,
          singleEventOnly: avail.singleEventOnly,
        });
      }

      // Copy overrides
      for (const override of sourceOverrides) {
        await createCageDateOverride({
          seasonCageId: targetSeasonCageId,
          date: override.date,
          overrideType: override.overrideType,
          startTime: override.startTime,
          endTime: override.endTime,
          reason: override.reason,
          singleEventOnly: override.singleEventOnly,
        });
      }

      // Reload data for target cage
      await loadSeasonCageAvailabilities(targetSeasonCageId);
      await loadSeasonCageOverrides(targetSeasonCageId);
    } catch (error) {
      console.error('Failed to copy schedule:', error);
    }
  };

  // Check which global cages are already added to the current season
  const getCagesNotInSeason = () => {
    const seasonCageIds = new Set(seasonCages.map(sc => sc.cageId));
    return globalCages.filter(c => !seasonCageIds.has(c.id));
  };

  return (
    <div className={styles.container}>
      {/* Global Cages Section */}
      <section className={styles.section}>
        <div className={styles.header}>
          <h2>Global Batting Cages</h2>
          <button onClick={() => setIsCreatingGlobalCage(true)}>Create Cage</button>
        </div>
        <p className={styles.sectionDescription}>
          These cages are available to add to any season. Create cages here, then add them to seasons below.
        </p>

        {isCreatingGlobalCage && (
          <form onSubmit={handleCreateGlobalCage} className={styles.form}>
            <h3>Create New Batting Cage</h3>
            <div className={styles.formGroup}>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={globalCageFormData.name}
                onChange={(e) => setGlobalCageFormData({ ...globalCageFormData, name: e.target.value })}
                placeholder="e.g., Main Cage, South Cage"
                required
              />
            </div>
            <div className={styles.formActions}>
              <button type="submit">Create</button>
              <button type="button" onClick={() => setIsCreatingGlobalCage(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className={styles.globalCageList}>
          {globalCages.map((cage) => (
            <div key={cage.id} className={styles.cageCard}>
              <div className={styles.cageHeader}>
                <h3>{cage.name}</h3>
                <button onClick={() => handleDeleteGlobalCage(cage.id)}>Delete</button>
              </div>
              <div className={styles.cageDetails}>
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
                            checked={cage.divisionCompatibility?.includes(division.id) || false}
                            onChange={() => toggleDivisionCompatibility(cage, division.id)}
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
          {globalCages.length === 0 && !isCreatingGlobalCage && (
            <p className={styles.empty}>No cages created yet.</p>
          )}
        </div>
      </section>

      {/* Season Cages Section */}
      {currentSeason ? (
        <section className={styles.section}>
          <div className={styles.header}>
            <h2>Cages for {currentSeason.name}</h2>
          </div>

          {/* Add cages to season */}
          {getCagesNotInSeason().length > 0 && (
            <div className={styles.addCagesSection}>
              <h4>Add Cages to Season</h4>
              <div className={styles.availableCages}>
                {getCagesNotInSeason().map((cage) => (
                  <button
                    key={cage.id}
                    className={styles.addCageButton}
                    onClick={() => handleAddCageToSeason(cage.id)}
                  >
                    + {cage.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Season cage cards */}
          <div className={styles.cageList}>
            {seasonCages.map((seasonCage) => {
              const isExpanded = managingSeasonCageId === seasonCage.id;
              return (
                <div
                  key={seasonCage.id}
                  className={`${styles.seasonCageCard} ${isExpanded ? styles.expanded : ''}`}
                >
                  <div className={styles.cageHeader}>
                    <h3>{seasonCage.cageName}</h3>
                    <div className={styles.cageActions}>
                      <button
                        onClick={() =>
                          setManagingSeasonCageId(isExpanded ? null : seasonCage.id)
                        }
                      >
                        {isExpanded ? 'Close' : 'Manage Availability'}
                      </button>
                      <button onClick={() => handleRemoveCageFromSeason(seasonCage.id)}>
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className={styles.seasonCageContent}>
                    {/* Left side: Cage summary */}
                    <div className={styles.seasonCageSummary}>
                      <div className={styles.cageDetails}>
                        {/* Division Compatibility (read-only, from global cage) */}
                        <div className={styles.divisionSection}>
                          <strong>Compatible Divisions:</strong>{' '}
                          {seasonCage.divisionCompatibility && seasonCage.divisionCompatibility.length > 0 ? (
                            <span className={styles.divisionList}>
                              {seasonCage.divisionCompatibility
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
                          {availabilities[seasonCage.id]?.length > 0 ? (
                            <ul>
                              {availabilities[seasonCage.id].map((avail) => (
                                <li key={avail.id}>
                                  {DAYS_OF_WEEK[avail.dayOfWeek]} {formatTime12Hour(avail.startTime)} - {formatTime12Hour(avail.endTime)}
                                  {avail.singleEventOnly && ' (Single Event)'}
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
                          {overrides[seasonCage.id]?.length > 0 ? (
                            <ul>
                              {overrides[seasonCage.id].map((override) => (
                                <li key={override.id}>
                                  {override.date} - {override.overrideType === 'blackout' ? 'Blackout' : 'Added'}
                                  {override.startTime && override.endTime && ` (${formatTime12Hour(override.startTime)} - ${formatTime12Hour(override.endTime)})`}
                                  {override.reason && ` - ${override.reason}`}
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
                      <div className={styles.seasonCageManagement}>
                        {/* Copy from another cage */}
                        {seasonCages.filter((sc) => sc.id !== seasonCage.id && (availabilities[sc.id]?.length > 0 || overrides[sc.id]?.length > 0)).length > 0 && (
                          <div className={styles.copyFromSection}>
                            <label>Copy schedule from:</label>
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleCopyScheduleFrom(seasonCage.id, e.target.value);
                                  e.target.value = '';
                                }
                              }}
                            >
                              <option value="">Select a cage...</option>
                              {seasonCages
                                .filter((sc) => sc.id !== seasonCage.id && (availabilities[sc.id]?.length > 0 || overrides[sc.id]?.length > 0))
                                .map((sc) => (
                                  <option key={sc.id} value={sc.id}>
                                    {sc.cageName}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}

                        <div className={styles.seasonCageManagementForms}>
                        <div className={styles.availabilitySection}>
                          <h4>{editingAvailabilityId ? 'Edit' : 'Add'} Weekly Availability</h4>
                          <AvailabilityForm
                            formData={availabilityFormData}
                            onChange={setAvailabilityFormData}
                            onSubmit={() =>
                              editingAvailabilityId
                                ? handleUpdateAvailability(seasonCage.id)
                                : handleCreateAvailability(seasonCage.id)
                            }
                            onCancel={handleCancelEditAvailability}
                            isEditing={!!editingAvailabilityId}
                          />
                          <AvailabilityList
                            items={availabilities[seasonCage.id] || []}
                            onEdit={handleStartEditAvailability}
                            onDelete={(id) => handleDeleteAvailability(seasonCage.id, id)}
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
                                ? handleUpdateOverride(seasonCage.id)
                                : handleCreateOverride(seasonCage.id)
                            }
                            onCancel={handleCancelEditOverride}
                            isEditing={!!editingOverrideId}
                          />
                          <OverrideList
                            items={overrides[seasonCage.id] || []}
                            onEdit={handleStartEditOverride}
                            onDelete={(id) => handleDeleteOverride(seasonCage.id, id)}
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

            {seasonCages.length === 0 && (
              <div className={styles.empty}>
                <p>No cages added to this season yet. Add cages from the list above.</p>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className={styles.section}>
          <p>Select a season to manage which cages are available for that season.</p>
        </section>
      )}
    </div>
  );
}
