/** Spielstand im Web Worker lesen (Hauptthread bleibt bedienbar). */
import type { SaveExtract } from '@satis/core';

export function readSave(file: File): Promise<SaveExtract> {
  return file.arrayBuffer().then(
    (buffer) =>
      new Promise<SaveExtract>((resolve, reject) => {
        const worker = new Worker(new URL('./saveWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<{ ok: true; extract: SaveExtract } | { ok: false; error: string }>) => {
          worker.terminate();
          if (e.data.ok) resolve(e.data.extract);
          else reject(new Error(e.data.error));
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message));
        };
        worker.postMessage({ name: file.name.replace(/\.sav$/i, ''), buffer }, [buffer]);
      }),
  );
}
