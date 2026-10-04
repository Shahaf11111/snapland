/**
 * Whether `date` falls in "daytime" hours, using a fixed local-clock
 * heuristic (06:00–19:00) rather than real sunrise/sunset for the user's
 * location. Accurate astronomical sunrise/sunset would need geolocation
 * (and a permission prompt) — noted as a future improvement.
 */
export function isDaytime(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 6 && hour < 19;
}
