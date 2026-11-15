/** Freischaltung des geöffneten Projekts (Spielfortschritt) für die Oberfläche. */
import { unlockState, type UnlockState } from '@satis/core';
import { t } from '../i18n';
import { useProjectStore } from './projectStore';

export function useUnlocks(): UnlockState {
  return useProjectStore((s) => unlockState(s.gd!, s.project?.settings.progress));
}

/** Kurztext für gesperrte Rezepte bzw. Gebäude (Tooltip, Zusatz in Listen); `null`, wenn frei. */
export function lockedNote(u: UnlockState, id: string): string | null {
  const req = u.requirement(id);
  return req ? t('nicht freigeschaltet ({req})', { req }) : null;
}
