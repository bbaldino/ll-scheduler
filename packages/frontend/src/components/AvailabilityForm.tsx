import styles from './AvailabilityForm.module.css';
import { formatTime12Hour } from '../utils/timeFormat';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Re-export for backwards compatibility
export { formatTime12Hour };

export interface AvailabilityFormData {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  singleEventOnly?: boolean;
}

interface AvailabilityFormProps {
  formData: AvailabilityFormData;
  onChange: (data: AvailabilityFormData) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  isEditing?: boolean;
  submitLabel?: string;
}

export function AvailabilityForm({
  formData,
  onChange,
  onSubmit,
  onCancel,
  isEditing = false,
  submitLabel,
}: AvailabilityFormProps) {
  return (
    <div className={styles.form}>
      <select
        value={formData.dayOfWeek}
        onChange={(e) => onChange({ ...formData, dayOfWeek: parseInt(e.target.value) })}
      >
        {DAYS_OF_WEEK.map((day, i) => (
          <option key={i} value={i}>
            {day}
          </option>
        ))}
      </select>
      <input
        type="time"
        value={formData.startTime}
        onChange={(e) => onChange({ ...formData, startTime: e.target.value })}
      />
      <span>to</span>
      <input
        type="time"
        value={formData.endTime}
        onChange={(e) => onChange({ ...formData, endTime: e.target.value })}
      />
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={formData.singleEventOnly || false}
          onChange={(e) => onChange({ ...formData, singleEventOnly: e.target.checked })}
        />
        <span>Single Event</span>
      </label>
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

export interface AvailabilityDisplayData {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  singleEventOnly?: boolean;
}

interface AvailabilityListProps {
  items: AvailabilityDisplayData[];
  onEdit?: (item: AvailabilityDisplayData) => void;
  onDelete: (id: string) => void;
  editingId?: string | null;
}

export function AvailabilityList({ items, onEdit, onDelete, editingId }: AvailabilityListProps) {
  if (items.length === 0) return null;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`${styles.listItem} ${editingId === item.id ? styles.editing : ''}`}
        >
          <span>
            {DAYS_OF_WEEK[item.dayOfWeek]} {formatTime12Hour(item.startTime)} -{' '}
            {formatTime12Hour(item.endTime)}
            {item.singleEventOnly && <span className={styles.badge}>Single Event</span>}
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
