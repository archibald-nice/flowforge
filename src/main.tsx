import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './styles/63-panels.css';
import './styles/64-agent.css';
import './styles/65-hover-toolbar.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
