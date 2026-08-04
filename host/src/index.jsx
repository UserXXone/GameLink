import React from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webDarkTheme } from '@fluentui/react-components';
import App from './App';

// Fluent'in hazır koyu teması — özel marka rampası ya da token değişikliği yok,
// bu Windows 11 uygulamalarının standart görünümü.
createRoot(document.getElementById('root')).render(
  <FluentProvider theme={webDarkTheme} style={{ height: '100vh' }}>
    <App />
  </FluentProvider>
);
