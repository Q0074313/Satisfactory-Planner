/**
 * Tiefe Kopie reiner Daten. Funktioniert auch mit Immer-Entwürfen (Proxys),
 * bei denen `structuredClone` scheitert.
 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
