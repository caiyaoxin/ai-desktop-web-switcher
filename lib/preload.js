'use strict'

// web-switcher preload bridge — expose a minimal, frozen `window.webSwitcher`
// API to the host renderer. Add this to the host app's preload (or merge the
// two lines into an existing contextBridge.exposeInMainWorld call).

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('webSwitcher', Object.freeze({
  toggle: width => ipcRenderer.send('web-switcher:toggle', width),
  onChanged: callback => {
    const listener = (_event, visible) => callback(visible)
    ipcRenderer.on('web-switcher:changed', listener)
    return () => ipcRenderer.removeListener('web-switcher:changed', listener)
  },
}))
