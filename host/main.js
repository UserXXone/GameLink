require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');

const HOST_CODE = process.env.HOST_CODE || '123456';
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'changeme';
const SIGNALING_URL = process.env.SIGNALING_URL || 'wss://localhost:8080';
const PASSWORD_HASH = crypto.createHash('sha256').update(HOST_PASSWORD).digest('hex');

let mainWindow;
let psProcess;

// Electron'un kendi "hangi ekranı paylaşmak istersiniz" onay penceresini atlayıp
// birincil ekranı otomatik seçiyoruz (onay ekranı istemediğiniz için).
function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) {
        callback({});
        return;
      }
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
}

// Fare/klavye enjeksiyonunu yapan kalıcı PowerShell alt sürecini başlatır.
// Süreç çökerse otomatik yeniden başlatılır.
function startInputBridge() {
  psProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'input-bridge.ps1'),
  ]);

  psProcess.stdout.on('data', (d) => console.log('[input-bridge]', d.toString().trim()));
  psProcess.stderr.on('data', (d) => console.error('[input-bridge ERR]', d.toString().trim()));
  psProcess.on('exit', (code) => {
    console.error(`input-bridge kapandı (kod ${code}), 2sn sonra yeniden başlatılıyor...`);
    setTimeout(startInputBridge, 2000);
  });
}

function writeInput(cmd) {
  if (psProcess && psProcess.stdin && !psProcess.killed) {
    psProcess.stdin.write(JSON.stringify(cmd) + '\n');
  }
}

app.whenReady().then(() => {
  setupDisplayMediaHandler();
  startInputBridge();
  createWindow();
  console.log(`GameLink host başlatıldı. Kod: ${HOST_CODE}`);
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('get-config', () => ({
  code: HOST_CODE,
  passwordHash: PASSWORD_HASH,
  signalingUrl: SIGNALING_URL,
}));

ipcMain.on('input', (_e, cmd) => writeInput(cmd));

ipcMain.on('set-status', (_e, status) => console.log('[STATUS]', status));
