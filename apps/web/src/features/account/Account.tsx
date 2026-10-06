/**
 * Konto (nur mit Server): Anmelden/Registrieren, Projekt im Konto speichern,
 * Projekte aus dem Konto öffnen, schreibgeschützte Freigabelinks.
 */
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { ApiError, serverApi, useAccount } from '../../state/server';
import { copyAsLocal, openFromAccount, saveToAccount } from '../../state/session';
import { useUiStore } from '../../state/uiStore';
import { Dialog, Row } from '../../ui/fields';

export function AccountMenu() {
  const available = useAccount((s) => s.available);
  const user = useAccount((s) => s.user);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'login' | 'projects' | 'share' | null>(null);
  useEffect(() => {
    if (available === null) void useAccount.getState().check();
  }, [available]);
  if (!available) return null;
  const toast = useUiStore.getState().toast;
  return (
    <div className="menu">
      <button onClick={() => (user ? setOpen(!open) : setDialog('login'))} data-testid="account-button" title={user ? user.email : t('Anmelden, um Projekte im Konto zu speichern und zu teilen')}>
        {user ? `👤 ${user.displayName}` : t('Anmelden')}
      </button>
      {open && user && (
        <div className="menu-pop" onMouseLeave={() => setOpen(false)}>
          <p className="dim small-text">{user.email}</p>
          <button
            className="menu-item"
            onClick={async () => {
              setOpen(false);
              try {
                await saveToAccount();
                toast(t('Im Konto gespeichert.'));
              } catch (e) {
                if (e instanceof ApiError && e.code === 'conflict' && window.confirm(t('Im Konto liegt ein neuerer Stand. Trotzdem überschreiben?'))) {
                  await saveToAccount(true);
                  toast(t('Im Konto gespeichert.'));
                } else toast(e instanceof Error ? e.message : String(e), 'error');
              }
            }}
          >
            {t('Im Konto speichern')}
          </button>
          <button className="menu-item" onClick={() => (setOpen(false), setDialog('projects'))}>
            {t('Projekte im Konto …')}
          </button>
          <button className="menu-item" onClick={() => (setOpen(false), setDialog('share'))}>
            {t('Freigabelink …')}
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              setOpen(false);
              await serverApi.logout();
              useAccount.getState().setUser(null);
            }}
          >
            {t('Abmelden')}
          </button>
        </div>
      )}
      {dialog === 'login' && <LoginDialog onClose={() => setDialog(null)} />}
      {dialog === 'projects' && <RemoteProjectsDialog onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function LoginDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      const r = mode === 'login' ? await serverApi.login(email, password) : await serverApi.register(email, password, name);
      useAccount.getState().setUser(r.user);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Dialog title={mode === 'login' ? t('Anmelden') : t('Konto anlegen')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Row label={t('E-Mail')}>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Row>
        {mode === 'register' && (
          <Row label={t('Anzeigename')}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Row>
        )}
        <Row label={t('Passwort')}>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 10 : undefined} />
        </Row>
        {error && <p className="neg">{error}</p>}
        <div className="button-row">
          <button type="submit" className="primary">
            {mode === 'login' ? t('Anmelden') : t('Registrieren')}
          </button>
          <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? t('Neues Konto anlegen') : t('Ich habe ein Konto')}
          </button>
        </div>
        <p className="dim small-text">{t('Projekte bleiben auch ohne Konto lokal im Browser gespeichert. Das Konto dient zum Sichern auf dem Server und zum Teilen.')}</p>
      </form>
    </Dialog>
  );
}

function RemoteProjectsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<{ id: string; name: string; updatedAt: string; datasetId: string }[] | null>(null);
  useEffect(() => {
    serverApi.listProjects().then(
      (r) => setList(r.projects),
      (e: Error) => useUiStore.getState().toast(e.message, 'error'),
    );
  }, []);
  return (
    <Dialog title={t('Projekte im Konto')} onClose={onClose}>
      {!list && <p className="dim">{t('Lade …')}</p>}
      {list?.length === 0 && <p className="dim">{t('Noch keine Projekte im Konto.')}</p>}
      <ul className="item-list">
        {list?.map((p) => (
          <li
            key={p.id}
            onClick={async () => {
              if (await openFromAccount(p.id)) onClose();
            }}
          >
            <span>{p.name}</span>
            <span className="dim">{new Date(p.updatedAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ShareDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const [shares, setShares] = useState<{ token: string; url: string }[]>([]);
  const toast = useUiStore.getState().toast;
  const refresh = () =>
    serverApi.listShares(project.id).then(
      (r) => setShares(r.shares),
      () => setShares([]),
    );
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Dialog title={t('Schreibgeschützter Freigabelink')} onClose={onClose}>
      <p className="small-text">{t('Wer den Link kennt, kann den im Konto gespeicherten Stand ansehen, aber nicht ändern. Vorher „Im Konto speichern“ wählen, damit der aktuelle Stand geteilt wird.')}</p>
      <div className="button-row">
        <button
          className="primary"
          onClick={async () => {
            try {
              await saveToAccount();
              const r = await serverApi.createShare(project.id);
              await navigator.clipboard?.writeText(r.url).catch(() => undefined);
              toast(t('Link erstellt und kopiert.'));
              void refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), 'error');
            }
          }}
        >
          {t('Speichern und Link erstellen')}
        </button>
      </div>
      <ul className="share-list">
        {shares.map((s) => (
          <li key={s.token}>
            <input readOnly value={s.url} onFocus={(e) => e.target.select()} />
            <button
              className="small danger"
              onClick={async () => {
                await serverApi.revokeShare(s.token);
                void refresh();
              }}
            >
              {t('Widerrufen')}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Hinweis für schreibgeschützt geöffnete, geteilte Projekte. */
export function SharedBanner() {
  const readOnly = useProjectStore((s) => s.readOnly);
  if (!readOnly) return null;
  return (
    <div className="shared-banner" data-testid="shared-banner">
      {t('Schreibgeschützte Ansicht eines geteilten Projekts. Änderungen sind nicht möglich.')}
      <button className="small primary" onClick={() => void copyAsLocal()}>
        {t('Als Kopie übernehmen')}
      </button>
    </div>
  );
}
