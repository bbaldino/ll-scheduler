import { formatTime12Hour } from './AvailabilityForm';
import styles from './AvailabilityForm.module.css';

export type OverrideType = 'blackout' | 'added';

export interface OverrideFormData {
  date: string;
  overrideType: OverrideType;
  startTime?: string;
  endTime?: string;
  reason?: string;
  singleEventOnly?: boolean;
}

interface OverrideFormProps {
  formData: OverrideFormData;
  onChange: (data: OverrideFormData) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  isEditing?: boolean;
  submitLabel?: string;
}

export function OverrideForm({
  formData,
  onChange,
  onSubmit,
  onCancel,
  isEditing = false,
  submitLabel,
}: OverrideFormProps) {
  return (
    <div className={styles.form}>
      <input
        type="date"
        value={formData.date}
        onChange={(e) => onChange({ ...formData, date: e.target.value })}
      />
      <select
        value={formData.overrideType}
        onChange={(e) => onChange({ ...formData, overrideType: e.target.value as OverrideType })}
      >
        <option value="blackout">Blackout</option>
        <option value="added">Added</option>
      </select>
      <input
        type="time"
        value={formData.startTime || ''}
        onChange={(e) => onChange({ ...formData, startTime: e.target.value || undefined })}
        placeholder="Start (optional)"
      />
      <input
        type="time"
        value={formData.endTime || ''}
        onChange={(e) => onChange({ ...formData, endTime: e.target.value || undefined })}
        placeholder="End (optional)"
      />
      <input
        type="text"
        value={formData.reason || ''}
        onChange={(e) => onChange({ ...formData, reason: e.target.value })}
        placeholder="Reason (optional)"
      />
      {formData.overrideType === 'added' && (
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={formData.singleEventOnly || false}
            onChange={(e) => onChange({ ...formData, singleEventOnly: e.target.checked })}
          />
          <span>Single Event</span>
        </label>
      )}
      <button type="button" onClick={onSubmit}>
        {submitLabel || (isEditing ? 'Update' : 'Add')}
      </button>
      {isEditing && onCancel && (
        <button type="button" onClick={onCancel} className={styles.cancelButton}>
          Cancel
        </button>
      )}
    </div>
  );
}

export interface OverrideDisplayData {
  id: string;
  date: string;
  overrideType: OverrideType;
  startTime?: string;
  endTime?: string;
  reason?: string;
  singleEventOnly?: boolean;
}

interface OverrideListProps {
  items: OverrideDisplayData[];
  onEdit?: (item: OverrideDisplayData) => void;
  onDelete: (id: string) => void;
  editingId?: string | null;
}

export function OverrideList({ items, onEdit, onDelete, editingId }: OverrideListProps) {
  if (items.length === 0) return null;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`${styles.listItem} ${editingId === item.id ? styles.editing : ''}`}
        >
          <span>
            {item.date} - {item.overrideType === 'blackout' ? 'Blackout' : 'Added'}
            {item.startTime && item.endTime && (
              <> ({formatTime12Hour(item.startTime)} - {formatTime12Hour(item.endTime)})</>
            )}
            {item.singleEventOnly && <span className={styles.badge}>Single Event</span>}
            {item.reason && <> - {item.reason}</>}
          </span>
          <div className={styles.actions}>
            {onEdit && (
              <button onClick={() => onEdit(item)} disabled={editingId === item.id}>
                Edit
              </button>
            )}
            <button onClick={() => onDelete(item.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
