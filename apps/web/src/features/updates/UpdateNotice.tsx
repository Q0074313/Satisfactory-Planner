import { t } from '../../i18n';
import { updateCheckEnabled, useUpdates } from '../../state/updates';
import { APP_STANDALONE, APP_VERSION } from '../../version';

/**
 * Hinweis neben der Versionsnummer, wenn auf GitHub eine neuere Version liegt.
 * Eigenständig (GitHub Pages): Neu laden holt die neue Version. Mit Server:
 * Link zum Release, aktualisieren muss der Betreiber des Servers.
 */
export function UpdateBadge() {
  const latest = useUpdates((s) => s.latest);
  const available = useUpdates((s) => s.available);
  if (!available || !latest) return null;
  if (APP_STANDALONE)
    return (
      <button className="update-badge" data-testid="update-badge" onClick={() => location.reload()} title={t('Neu laden, um die neue Version zu verwenden. Projekte bleiben erhalten.')}>
        {t('Neue Version {v} – neu laden', { v: latest.version })}
      </button>
    );
  return (
    <a className="update-badge" data-testid="update-badge" href={latest.url} target="_blank" rel="noopener noreferrer" title={t('Neue Version auf GitHub ansehen')}>
      {t('Neue Version {v} verfügbar', { v: latest.version })}
    </a>
  );
}

/** Zeile in den Einstellungen: neueste Version und „Jetzt prüfen“. */
export function UpdateStatus() {
  const { latest, status, available, check } = useUpdates();
  if (!updateCheckEnabled()) return <span className="dim">{t('Keine Versionsprüfung in dieser Ausgabe.')}</span>;
  let text: string;
  if (status === 'checking') text = t('Prüfe …');
  else if (available && latest) text = t('Version {v} ist verfügbar.', { v: latest.version });
  else if (latest) text = t('Aktuell (neueste Version: {v}).', { v: latest.version });
  else if (status === 'failed') text = t('Konnte GitHub nicht erreichen.');
  else text = t('Noch nicht geprüft.');
  return (
    <span data-testid="update-status">
      {text}{' '}
      {latest && available && (
        <a href={latest.url} target="_blank" rel="noopener noreferrer">
          {t('Änderungen ansehen')}
        </a>
      )}{' '}
      <button onClick={() => void check({ force: true })} disabled={status === 'checking'} title={t('Installiert: {v}', { v: APP_VERSION })}>
        {t('Jetzt prüfen')}
      </button>
    </span>
  );
}
