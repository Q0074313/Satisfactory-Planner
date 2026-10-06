/**
 * Projekt-Link (nur mit Server): Wer den Link /f/<id> kennt, kann das Projekt
 * öffnen und bearbeiten. Ohne Link gibt es keinen Weg zurück zum Projekt –
 * deshalb gut sichtbar mit Kopieren-Knopf und Lesezeichen-Hinweis.
 */
import { useState } from 'react';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { projectUrl } from '../../state/server';
import { useUiStore } from '../../state/uiStore';

const HIDE_KEY = 'satis-planner:link-bar-hidden';

const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    useUiStore.getState().toast(t('Link kopiert.'));
  } catch {
    window.prompt(t('Link kopieren:'), url);
  }
}

/** Kompakter Knopf in der Kopfleiste; blendet die Leiste wieder ein. */
export function ProjectLinkButton({ onShow }: { onShow: () => void }) {
  const remote = useProjectStore((s) => s.remote);
  if (!remote) return null;
  return (
    <button onClick={onShow} title={t('Projekt-Link anzeigen')} data-testid="link-button">
      🔗 {t('Link')}
    </button>
  );
}

export function useLinkBar() {
  const [hidden, setHidden] = useState(readHidden);
  const set = (h: boolean) => {
    setHidden(h);
    try {
      localStorage.setItem(HIDE_KEY, h ? '1' : '0');
    } catch {
      /* Speicher nicht verfügbar */
    }
  };
  return { hidden, hide: () => set(true), show: () => set(false) };
}

export function ProjectLinkBar({ onHide }: { onHide: () => void }) {
  const remote = useProjectStore((s) => s.remote);
  if (!remote) return null;
  const url = projectUrl(remote.id);
  return (
    <div className="link-bar" data-testid="link-bar">
      <span className="link-bar-label">🔗 {t('Dein Projekt-Link:')}</span>
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t('Projekt-Link')} data-testid="project-link" />
      <button className="small primary" onClick={() => void copy(url)}>
        {t('Kopieren')}
      </button>
      <span className="dim small-text">{t('🔖 Als Lesezeichen speichern – ohne diesen Link kommst du nicht mehr an das Projekt. Wer den Link hat, kann es bearbeiten.')}</span>
      <button className="small" onClick={onHide} title={t('Leiste ausblenden (über „🔗 Link“ wieder einblenden)')}>
        ×
      </button>
    </div>
  );
}
