import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

if (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  (window.location.protocol === 'https:' || window.location.protocol === 'http:')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Ignore registration failure in restricted WebViews
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
