/** Softwareversion der App (beim Build aus package.json und git eingesetzt). */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;
declare const __APP_REPO__: string;
declare const __APP_STANDALONE__: boolean;

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const APP_COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : '';
export const APP_BUILT = typeof __APP_BUILT__ !== 'undefined' ? __APP_BUILT__ : '';
/** GitHub-Repository „besitzer/name“ für die Versionsprüfung (leer = keine Prüfung). */
export const APP_REPO = typeof __APP_REPO__ !== 'undefined' ? __APP_REPO__ : '';
/** Eigenständige Ausgabe (GitHub Pages, installierbar): nie einen Server ansprechen. */
export const APP_STANDALONE = typeof __APP_STANDALONE__ !== 'undefined' ? __APP_STANDALONE__ : false;
/** Basispfad der App, z. B. „/“ oder „/Satisfactory-Planner/“. */
export const APP_BASE = import.meta.env.BASE_URL;

/** Projekt mit der Planer-Version, mit der es gespeichert wird. */
export const withAppVersion = <T extends { appVersion?: string }>(p: T): T => (APP_VERSION === 'dev' ? p : { ...p, appVersion: APP_VERSION });

/** Anzeige, z. B. „v0.3.0 (a1b2c3d)“. */
export const versionLabel = () => `v${APP_VERSION}${APP_COMMIT ? ` (${APP_COMMIT})` : ''}`;
