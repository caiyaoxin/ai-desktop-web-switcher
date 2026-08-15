'use strict'

// web-switcher.js — core module
//
// A dependency-free (Electron-only) main-process module that adds a toggleable
// web-version panel to any Electron AI desktop client. The host app's own UI
// (a WebContentsView) keeps running; this module creates a second native
// WebContentsView that slides over the main area on demand, so users can ask
// quick questions on the free web chat without spending API tokens.
//
// Why a native WebContentsView instead of an <iframe>? Most AI web chats
// (chat.deepseek.com included) send `Content-Security-Policy: frame-ancestors
// 'none'`, which blocks iframes. Native views are not subject to that CSP.

const { WebContentsView, ipcMain, nativeTheme } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_BUTTON_ID = 'web-switcher-btn'
const DEFAULT_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>'

const IPC_TOGGLE = 'web-switcher:toggle'
const IPC_CHANGED = 'web-switcher:changed'

/**
 * Build the sidebar-button injection script that runs inside the host renderer.
 * @param {object} o
 * @param {string} o.buttonId    unique DOM id
 * @param {string} o.label       button text
 * @param {string} o.icon        inline SVG
 * @param {RegExp} o.anchorMatch text regex used to locate the "new chat" button
 * @param {number} o.sidebarMinWidth  min candidate sidebar width (px)
 * @param {number} o.sidebarMaxWidth  max candidate sidebar width (px)
 */
function buildInjectScript(o) {
  const buttonId = JSON.stringify(o.buttonId)
  const label = JSON.stringify(o.label || 'Web')
  const icon = JSON.stringify(o.icon || DEFAULT_ICON)
  const anchorSource = o.anchorMatch.toString()
  const min = o.sidebarMinWidth ?? 150
  const max = o.sidebarMaxWidth ?? 520

  return `
(() => {
  const ID = ${buttonId}
  const LABEL = ${label}
  const ICON = ${icon}
  const ANCHOR_RE = ${anchorSource}

  function measureSidebarWidth(anchor) {
    let el = anchor
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect()
      if (r.width >= ${min} && r.width <= ${max} && r.height >= 200) return Math.round(r.width)
      el = el.parentElement
    }
    return 0
  }

  function applyState(btn, active) {
    btn.setAttribute('data-active', active ? '1' : '0')
    btn.style.borderColor = active ? 'var(--dsw-alias-accent, #4d6bfe)' : 'var(--dsw-alias-border-l2, #e2e4e9)'
    btn.style.background = active ? 'var(--dsw-alias-accent-soft, rgba(77,107,254,0.12))' : 'var(--dsw-alias-button-elevated-fill, #ffffff)'
    btn.style.color = active ? 'var(--dsw-alias-accent, #4d6bfe)' : 'var(--dsw-alias-label-primary, #1f2329)'
    btn.title = active ? '关闭 ' + LABEL : '打开 ' + LABEL
  }

  function tryInject() {
    if (document.getElementById(ID)) return true

    let anchor = null
    for (const el of document.querySelectorAll('button')) {
      const text = (el.textContent || '').trim()
      if (ANCHOR_RE.test(text)) { anchor = el; break }
    }
    if (!anchor) return false

    const btn = document.createElement('button')
    btn.id = ID
    btn.type = 'button'
    btn.setAttribute('aria-label', '打开 ' + LABEL)
    btn.style.cssText = [
      'display:flex','align-items:center','justify-content:center','gap:6px',
      'width:100%','height:38px',
      'border:1px solid var(--dsw-alias-border-l2, #e2e4e9)',
      'border-radius:12px',
      'background:var(--dsw-alias-button-elevated-fill, #ffffff)',
      'color:var(--dsw-alias-label-primary, #1f2329)',
      'cursor:pointer','font-size:14px','font-weight:500','line-height:22px',
      'margin:0 2px 8px','padding:8px 16px','box-sizing:border-box','overflow:hidden',
      'transition:border-color .15s ease, background .15s ease, color .15s ease',
    ].join(';')

    const labelSpan = document.createElement('span')
    labelSpan.textContent = LABEL
    labelSpan.style.cssText = 'white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis'
    btn.appendChild(labelSpan)
    btn.insertAdjacentHTML('afterbegin', ICON)

    let active = false
    try {
      if (window.webSwitcher && typeof window.webSwitcher.onChanged === 'function') {
        window.webSwitcher.onChanged(visible => { active = !!visible; applyState(btn, active) })
      }
    } catch { /* preload may be unavailable */ }

    btn.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation()
      try {
        if (window.webSwitcher && typeof window.webSwitcher.toggle === 'function') {
          window.webSwitcher.toggle(measureSidebarWidth(anchor))
        }
      } catch { /* ignore */ }
    })

    // Clicking "New Chat" while the panel is open closes it first.
    anchor.addEventListener('click', () => {
      try {
        if (active && window.webSwitcher && typeof window.webSwitcher.toggle === 'function') {
          window.webSwitcher.toggle(measureSidebarWidth(anchor))
        }
      } catch { /* ignore */ }
    }, true)

    applyState(btn, false)
    anchor.insertAdjacentElement('afterend', btn)
    return true
  }

  tryInject()
  const mo = new MutationObserver(() => { tryInject() })
  mo.observe(document.body, { childList: true, subtree: true })
  setTimeout(() => mo.disconnect(), 120000)
})()
`
}

