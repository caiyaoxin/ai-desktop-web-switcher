'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopWindow', Object.freeze({
  minimize: () => ipcRenderer.send('desktop:window-control', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('desktop:window-control', 'toggle-maximize'),
  close: () => ipcRenderer.send('desktop:window-control', 'close'),
  getState: () => ipcRenderer.invoke('desktop:get-window-state'),
  onStateChange: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('desktop:window-state', listener)
    return () => ipcRenderer.removeListener('desktop:window-state', listener)
  },
  onPageTitle: callback => {
    const listener = (_event, title) => callback(title)
    ipcRenderer.on('desktop:page-title', listener)
    return () => ipcRenderer.removeListener('desktop:page-title', listener)
  },
}))

// web-switcher bridge (added by the patch)
contextBridge.exposeInMainWorld('webSwitcher', Object.freeze({
  toggle: width => ipcRenderer.send('web-switcher:toggle', width),
  onChanged: callback => {
    const listener = (_event, visible) => callback(visible)
    ipcRenderer.on('web-switcher:changed', listener)
    return () => ipcRenderer.removeListener('web-switcher:changed', listener)
  },
}))
