// Renderer paketleyici. CLI bayrakları yerine JS API kullanılıyor: Windows
// kabuğu --define içindeki tırnakları yutup NODE_ENV'i string yerine tanımsız
// bir değişken olarak gömüyordu (çalışma anında ReferenceError).
const esbuild = require('esbuild');

const dev = process.argv.includes('--dev');

esbuild.build({
  entryPoints: ['src/index.jsx'],
  outfile: 'renderer.bundle.js',
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['chrome120'],           // Electron 31 = Chromium 126
  minify: !dev,
  sourcemap: dev,
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  logLevel: 'info',
}).catch(() => process.exit(1));
