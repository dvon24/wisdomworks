/**
 * WisdomWorks Desktop — Tauri shell entry point.
 *
 * For now, this loads the Command Deck from the production URL inside an iframe-style
 * webview. Future iteration: bundle the Command Deck React code directly so it works
 * offline and gets full filesystem access via @tauri-apps/api.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