/**
 * Create a web-switcher instance bound to a host Electron window.
 * @param {object} options
 * @param {object} options.mainWindow   BrowserWindow
 * @param {object} options.hostView     the host app's WebContentsView (UI to patch)
 * @param {string} [options.url]        web chat URL
 * @param {string} [options.label]      sidebar button label
 * @param {string} [options.buttonId]   DOM id for the injected button
 * @param {RegExp} [options.anchorMatch] regex matching the host "new chat" button text
 * @param {number} [options.titleBarHeight]   reserved top height (px)
 * @param {number} [options.defaultSidebarWidth]  fallback sidebar width
 * @param {number} [options.sidebarMinWidth]
 * @param {number} [options.sidebarMaxWidth]
 * @param {string} [options.partition]  persistent session partition
 * @param {string} [options.configFile] path to JSON {label,url}; null disables persistence
 * @param {boolean} [options.forceLightTheme] force nativeTheme light (default true)
 * @param {function} [options.log]      log function (string) => void
 */
function createWebSwitcher(options) {
  const mainWindow = options.mainWindow
  const hostView = options.hostView
  if (!mainWindow || !hostView) {
    throw new Error('web-switcher: mainWindow and hostView are required')
  }

  const log = options.log || (() => {})
  const forceLightTheme = options.forceLightTheme !== false
  const titleBarHeight = options.titleBarHeight || 0
  const defaultSidebarWidth = options.defaultSidebarWidth || 240
  const buttonId = options.buttonId || DEFAULT_BUTTON_ID

  let view = null
  let visible = false
  let sidebarWidth = defaultSidebarWidth
  let config = { label: options.label || 'Web', url: options.url || 'https://chat.deepseek.com/' }

  function readConfig() {
    if (!options.configFile) return
    try {
      const file = options.configFile
      if (fs.existsSync(file)) {
        config = { ...config, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
      }
    } catch (error) {
      log(`web-switcher: config read failed: ${error.message}`)
    }
  }

  function layout() {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [width, height] = mainWindow.getContentSize()
    const contentHeight = Math.max(0, height - titleBarHeight)

    if (view) {
      if (visible) {
        view.setBounds({
          x: sidebarWidth,
          y: titleBarHeight,
          width: Math.max(0, width - sidebarWidth),
          height: contentHeight,
        })
        if (typeof view.setVisible === 'function') view.setVisible(true)
      } else {
        if (typeof view.setVisible === 'function') {
          view.setVisible(false)
        } else {
          view.setBounds({ x: width, y: titleBarHeight, width: 0, height: contentHeight })
        }
      }
    }
  }

  function configureNavigation(webContents) {
    webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) void webContents.loadURL(url)
      return { action: 'deny' }
    })
    webContents.on('will-navigate', (event, url) => {
      if (/^https?:\/\//i.test(url)) return
      event.preventDefault()
    })
  }

  async function attach() {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (view) return view

    readConfig()

    try {
      view = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: options.partition || 'persist:web-switcher',
        },
      })

      if (typeof view.setBackgroundColor === 'function') {
        view.setBackgroundColor('#ffffff')
      }

      mainWindow.contentView.addChildView(view)
      visible = false
      layout()
      configureNavigation(view.webContents)

      view.webContents.on('render-process-gone', (_event, details) => {
        log(`web-switcher: renderer gone: ${JSON.stringify(details)}`)
      })

      if (forceLightTheme && nativeTheme.themeSource !== 'light') {
        nativeTheme.themeSource = 'light'
      }

      await view.webContents.loadURL(config.url)
      log(`web-switcher: attached (hidden): ${config.url}`)

      // Inject the sidebar button into the host renderer.
      const script = buildInjectScript({
        buttonId,
        label: config.label,
        anchorMatch: options.anchorMatch || /新对话|新建对话|New Chat|New Session|新会话/i,
        sidebarMinWidth: options.sidebarMinWidth,
        sidebarMaxWidth: options.sidebarMaxWidth,
      })
      await hostView.webContents.executeJavaScript(script, true)
      log('web-switcher: sidebar button injected')
    } catch (error) {
      log(`web-switcher: attach failed: ${error.stack || error.message}`)
      try {
        if (view) mainWindow.contentView.removeChildView(view)
      } catch { /* best effort */ }
      view = undefined
      visible = false
    }

    return view
  }

  function setVisible(next) {
    visible = !!next
    layout()
    try {
      mainWindow.webContents.send(IPC_CHANGED, visible)
      hostView.webContents.send(IPC_CHANGED, visible)
    } catch { /* ignore */ }
  }

  function toggle(width) {
    if (typeof width === 'number' && width >= 100 && width <= 700) {
      sidebarWidth = width
    }
    setVisible(!visible)
  }

  function destroy() {
    try {
      if (view && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.contentView.removeChildView(view)
      }
    } catch { /* ignore */ }
    view = undefined
    visible = false
  }

  // Register the toggle IPC handler. Uses a fixed channel so the preload
  // bridge is fully generic; guard by sender to avoid spoofing.
  ipcMain.on(IPC_TOGGLE, (event, width) => {
    if (event.sender !== hostView.webContents && event.sender !== mainWindow.webContents) return
    if (!view) {
      void attach().then(() => toggle(width))
    } else {
      toggle(width)
    }
  })

  return { attach, toggle, setVisible, isVisible: () => visible, relayout: layout, destroy }
}

module.exports = { createWebSwitcher, buildInjectScript, IPC_TOGGLE, IPC_CHANGED }
