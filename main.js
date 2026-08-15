'use strict'

const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  ipcMain,
  dialog,
  shell,
  desktopCapturer,
  nativeTheme,
} = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const PRODUCT_NAME = 'DeepSeek Harness Desktop'
const TITLE_BAR_HEIGHT = 42
const STARTUP_TIMEOUT_MS = 90_000

// Built-in browser panel for the DeepSeek web app, toggled from a sidebar icon.
const BROWSER_URL = 'https://chat.deepseek.com/'
const DEFAULT_SIDEBAR_WIDTH = 240
const BROWSER_BUTTON_ID = 'dsh-deepseek-browser-btn'

function readBrowserConfig() {
  const defaults = { label: 'DeepSeek 网页版', url: BROWSER_URL }
  try {
    const file = dataPath('deepseek-browser.json')
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { ...defaults, ...parsed }
    }
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2), 'utf8')
  } catch (error) {
    writeLog(`[desktop] Browser config read failed: ${error.message}`)
  }
  return defaults
}

function buildInjectScript(label) {
  const safeLabel = JSON.stringify(label || 'DeepSeek 网页版')
  return `
(() => {
  const ID = ${JSON.stringify(BROWSER_BUTTON_ID)}
  const LABEL = ${safeLabel}
  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>'

  function measureSidebarWidth(anchor) {
    let el = anchor
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect()
      if (r.width >= 150 && r.width <= 520 && r.height >= 200) return Math.round(r.width)
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
      if (/新对话|新建对话|New Chat|New Session|新会话/i.test(text)) {
        anchor = el
        break
      }
    }
    if (!anchor) return false

    const btn = document.createElement('button')
    btn.id = ID
    btn.type = 'button'
    btn.setAttribute('aria-label', '打开 ' + LABEL)
    btn.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:6px',
      'width:100%',
      'height:38px',
      'border:1px solid var(--dsw-alias-border-l2, #e2e4e9)',
      'border-radius:12px',
      'background:var(--dsw-alias-button-elevated-fill, #ffffff)',
      'color:var(--dsw-alias-label-primary, #1f2329)',
      'cursor:pointer',
      'font-size:14px',
      'font-weight:500',
      'line-height:22px',
      'margin:0 2px 8px',
      'padding:8px 16px',
      'box-sizing:border-box',
      'overflow:hidden',
      'transition:border-color .15s ease, background .15s ease, color .15s ease',
    ].join(';')

    const labelSpan = document.createElement('span')
    labelSpan.textContent = LABEL
    labelSpan.style.cssText = 'white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis'
    btn.appendChild(labelSpan)
    btn.insertAdjacentHTML('afterbegin', ICON)

    let active = false
    try {
      if (window.desktopWindow && typeof window.desktopWindow.onDeepseekChanged === 'function') {
        window.desktopWindow.onDeepseekChanged(visible => {
          active = !!visible
          applyState(btn, active)
        })
      }
    } catch { /* preload may be unavailable */ }

    btn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      try {
        if (window.desktopWindow && typeof window.desktopWindow.toggleDeepseek === 'function') {
          const width = measureSidebarWidth(anchor)
          window.desktopWindow.toggleDeepseek(width)
        }
      } catch { /* ignore */ }
    })

    // Clicking "New Chat" while the browser is open closes the browser first.
    anchor.addEventListener('click', () => {
      try {
        if (active && window.desktopWindow && typeof window.desktopWindow.toggleDeepseek === 'function') {
          window.desktopWindow.toggleDeepseek(measureSidebarWidth(anchor))
        }
      } catch { /* ignore */ }
    }, true)

    applyState(btn, false)
    anchor.insertAdjacentElement('afterend', btn)
    return true
  }

  tryInject()
  const mo = new MutationObserver(() => {
    tryInject()
  })
  mo.observe(document.body, { childList: true, subtree: true })
  setTimeout(() => mo.disconnect(), 120000)
})()
`
}

