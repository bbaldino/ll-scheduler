/**
 * Generate a simple unique ID
 * In production, you might want to use a more robust UUID library
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
