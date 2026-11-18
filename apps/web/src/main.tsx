import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles.css';
import { useProjectStore } from './state/projectStore';
import { useUiStore } from './state/uiStore';
import { usePrefs } from './state/prefsStore';
import { useSimStore } from './state/simStore';
import { useMapStore } from './state/mapStore';
import * as core from '@satis/core';
import { APP_BASE, APP_STANDALONE } from './version';

// Installierbare Web-App (GitHub Pages): Offline-Cache, siehe vite.config.ts
if (APP_STANDALONE && !import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${APP_BASE}sw.js`, { scope: APP_BASE }).catch(() => undefined));
}

// Zugriff für Ende-zu-Ende-Tests (nur im Entwicklungsmodus)
if (import.meta.env.DEV) Object.assign(window, { __satis: { useProjectStore, useUiStore, usePrefs, useSimStore, useMapStore, core } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
