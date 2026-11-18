import { t } from '../../i18n';
import { APP_REPO, versionLabel } from '../../version';

/** Kurzangabe zu Browser und Betriebssystem für den Fehlerbericht (ohne vollständige Kennung). */
function browserInfo(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\/(\d+)/.exec(ua)?.[0].replace('Edg/', 'Edge ') ?? /Firefox\/(\d+)/.exec(ua)?.[0].replace('/', ' ') ?? /Chrome\/(\d+)/.exec(ua)?.[0].replace('/', ' ') ?? (/Safari\//.test(ua) ? 'Safari' : '');
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(', ');
}

/** Neues Issue mit der Vorlage .github/ISSUE_TEMPLATE/bug_report.yml, Version und Browser vorausgefüllt. */
export function bugReportUrl(): string {
  const q = new URLSearchParams({ template: 'bug_report.yml', version: versionLabel(), browser: browserInfo() });
  return `https://github.com/${APP_REPO}/issues/new?${q}`;
}

/** Link „Fehler melden“ (nur wenn das Repository bekannt ist). */
export function BugReportLink({ className }: { className?: string }) {
  if (!APP_REPO) return null;
  return (
    <a className={className} href={bugReportUrl()} target="_blank" rel="noopener noreferrer" data-testid="bug-report" title={t('Öffnet auf GitHub einen neuen Fehlerbericht (GitHub-Konto nötig). Version und Browser sind vorausgefüllt.')}>
      🐞 {t('Fehler melden')}
    </a>
  );
}
