# 移植指南：接入其他 AI 桌面客户端

`lib/web-switcher.js` 是**零依赖（仅 Electron）**的通用核心模块。任何 Electron AI 桌面客户端
都能接入，只需三步。

## 前置理解

- 你的应用必须用 `WebContentsView`（或等价机制）承载自己的 UI——绝大多数现代 Electron 壳都如此。
- 网页版聊天站（chat.deepseek.com、ChatGPT 等）大多发 `frame-ancestors 'none'`，所以不能用 iframe，
  必须用原生 `WebContentsView`。这正是本模块存在的原因。

## 三步接入

### 1. 引入模块

把 `lib/web-switcher.js` 复制进你的项目，主进程里：

```js
const { createWebSwitcher } = require('./lib/web-switcher.js')
```

### 2. 在宿主视图创建后挂载

```js
let switcher = createWebSwitcher({
  mainWindow,             // BrowserWindow
  hostView,               // 你承载主 UI 的 WebContentsView
  url: 'https://chat.deepseek.com/',   // 网页版地址
  label: '网页版',                     // 侧栏按钮文字
  anchorMatch: /新对话|New Chat/i,     // 匹配宿主「新对话」按钮文字的正则
  titleBarHeight: 42,                  // 你窗口顶部保留高度
  configFile: '/path/to/config.json',  // 可选，用户自定义 {label,url}
  log: console.log,                    // 可选
})
await switcher.attach()
```

### 3. 暴露 preload 桥

宿主 UI 的 preload 里加：

```js
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('webSwitcher', Object.freeze({
  toggle: width => ipcRenderer.send('web-switcher:toggle', width),
  onChanged: cb => {
    const l = (_e, v) => cb(v)
    ipcRenderer.on('web-switcher:changed', l)
    return () => ipcRenderer.removeListener('web-switcher:changed', l)
  },
}))
```

（参考 `lib/preload.js`。）

## 关键配置项

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `url` | 网页版地址 | `https://chat.deepseek.com/` |
| `label` | 按钮文字 | `Web` |
| `anchorMatch` | 找「新对话」按钮的正则 | `/新对话\|新建对话\|New Chat\|New Session\|新会话/i` |
| `titleBarHeight` | 顶部保留高度 | `0` |
| `defaultSidebarWidth` | 侧栏宽度兜底值 | `240` |
| `partition` | 独立会话分区 | `persist:web-switcher` |
| `configFile` | 用户配置 JSON 路径 | 不启用 |
| `forceLightTheme` | 强制浅色主题 | `true` |

## 适配器目录约定

在 `adapters/<客户端名>/` 下放该客户端接入后的完整 `main.js` 和 `preload.js`，
并写一个 README 说明集成点。`install.ps1` 通过 `-Adapter` 参数选择。
