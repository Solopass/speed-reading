import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerServiceWorker } from './lib/install';

// Offline support for the installed app (production build only).
registerServiceWorker(import.meta.env.BASE_URL, import.meta.env.PROD);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
