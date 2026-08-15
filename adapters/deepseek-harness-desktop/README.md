# deepseek-harness-desktop adapter

本适配器把 [ai-desktop-web-switcher](../../README.md) 的通用核心模块接入
[deepseek-harness-desktop](https://github.com/cc1252/deepseek-harness-desktop)
（第三方 Electron 壳）。

## 文件

- `main.js` —— 在原版 main.js 基础上，新增 `attachWebSwitcher()`：创建 `createWebSwitcher`
  并挂载网页版视图（DeepSeek Harness 官方界面 + chat.deepseek.com 网页版并存）。
- `preload.js` —— 原窗口控制桥 + `window.webSwitcher` 桥。

## 关键集成点

原版 main.js 里只需两处改动：

1. 顶部引入核心模块：

   ```js
   const { createWebSwitcher } = require('./lib/web-switcher.js')
   ```

2. `attachHarnessView(url)` 完成后调用：

   ```js
   webSwitcher = createWebSwitcher({
     mainWindow,
     hostView: harnessView,       // 宿主 UI 视图（用于注入侧栏按钮）
     url: 'https://chat.deepseek.com/',
     label: 'DeepSeek 网页版',
     titleBarHeight: 42,
     configFile: dataPath('deepseek-browser.json'),
     log: writeLog,
   })
   await webSwitcher.attach()
   ```

其余（浏览器视图创建、切换、侧栏按钮注入、浅色主题、配置读写）全部由
`lib/web-switcher.js` 通用模块负责。

## 按钮名称 / 网址自定义

安装后编辑 `%APPDATA%\deepseek-harness-desktop\deepseek-browser.json`：

```json
{ "label": "DeepSeek 网页版", "url": "https://chat.deepseek.com/" }
```
