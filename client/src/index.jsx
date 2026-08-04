import React from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webDarkTheme } from '@fluentui/react-components';
import * as ctrl from './controller';
import App from './App';

// Yalnızca geliştirme derlemesinde: arayüzü host'a bağlanmadan elle sürebilmek
// için. Üretimde NODE_ENV sabit olduğundan bu blok bundle'dan tamamen silinir.
if (process.env.NODE_ENV !== 'production') window.__ctrl = ctrl;

// Fluent'in hazır koyu teması — özel marka rampası ya da token değişikliği yok,
// bu Windows 11 uygulamalarının standart görünümü.
createRoot(document.getElementById('root')).render(
  <FluentProvider theme={webDarkTheme} style={{ height: '100vh' }}>
    <App />
  </FluentProvider>
);