let mainWindow
let harnessView
let deepseekView
let deepseekVisible = false
let sidebarWidth = DEFAULT_SIDEBAR_WIDTH
let browserConfig = null
let harnessProcess
let harnessOrigin
let startupTimer
let quitting = false

function dataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts)
}

function writeLog(message) {
  try {
    const logDirectory = dataPath('logs')
    fs.mkdirSync(logDirectory, { recursive: true })
    fs.appendFileSync(
      path.join(logDirectory, 'desktop.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf8',
    )
  } catch {
    // Logging must never prevent the desktop shell from starting.
  }
}

function harnessRuntimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'harness')
    : path.join(__dirname, 'harness')
}

function harnessCliPath() {
  return path.join(
    harnessRuntimeRoot(),
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  )
}

function harnessNodePath() {
  return path.join(harnessRuntimeRoot(), 'runtime', 'node.exe')
}

function startHarness() {
  return new Promise((resolve, reject) => {
    const cliPath = harnessCliPath()
    if (!fs.existsSync(cliPath)) {
      reject(new Error(`Bundled Harness CLI was not found: ${cliPath}`))
      return
    }

    const nodePath = harnessNodePath()
    if (!fs.existsSync(nodePath)) {
      reject(new Error(`Bundled Node.js runtime was not found: ${nodePath}`))
      return
    }

    const harnessHome = dataPath('harness-home')
    fs.mkdirSync(harnessHome, { recursive: true })

    writeLog(`Starting Harness from ${cliPath} with ${nodePath}`)
    harnessProcess = spawn(nodePath, [cliPath, 'web', '--port', '0'], {
      cwd: app.getPath('home'),
      env: {
        ...process.env,
        DSH_HOME: harnessHome,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let settled = false
    const finish = (error, url) => {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      if (error) reject(error)
      else resolve(url)
    }

    const inspectOutput = (source, chunk) => {
      const output = chunk
        .toString('utf8')
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')

      for (const line of output.split(/\r?\n/)) {
        if (line.trim()) writeLog(`[dsh:${source}] ${line}`)
      }

      const match = output.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/i)
      if (match) {
        harnessOrigin = new URL(match[0]).origin
        finish(undefined, match[0])
      }
    }

    harnessProcess.stdout.on('data', chunk => inspectOutput('out', chunk))
    harnessProcess.stderr.on('data', chunk => inspectOutput('err', chunk))

    harnessProcess.once('error', error => {
      writeLog(`[dsh:error] ${error.stack || error.message}`)
      finish(error)
    })

    harnessProcess.once('exit', (code, signal) => {
      writeLog(`[dsh:exit] code=${code} signal=${signal}`)
      harnessProcess = undefined

      if (!settled) {
        finish(new Error(`Harness exited during startup (code=${code}, signal=${signal})`))
      } else if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
        void dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Harness service stopped',
          message: 'The DeepSeek Harness background service exited unexpectedly.',
          detail: `Exit code: ${code ?? 'unknown'}\nLogs: ${dataPath('logs')}`,
        })
      }
    })

    startupTimer = setTimeout(() => {
      finish(new Error(`Harness startup exceeded ${STARTUP_TIMEOUT_MS / 1000} seconds.`))
    }, STARTUP_TIMEOUT_MS)
  })
}

function stopHarness() {
  clearTimeout(startupTimer)
  if (!harnessProcess || harnessProcess.killed) return

  writeLog(`[desktop] Stopping Harness pid=${harnessProcess.pid}`)
  try {
    harnessProcess.kill()
  } catch (error) {
    writeLog(`[desktop] Failed to stop Harness: ${error.message}`)
  }
}

function isHarnessUrl(rawUrl) {
  if (!harnessOrigin) return false
  try {
    return new URL(rawUrl).origin === harnessOrigin
  } catch {
    return false
  }
}

function openExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      writeLog(`[desktop] Blocked external protocol: ${url.protocol}`)
      return
    }
    void shell.openExternal(url.toString())
  } catch {
    writeLog('[desktop] Blocked malformed external URL.')
  }
}

