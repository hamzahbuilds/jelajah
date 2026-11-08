import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import { initTheme } from './theme';
import { registerSW } from './lib/pwa';
import { ReducedMotionConfig } from '@animate-ui/react/utils/motion';
// v0.38: heading font (self-hosted, variable weight, latin only loads for latin text; font-display: swap).
import '@fontsource-variable/bricolage-grotesque/wght.css';

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* v0.37 motion: every Motion animation follows the OS "reduce motion" setting (fades stay, movement goes). */}
      <ReducedMotionConfig>
        <App />
      </ReducedMotionConfig>
    </BrowserRouter>
  </React.StrictMode>,
);

// v0.22 PWA — registered after the initial render (PROD-only guard lives
// inside registerSW). Update detection is surfaced to the React tree via a
// window CustomEvent rather than a prop/context threaded down from here,
// since Chrome (the banner host) lives several components below App and
// this file has no reason to know about session/router state.
registerSW(() => {
  window.dispatchEvent(new CustomEvent('jl-sw-update'));
});
