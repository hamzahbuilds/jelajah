import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import { initTheme } from './theme';
import { registerSW } from './lib/pwa';

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
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
