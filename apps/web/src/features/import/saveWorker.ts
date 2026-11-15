/**
 * Web Worker: liest einen Spielstand (.sav) mit @etothepii/satisfactory-file-parser
 * und liefert den Auszug für den Planer. Läuft im Browser, der Spielstand
 * verlässt den Rechner nicht.
 */
import { Parser } from '@etothepii/satisfactory-file-parser';
import { extractSave } from './saveExtract';

const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<{ name: string; buffer: ArrayBuffer }>) => void) | null };

ctx.onmessage = (e) => {
  try {
    const save = Parser.ParseSave(e.data.name, e.data.buffer);
    ctx.postMessage({ ok: true, extract: extractSave(save) });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
