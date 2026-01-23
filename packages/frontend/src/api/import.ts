import type {
  TeamSnapImportRow,
  ImportValidationResult,
  ImportOptions,
  ImportResult,
} from '@ll-scheduler/shared';
import { API_BASE } from './config';

/**
 * Validate import rows on the server and resolve names to IDs
 */
export async function validateImport(
  seasonId: string,
  rows: TeamSnapImportRow[]
): Promise<ImportValidationResult> {
  const response = await fetch(`${API_BASE}/import/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonId, rows }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to validate import');
  }

  return response.json();
}

/**
 * Execute the import
 */
export async function executeImport(
  seasonId: string,
  rows: TeamSnapImportRow[],
  options: ImportOptions
): Promise<ImportResult> {
  const response = await fetch(`${API_BASE}/import/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonId, rows, options }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to execute import');
  }

  return response.json();
}