function configureHarnessNavigation(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isHarnessUrl(url)) {
      void webContents.loadURL(url)
    } else {
      openExternalUrl(url)
    }
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    if (isHarnessUrl(url)) return
    event.preventDefault()
    openExternalUrl(url)
  })

  webContents.on('will-attach-webview', event => event.preventDefault())
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('desktop:window-state', {
    maximized: mainWindow.isMaximized(),
    fullScreen: mainWindow.isFullScreen(),
  })
}

function setupWindowControlIpc() {
  ipcMain.on('desktop:window-control', (event, action) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (event.sender !== mainWindow.webContents) return

    switch (action) {
      case 'minimize':
        mainWindow.minimize()
        break
      case 'toggle-maximize':
        if (mainWindow.isMaximized()) mainWindow.unmaximize()
        else mainWindow.maximize()
        break
      case 'close':
        mainWindow.close()
        break
      default:
        break
    }
  })

  ipcMain.handle('desktop:get-window-state', event => {
    if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false, fullScreen: false }
    if (event.sender !== mainWindow.webContents) return { maximized: false, fullScreen: false }
    return {
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen(),
    }
  })

  ipcMain.on('desktop:toggle-deepseek', (event, width) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (event.sender !== harnessView?.webContents && event.sender !== mainWindow.webContents) return

    if (typeof width === 'number' && width >= 150 && width <= 520) {
      sidebarWidth = width
    }

    const toggle = () => {
      deepseekVisible = !deepseekVisible
      writeLog(`[desktop] DeepSeek browser toggled visible=${deepseekVisible} sidebarWidth=${sidebarWidth}`)
      layoutHarnessView()
      mainWindow.webContents.send('desktop:deepseek-changed', deepseekVisible)
      if (harnessView) harnessView.webContents.send('desktop:deepseek-changed', deepseekVisible)
    }

    if (!deepseekView) {
      void attachDeepseekView().then(toggle)
    } else {
      toggle()
    }
  })

  ipcMain.on('desktop:measure-sidebar', async event => {
    if (!harnessView || event.sender !== harnessView.webContents) return
    try {
      const width = await harnessView.webContents.executeJavaScript(`(() => {
        const btn = document.querySelector('[class*="SidebarRoot"], [data-plugin="dsh-client-ui-sidebar"]')
        if (!btn) return null
        const rect = btn.getBoundingClientRect()
        return Math.round(rect.width) || null
      })()`)
      if (typeof width === 'number' && width > 0) {
        sidebarWidth = width
        layoutHarnessView()
      }
    } catch (error) {
      writeLog(`[desktop] Sidebar measure failed: ${error.message}`)
    }
  })
}

function layoutHarnessView() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  const contentHeight = Math.max(0, height - TITLE_BAR_HEIGHT)

  if (harnessView) {
    harnessView.setBounds({ x: 0, y: TITLE_BAR_HEIGHT, width, height: contentHeight })
  }

  if (deepseekView) {
    if (deepseekVisible) {
      deepseekView.setBounds({
        x: sidebarWidth,
        y: TITLE_BAR_HEIGHT,
        width: Math.max(0, width - sidebarWidth),
        height: contentHeight,
      })
      if (typeof deepseekView.setVisible === 'function') deepseekView.setVisible(true)
    } else {
      if (typeof deepseekView.setVisible === 'function') {
        deepseekView.setVisible(false)
      } else {
        deepseekView.setBounds({ x: width, y: TITLE_BAR_HEIGHT, width: 0, height: contentHeight })
      }
    }
  }
}

