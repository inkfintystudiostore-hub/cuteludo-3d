import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { useGameStore } from './engine/gameStore';
import { initPwaInstall, registerServiceWorker } from './utils/pwaInstall';

initPwaInstall();
registerServiceWorker();

// Dev-only handle for poking at game state from the browser console.
if (import.meta.env.DEV) Object.assign(window, { ludoStore: useGameStore });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
