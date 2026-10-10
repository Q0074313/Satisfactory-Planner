/**
 * Projekt-Link (nur mit Server): Wer den Link /f/<id> kennt, kann das Projekt
 * öffnen und bearbeiten. Ohne Link gibt es keinen Weg zurück zum Projekt –
 * deshalb gut sichtbar mit Kopieren-Knopf und Lesezeichen-Hinweis. Die
 * Adresszeile zeigt die ID nicht (siehe session.ts), damit sie z. B. in
 * Streams nicht zu sehen ist; der Streamer-Modus verdeckt auch dieses Feld.
 */
import { useState } from 'react';
import { t } from '../../i18n';
import { usePrefs } from '../../state/prefsStore';
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

export async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    useUiStore.getState().toast(t('Link kopiert.'));
  } catch {
    window.prompt(t('Link kopieren:'), url);
  }
}

/** Knöpfe in der Kopfleiste: Link direkt kopieren bzw. die Leiste wieder einblenden. */
export function ProjectLinkButton({ onShow }: { onShow: () => void }) {
  const remote = useProjectStore((s) => s.remote);
  if (!remote) return null;
  return (
    <>
      <button onClick={() => void copy(projectUrl(remote.id))} title={t('Projekt-Link in die Zwischenablage kopieren')} data-testid="copy-link-button">
        📋 {t('Link kopieren')}
      </button>
      <button onClick={onShow} title={t('Projekt-Link anzeigen')} data-testid="link-button">
        🔗
      </button>
    </>
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
  const streamer = usePrefs((s) => s.streamerMode);
  if (!remote) return null;
  const url = projectUrl(remote.id);
  return (
    <div className="link-bar" data-testid="link-bar">
      <span className="link-bar-label">🔗 {t('Dein Projekt-Link:')}</span>
      {/* Streamer-Modus: Link verdeckt (Kopieren geht weiter) */}
      <input
        readOnly
        value={streamer ? `${location.origin}/f/${'•'.repeat(12)}` : url}
        onFocus={(e) => !streamer && e.target.select()}
        aria-label={t('Projekt-Link')}
        title={streamer ? t('Streamer-Modus: Link verdeckt (Einstellungen → Allgemein)') : undefined}
        data-testid="project-link"
      />
      <button className="small primary" onClick={() => void copy(url)}>
        {t('Kopieren')}
      </button>
      <span className="dim small-text">{t('🔖 Link kopieren und als Lesezeichen speichern – die Adresszeile zeigt ihn nicht. Ohne diesen Link kommst du nicht mehr an das Projekt. Wer den Link hat, kann es bearbeiten.')}</span>
      <button className="small" onClick={onHide} title={t('Leiste ausblenden (über „🔗 Link“ wieder einblenden)')}>
        ×
      </button>
    </div>
  );
}
