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

// Zugriff für Ende-zu-Ende-Tests (nur im Entwicklungsmodus)
if (import.meta.env.DEV) Object.assign(window, { __satis: { useProjectStore, useUiStore, usePrefs, useSimStore, useMapStore, core } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
