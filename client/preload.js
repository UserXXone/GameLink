const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clientAPI', {
  getInitData: () => ipcRenderer.invoke('get-init-data'),
  saveConnection: (conn) => ipcRenderer.invoke('save-connection', conn),
  removeConnection: (id) => ipcRenderer.invoke('remove-connection', id),
});