async function attachHarnessView(url) {
  harnessView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (typeof harnessView.setBackgroundColor === 'function') {
    harnessView.setBackgroundColor('#ffffff')
  }

  mainWindow.contentView.addChildView(harnessView)
  layoutHarnessView()
  configureHarnessNavigation(harnessView.webContents)

  harnessView.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault()
    const nextTitle = title?.trim() || 'DeepSeek Harness'
    mainWindow?.setTitle(nextTitle)
    mainWindow?.webContents.send('desktop:page-title', nextTitle)
  })

  harnessView.webContents.on('render-process-gone', (_event, details) => {
    writeLog(`[desktop] Harness renderer gone: ${JSON.stringify(details)}`)
  })

  await harnessView.webContents.loadURL(url)

  try {
    await harnessView.webContents.executeJavaScript(buildInjectScript(browserConfig.label), true)
    writeLog('[desktop] Sidebar browser button injected')
  } catch (error) {
    writeLog(`[desktop:error] Sidebar button injection failed: ${error.message}`)
  }
}

function configureBrowserNavigation(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      void webContents.loadURL(url)
    } else {
      openExternalUrl(url)
    }
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url)) return
    event.preventDefault()
    openExternalUrl(url)
  })
}

async function attachDeepseekView() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (deepseekView) return deepseekView

  try {
    deepseekView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:deepseek-web',
      },
    })

    if (typeof deepseekView.setBackgroundColor === 'function') {
      deepseekView.setBackgroundColor('#ffffff')
    }

    mainWindow.contentView.addChildView(deepseekView)
    deepseekVisible = false
    layoutHarnessView()
    configureBrowserNavigation(deepseekView.webContents)

    deepseekView.webContents.on('render-process-gone', (_event, details) => {
      writeLog(`[desktop] DeepSeek browser renderer gone: ${JSON.stringify(details)}`)
    })

    // Follow the host app's light theme instead of the system dark preference.
    if (nativeTheme.themeSource !== 'light') {
      nativeTheme.themeSource = 'light'
    }

    const browserUrl = browserConfig.url || BROWSER_URL
    await deepseekView.webContents.loadURL(browserUrl)
    writeLog(`[desktop] DeepSeek browser view attached (hidden): ${browserUrl}`)

    try {
      const browserState = await deepseekView.webContents.executeJavaScript(`({
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        hasChat: !!document.querySelector('[class*="chat"], [id*="chat"], textarea'),
      })`)
      writeLog(`[desktop] DeepSeek browser state ${JSON.stringify(browserState)}`)
    } catch (error) {
      writeLog(`[desktop] DeepSeek browser state unavailable: ${error.message}`)
    }
  } catch (error) {
    writeLog(`[desktop:error] Failed to attach DeepSeek browser view: ${error.stack || error.message}`)
    try {
      if (deepseekView) mainWindow.contentView.removeChildView(deepseekView)
    } catch { /* best effort cleanup */ }
    deepseekView = undefined
    deepseekVisible = false
    layoutHarnessView()
  }
}

async function captureComposedWindow(filename) {
  await new Promise(resolve => setTimeout(resolve, 2_000))
  const screenshotPath = path.resolve(filename)
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })

  const bounds = mainWindow.getBounds()
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    },
    fetchWindowIcons: false,
  })

  const source = sources.find(item => item.name === mainWindow.getTitle())
    ?? sources.find(item => /DeepSeek Harness/i.test(item.name))

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('The composed Electron window was not available to desktopCapturer.')
  }

  fs.writeFileSync(screenshotPath, source.thumbnail.toPNG())
  writeLog(`[desktop] QA screenshot saved to ${screenshotPath}`)
}

function waitForWindowState(predicate, description, timeoutMs = 5_000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        reject(new Error(`Window was destroyed while waiting for ${description}.`))
        return
      }

      if (predicate(mainWindow)) {
        resolve()
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${description}.`))
        return
      }

      setTimeout(check, 50)
    }

    check()
  })
}

async function clickTitleBarButton(buttonId) {
  const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
    const button = document.getElementById(${JSON.stringify(buttonId)})
    if (!button) return false
    button.click()
    return true
  })()`)

  if (!clicked) throw new Error(`Title-bar button was not found: ${buttonId}`)
}

