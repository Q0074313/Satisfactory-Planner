import { exportProject, type Project } from '@satis/core';

/** Lädt das Projekt als versionierte JSON-Datei herunter. */
export function downloadProject(p: Project): void {
  const blob = new Blob([exportProject(p)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = p.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'project';
  a.href = url;
  a.download = `${safe}.satis.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Öffnet einen Dateidialog und liefert den Inhalt der gewählten Datei. */
export function pickFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
