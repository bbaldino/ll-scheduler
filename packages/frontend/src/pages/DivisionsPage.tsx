import { useState, useEffect } from 'react';
import {
  fetchDivisions,
  createDivision,
  updateDivision,
  deleteDivision,
  reorderDivisions,
} from '../api/divisions';
import type { Division, CreateDivisionInput } from '@ll-scheduler/shared';
import styles from './DivisionsPage.module.css';

export default function DivisionsPage() {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateDivisionInput>({
    name: '',
  });
  const [editFormData, setEditFormData] = useState<{ name: string }>({
    name: '',
  });

  useEffect(() => {
    loadDivisions();
  }, []);

  const loadDivisions = async () => {
    setLoading(true);
    try {
      const data = await fetchDivisions();
      setDivisions(data);
    } catch (error) {
      console.error('Failed to fetch divisions:', error);
      alert('Failed to load divisions');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createDivision(formData);
      await loadDivisions();
      setIsCreating(false);
      setFormData({ name: '' });
    } catch (error) {
      console.error('Failed to create division:', error);
      alert('Failed to create division');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditing = (division: Division) => {
    setEditingId(division.id);
    setEditFormData({
      name: division.name,
    });
  };

  const handleUpdate = async (id: string) => {
    setIsSubmitting(true);
    try {
      await updateDivision(id, editFormData);
      await loadDivisions();
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update division:', error);
      alert('Failed to update division');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        'Are you sure you want to delete this division? This will delete all associated configs and data.'
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      await deleteDivision(id);
      await loadDivisions();
    } catch (error) {
      console.error('Failed to delete division:', error);
      alert('Failed to delete division');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const newOrder = [...divisions];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setIsSubmitting(true);
    try {
      const updated = await reorderDivisions(newOrder.map((d) => d.id));
      setDivisions(updated);
    } catch (error) {
      console.error('Failed to reorder divisions:', error);
      alert('Failed to reorder divisions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index === divisions.length - 1) return;
    const newOrder = [...divisions];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setIsSubmitting(true);
    try {
      const updated = await reorderDivisions(newOrder.map((d) => d.id));
      setDivisions(updated);
    } catch (error) {
      console.error('Failed to reorder divisions:', error);
      alert('Failed to reorder divisions');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className={styles.container}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Divisions</h2>
        <button onClick={() => setIsCreating(true)} disabled={isSubmitting || isCreating}>
          Create Division
        </button>
      </div>

      <p className={styles.description}>
        Divisions are global (T-Ball, Minors, Majors, etc.). Configure season-specific settings like
        practices per week in each season's settings. Use the arrows to set scheduling priority—divisions
        at the top are scheduled first and get priority for field slots.
      </p>

      {isCreating && (
        <form onSubmit={handleCreate} className={styles.form}>
          <h3>Create New Division</h3>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., T-Ball, Minors, Majors"
              required
            />
          </div>
          <div className={styles.formActions}>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
            <button type="button" onClick={() => setIsCreating(false)} disabled={isSubmitting}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {divisions.length > 0 && (
        <h4 className={styles.listHeader}>Scheduling Priority</h4>
      )}
      <div className={styles.divisionList}>
        {divisions.map((division, index) => (
          <div key={division.id} className={styles.divisionCard}>
            {editingId === division.id ? (
              <div className={styles.editForm}>
                <input
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  className={styles.editInput}
                />
                <div className={styles.editActions}>
                  <button onClick={() => handleUpdate(division.id)} disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setEditingId(null)} disabled={isSubmitting}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.orderControls}>
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={isSubmitting || index === 0}
                    className={styles.orderButton}
                    title="Move up (schedule earlier)"
                  >
                    ↑
                  </button>
                  <span className={styles.orderNumber}>{index + 1}</span>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={isSubmitting || index === divisions.length - 1}
                    className={styles.orderButton}
                    title="Move down (schedule later)"
                  >
                    ↓
                  </button>
                </div>
                <div className={styles.divisionInfo}>
                  <h3>{division.name}</h3>
                </div>
                <div className={styles.divisionActions}>
                  <button onClick={() => startEditing(division)} disabled={isSubmitting}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(division.id)} disabled={isSubmitting}>
                    {isSubmitting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {divisions.length === 0 && !isCreating && (
        <div className={styles.empty}>
          <p>No divisions yet. Create one to get started!</p>
        </div>
      )}
    </div>
  );
}
