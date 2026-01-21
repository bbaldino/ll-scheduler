/**
 * Format a 24-hour time string (HH:MM) to 12-hour format (h:MM AM/PM)
 * @param time - Time in 24-hour format (e.g., "16:30")
 * @returns Time in 12-hour format (e.g., "4:30 PM")
 */
export function formatTime12Hour(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Format a time range in 12-hour format
 * @param startTime - Start time in 24-hour format
 * @param endTime - End time in 24-hour format
 * @returns Formatted range (e.g., "4:30 PM - 6:30 PM")
 */
export function formatTimeRange12Hour(startTime: string, endTime: string): string {
  return `${formatTime12Hour(startTime)} - ${formatTime12Hour(endTime)}`;
}
