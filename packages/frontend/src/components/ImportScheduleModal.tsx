import { useState, useRef, useEffect } from 'react';
import type {
  TeamSnapImportRow,
  ImportValidationResult,
  ImportValidationError,
  ImportResult,
  Division,
} from '@ll-scheduler/shared';
import { parseTeamSnapCsv, validateRowsClientSide } from '../utils/csvParser';
import { validateImport, executeImport } from '../api/import';
import { fetchDivisions } from '../api/divisions';
import styles from './ImportScheduleModal.module.css';

interface ImportScheduleModalProps {
  seasonId: string;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

type ImportStep = 'upload' | 'preview' | 'options' | 'confirm' | 'complete';

export function ImportScheduleModal({
  seasonId,
  onClose,
  onImported,
}: ImportScheduleModalProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [parsedRows, setParsedRows] = useState<TeamSnapImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'overwrite'>('merge');
  const [selectedDivisions, setSelectedDivisions] = useState<Set<string>>(new Set());
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionsInCsv, setDivisionsInCsv] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDivisions();
  }, []);

  const loadDivisions = async () => {
    try {
      const data = await fetchDivisions();
      setDivisions(data);
    } catch (err) {
      console.error('Failed to load divisions:', err);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setParseErrors([]);

    try {
      const content = await file.text();
      const result = parseTeamSnapCsv(content);

      if (result.errors.length > 0) {
        setParseErrors(result.errors);
        setParsedRows([]);
        return;
      }

      // Client-side validation
      const clientErrors = validateRowsClientSide(result.rows);
      if (clientErrors.length > 0) {
        setParseErrors(clientErrors.map((e) => `Row ${e.rowNumber}: ${e.message}`));
        setParsedRows([]);
        return;
      }

      setParsedRows(result.rows);

      // Extract unique divisions from CSV
      const divNames = new Set(result.rows.map((r) => r.division));
      setDivisionsInCsv(divNames);

      // Move to preview step and validate on server
      setStep('preview');
      await validateOnServer(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  const validateOnServer = async (rows: TeamSnapImportRow[]) => {
    setIsValidating(true);
    setError(null);

    try {
      const result = await validateImport(seasonId, rows);
      setValidationResult(result);

      // Auto-select divisions found in CSV for overwrite mode
      if (result.validRows.length > 0) {
        const divIds = new Set(result.validRows.map((r) => r.divisionId));
        setSelectedDivisions(divIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleProceedToOptions = () => {
    if (validationResult && validationResult.errors.length === 0) {
      setStep('options');
    }
  };

  const handleProceedToConfirm = () => {
    if (importMode === 'overwrite' && selectedDivisions.size === 0) {
      setError('Please select at least one division to overwrite');
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const handleExecuteImport = async () => {
    setIsExecuting(true);
    setError(null);

    try {
      const result = await executeImport(seasonId, parsedRows, {
        seasonId,
        mode: importMode,
        divisionIds: importMode === 'overwrite' ? Array.from(selectedDivisions) : undefined,
      });

      setImportResult(result);
      setStep('complete');
      onImported(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleStartOver = () => {
    setStep('upload');
    setParsedRows([]);
    setParseErrors([]);
    setValidationResult(null);
    setError(null);
    setImportMode('merge');
    setSelectedDivisions(new Set());
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toggleDivision = (divisionId: string) => {
    setSelectedDivisions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(divisionId)) {
        newSet.delete(divisionId);
      } else {
        newSet.add(divisionId);
      }
      return newSet;
    });
  };

  const renderUploadStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.instructions}>
        Select a TeamSnap-formatted CSV file to import scheduled events.
      </p>

      <div className={styles.fileUpload}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className={styles.fileInput}
          id="csv-file-input"
        />
        <label htmlFor="csv-file-input" className={styles.fileLabel}>
          Choose CSV File
        </label>
      </div>

      {parseErrors.length > 0 && (
        <div className={styles.errorList}>
          <h4>Parse Errors</h4>
          <ul>
            {parseErrors.slice(0, 10).map((err, i) => (
              <li key={i}>{err}</li>
            ))}
            {parseErrors.length > 10 && (
              <li>... and {parseErrors.length - 10} more errors</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );

  const renderPreviewStep = () => {
    if (isValidating) {
      return (
        <div className={styles.stepContent}>
          <div className={styles.loading}>Validating import data...</div>
        </div>
      );
    }

    if (!validationResult) {
      return (
        <div className={styles.stepContent}>
          <div className={styles.error}>No validation result available</div>
        </div>
      );
    }

    const { validRows, errors, warnings, duplicateRows } = validationResult;
    const hasErrors = errors.length > 0;

    return (
      <div className={styles.stepContent}>
        <div className={styles.validationSummary}>
          <div className={`${styles.summaryItem} ${styles.valid}`}>
            <span className={styles.summaryCount}>{validRows.length}</span>
            <span className={styles.summaryLabel}>Valid</span>
          </div>
          {warnings.length > 0 && (
            <div className={`${styles.summaryItem} ${styles.warning}`}>
              <span className={styles.summaryCount}>{warnings.length}</span>
              <span className={styles.summaryLabel}>Warnings</span>
            </div>
          )}
          {errors.length > 0 && (
            <div className={`${styles.summaryItem} ${styles.errorCount}`}>
              <span className={styles.summaryCount}>{errors.length}</span>
              <span className={styles.summaryLabel}>Errors</span>
            </div>
          )}
          {duplicateRows.length > 0 && (
            <div className={`${styles.summaryItem} ${styles.duplicate}`}>
              <span className={styles.summaryCount}>{duplicateRows.length}</span>
              <span className={styles.summaryLabel}>Duplicates</span>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div className={styles.errorSection}>
            <h4>Errors (must be fixed)</h4>
            <div className={styles.issueList}>
              {groupErrorsByRow(errors).map(({ rowNumber, fieldErrors }) => (
                <div key={rowNumber} className={styles.issueRow}>
                  <span className={styles.rowNumber}>Row {rowNumber}:</span>
                  <ul>
                    {fieldErrors.map((err, i) => (
                      <li key={i}>
                        {err.field && <strong>{err.field}:</strong>} {err.message}
                        {err.value && <code>{err.value}</code>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className={styles.warningSection}>
            <h4>Warnings</h4>
            <div className={styles.issueList}>
              {warnings.slice(0, 5).map((warn, i) => (
                <div key={i} className={styles.issueRow}>
                  <span className={styles.rowNumber}>Row {warn.rowNumber}:</span> {warn.message}
                </div>
              ))}
              {warnings.length > 5 && (
                <div className={styles.moreIssues}>
                  ... and {warnings.length - 5} more warnings
                </div>
              )}
            </div>
          </div>
        )}

        {hasErrors && (
          <div className={styles.errorMessage}>
            Please fix the errors in your CSV file and re-upload.
          </div>
        )}

        <div className={styles.stepActions}>
          <button className={styles.secondaryButton} onClick={handleStartOver}>
            Start Over
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleProceedToOptions}
            disabled={hasErrors}
          >
            Continue
          </button>
        </div>
      </div>
    );
  };

  const renderOptionsStep = () => (
    <div className={styles.stepContent}>
      <h3>Import Options</h3>

      <div className={styles.optionGroup}>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="importMode"
            checked={importMode === 'merge'}
            onChange={() => setImportMode('merge')}
          />
          <div className={styles.radioContent}>
            <strong>Merge</strong>
            <p>Add new events to existing schedule. Duplicates will be skipped.</p>
          </div>
        </label>

        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="importMode"
            checked={importMode === 'overwrite'}
            onChange={() => setImportMode('overwrite')}
          />
          <div className={styles.radioContent}>
            <strong>Overwrite</strong>
            <p>Delete existing events in selected divisions before importing.</p>
          </div>
        </label>
      </div>

      {importMode === 'overwrite' && (
        <div className={styles.divisionSelector}>
          <h4>Select divisions to overwrite:</h4>
          <div className={styles.divisionList}>
            {divisions.map((div) => {
              const inCsv = divisionsInCsv.has(div.name);
              return (
                <label key={div.id} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={selectedDivisions.has(div.id)}
                    onChange={() => toggleDivision(div.id)}
                  />
                  <span>
                    {div.name}
                    {inCsv && <span className={styles.inCsvBadge}>in CSV</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {selectedDivisions.size > 0 && (
            <p className={styles.overwriteWarning}>
              All existing events in the selected division(s) will be deleted.
            </p>
          )}
        </div>
      )}

      <div className={styles.stepActions}>
        <button className={styles.secondaryButton} onClick={() => setStep('preview')}>
          Back
        </button>
        <button className={styles.primaryButton} onClick={handleProceedToConfirm}>
          Continue
        </button>
      </div>
    </div>
  );

  const renderConfirmStep = () => {
    const validCount = validationResult?.validRows.length || 0;
    const duplicateCount = validationResult?.duplicateRows.length || 0;

    return (
      <div className={styles.stepContent}>
        <h3>Confirm Import</h3>

        <div className={styles.confirmSummary}>
          <p>
            <strong>Mode:</strong> {importMode === 'merge' ? 'Merge' : 'Overwrite'}
          </p>
          <p>
            <strong>Events to import:</strong> {validCount}
            {importMode === 'merge' && duplicateCount > 0 && (
              <span className={styles.duplicateNote}>
                {' '}
                ({duplicateCount} duplicates will be skipped)
              </span>
            )}
          </p>
          {importMode === 'overwrite' && (
            <p>
              <strong>Divisions to overwrite:</strong>{' '}
              {divisions
                .filter((d) => selectedDivisions.has(d.id))
                .map((d) => d.name)
                .join(', ')}
            </p>
          )}
        </div>

        {importMode === 'overwrite' && (
          <div className={styles.warningBox}>
            This will delete all existing events in the selected divisions. This cannot be undone.
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.stepActions}>
          <button
            className={styles.secondaryButton}
            onClick={() => setStep('options')}
            disabled={isExecuting}
          >
            Back
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleExecuteImport}
            disabled={isExecuting}
          >
            {isExecuting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    );
  };

  const renderCompleteStep = () => {
    if (!importResult) return null;

    return (
      <div className={styles.stepContent}>
        <h3>Import Complete</h3>

        <div className={styles.resultSummary}>
          <div className={styles.resultItem}>
            <span className={styles.resultValue}>{importResult.createdCount}</span>
            <span className={styles.resultLabel}>Events Created</span>
          </div>
          {importResult.deletedCount !== undefined && importResult.deletedCount > 0 && (
            <div className={styles.resultItem}>
              <span className={styles.resultValue}>{importResult.deletedCount}</span>
              <span className={styles.resultLabel}>Events Deleted</span>
            </div>
          )}
          {importResult.duplicatesSkipped > 0 && (
            <div className={styles.resultItem}>
              <span className={styles.resultValue}>{importResult.duplicatesSkipped}</span>
              <span className={styles.resultLabel}>Duplicates Skipped</span>
            </div>
          )}
        </div>

        <div className={styles.stepActions}>
          <button className={styles.primaryButton} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  };

  const renderStepIndicator = () => {
    const steps: ImportStep[] = ['upload', 'preview', 'options', 'confirm', 'complete'];
    const currentIndex = steps.indexOf(step);

    return (
      <div className={styles.stepIndicator}>
        {steps.map((s, i) => (
          <div
            key={s}
            className={`${styles.stepDot} ${i <= currentIndex ? styles.active : ''} ${
              i === currentIndex ? styles.current : ''
            }`}
          />
        ))}
      </div>
    );
  };

  const stepTitles: Record<ImportStep, string> = {
    upload: 'Upload CSV',
    preview: 'Preview',
    options: 'Options',
    confirm: 'Confirm',
    complete: 'Complete',
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Import Schedule - {stepTitles[step]}</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        {renderStepIndicator()}

        <div className={styles.content}>
          {step === 'upload' && renderUploadStep()}
          {step === 'preview' && renderPreviewStep()}
          {step === 'options' && renderOptionsStep()}
          {step === 'confirm' && renderConfirmStep()}
          {step === 'complete' && renderCompleteStep()}

          {error && step !== 'confirm' && step !== 'preview' && (
            <div className={styles.error}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function groupErrorsByRow(
  errors: ImportValidationError[]
): { rowNumber: number; fieldErrors: ImportValidationError[] }[] {
  const grouped = new Map<number, ImportValidationError[]>();

  for (const error of errors) {
    const existing = grouped.get(error.rowNumber) || [];
    existing.push(error);
    grouped.set(error.rowNumber, existing);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .slice(0, 10)
    .map(([rowNumber, fieldErrors]) => ({ rowNumber, fieldErrors }));
}