async function exerciseWindowControls() {
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  if (mainWindow.isMinimized()) mainWindow.restore()

  await clickTitleBarButton('maximize')
  await waitForWindowState(window => window.isMaximized(), 'the custom maximize action')

  await clickTitleBarButton('maximize')
  await waitForWindowState(window => !window.isMaximized(), 'the custom restore action')

  await clickTitleBarButton('minimize')
  await waitForWindowState(window => window.isMinimized(), 'the custom minimize action')

  mainWindow.restore()
  mainWindow.show()
  await waitForWindowState(window => !window.isMinimized(), 'the restored test window')

  writeLog('[desktop] Window controls QA passed: maximize, restore, minimize')
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    thickFrame: true,
    roundedCorners: true,
    hasShadow: true,
    resizable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    icon: path.join(__dirname, 'build', 'deepseek-harness.svg'),
    backgroundColor: '#f6f7f9',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.removeMenu()
  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('resize', layoutHarnessView)
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)
  mainWindow.on('enter-full-screen', sendWindowState)
  mainWindow.on('leave-full-screen', sendWindowState)
  mainWindow.on('closed', () => {
    harnessView = undefined
    deepseekView = undefined
    mainWindow = undefined
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  await mainWindow.loadFile(path.join(__dirname, 'shell.html'))
  sendWindowState()

  try {
    browserConfig = readBrowserConfig()
    const url = await startHarness()
    writeLog(`[desktop] Loading ${url}`)
    await attachHarnessView(url)
    await attachDeepseekView()

    const rendererState = await harnessView.webContents.executeJavaScript(`({
      title: document.title,
      readyState: document.readyState,
      bodyTextLength: document.body?.innerText?.length ?? 0,
    })`)
    writeLog(`[desktop] Renderer ready ${JSON.stringify(rendererState)}`)

    if (process.env.DSH_DESKTOP_QA_BUTTON === '1') {
      try {
        await new Promise(resolve => setTimeout(resolve, 4_000))
        const found = await harnessView.webContents.executeJavaScript(`!!document.getElementById(${JSON.stringify(BROWSER_BUTTON_ID)})`)
        writeLog(`[desktop] QA button present in DOM: ${found}`)
        if (found) {
          await harnessView.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(BROWSER_BUTTON_ID)}).click()`)
          await new Promise(resolve => setTimeout(resolve, 3_000))
          writeLog(`[desktop] QA after click deepseekVisible=${deepseekVisible}`)
        }
      } catch (error) {
        writeLog(`[desktop:error] QA button test failed: ${error.message}`)
      }
    }

    const qaScreenshot = process.env.DSH_DESKTOP_QA_SCREENSHOT
    if (qaScreenshot) await captureComposedWindow(qaScreenshot)

    const qaWindowControls = process.env.DSH_DESKTOP_QA_WINDOW_CONTROLS === '1'
    if (qaWindowControls) await exerciseWindowControls()

    if (process.env.DSH_DESKTOP_QA_AUTO_QUIT === '1') {
      if (qaWindowControls) {
        writeLog('[desktop] Testing the custom close action')
        setTimeout(() => {
          if (!mainWindow || mainWindow.isDestroyed()) return
          void clickTitleBarButton('close').catch(error => {
            writeLog(`[desktop:error] Custom close QA failed: ${error.message}`)
            app.quit()
          })
        }, 250)
      } else {
        setTimeout(() => app.quit(), 250)
      }
    }
  } catch (error) {
    writeLog(`[desktop:error] ${error.stack || error.message}`)
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Startup failed',
      message: 'DeepSeek Harness could not be started.',
      detail: `${error.message}\n\nLogs: ${dataPath('logs')}`,
    })
    app.quit()
  }
}

setupWindowControlIpc()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setName(PRODUCT_NAME)
    app.setAppUserModelId('ai.deepseek.harness.desktop.unofficial')
    Menu.setApplicationMenu(null)
    return createWindow()
  }).catch(error => {
    writeLog(`[desktop:fatal] ${error.stack || error.message}`)
    dialog.showErrorBox('Startup failed', error.message)
    app.quit()
  })
}

app.on('before-quit', () => {
  quitting = true
  stopHarness()
})

app.on('window-all-closed', () => app.quit())
