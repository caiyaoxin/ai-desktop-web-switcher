<p align="center">
  <img src="docs/logo.svg" alt="AI Desktop Web Switcher" width="96" height="96">
</p>

<h1 align="center">AI Desktop Web Switcher</h1>

<p align="center">
  <strong>给 Electron AI 桌面客户端加一个「网页版并排」入口，简单提问不花 API token。</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://github.com/caiyaoxin/ai-desktop-web-switcher/stargazers"><img src="https://img.shields.io/github/stars/caiyaoxin/ai-desktop-web-switcher?style=social" alt="Stars"></a>
  <a href="https://github.com/caiyaoxin/ai-desktop-web-switcher"><img src="https://img.shields.io/badge/platform-Windows-0078D6.svg" alt="Platform"></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> · <a href="PORTING.md">移植指南</a>
</p>

## 这是什么

AI 桌面端走 API 按 token 计费；但很多简单问题——翻译、算数、闲聊——网页版免费就够。
本工具在客户端左侧栏加一个按钮，点击就在主区域打开网页版聊天，和 API 对话并存、一键切换、互不干扰。

## 演示

<p align="center">
  <img src="docs/demo.gif" alt="演示动画" width="720">
</p>

左侧栏点击「DeepSeek 网页版」→ 主区域打开网页版；再点按钮或点「新对话」→ 关闭，回到原对话。

## 特性

- 🧭 **左侧栏按钮**——样式与「新对话」一致，名称/网址可自定义
- ⚡ **一键切换**——点击开、再点关、点「新对话」自动关，回到原对话
- 🎨 **跟随主题**——浅色跟随软件，不刺眼
- 🔒 **会话隔离**——网页版独立登录、独立 Cookie，与 API 对话互不干扰
- 🧩 **通用核心**——零依赖 Electron 模块，可接入任何 Electron AI 客户端（见[移植指南](PORTING.md)）
- ♻️ **可完整还原**——一键卸载，不残留

## 为什么不用 iframe？

`chat.deepseek.com`（以及多数 AI 网页版）返回 `Content-Security-Policy: frame-ancestors 'none'`，
**普通 `<iframe>` 会被浏览器直接拦截**。本工具在桌面壳主进程里创建原生 `WebContentsView`
——原生视图不受网页 CSP 限制，和这些客户端本身加载官方界面的机制完全一致。

## 快速开始

> 前置：Windows、Node.js（脚本用 `npx @electron/asar`）。

```powershell
git clone https://github.com/caiyaoxin/ai-desktop-web-switcher.git
cd ai-desktop-web-switcher
.\install.ps1                       # 默认接入 deepseek-harness-desktop
.\install.ps1 -Label "网页版免费"     # 自定义按钮名称
```

重启你的 AI 桌面客户端，左侧栏出现「网页版」按钮。

## 支持的客户端

| 适配器 | 状态 | 说明 |
| --- | --- | --- |
| [deepseek-harness-desktop](adapters/deepseek-harness-desktop) | ✅ 开箱即用 | 第三方 Electron 壳，官方 `@deepseek-ai/dsh` 本地服务 |
| 其他 Electron AI 客户端 | 🧩 见[移植指南](PORTING.md) | 三步接入，欢迎 PR 贡献适配器 |

## 自定义

编辑用户配置（首次安装自动生成）：

```
%APPDATA%\deepseek-harness-desktop\deepseek-browser.json
```

```json
{ "label": "DeepSeek 网页版", "url": "https://chat.deepseek.com/" }
```

## 卸载

```powershell
.\uninstall.ps1
```

## 目录结构

```
├── lib/
│   ├── web-switcher.js    # 通用核心模块（零依赖，仅 Electron）
│   └── preload.js         # 通用 preload 桥
├── adapters/
│   └── deepseek-harness-desktop/
│       ├── main.js        # 接入后的完整 main.js
│       ├── preload.js     # 接入后的完整 preload
│       └── README.md
├── install.ps1            # 一键安装
├── uninstall.ps1          # 一键还原
└── PORTING.md             # 移植到其他客户端指南
```

## 常见问题

**按钮没出现？** 确认安装脚本输出「安装完成」且重启了应用。侧栏折叠时按钮显示为图标。

**网页版显示登录页？** 正常。网页版需要独立账号登录（与 API key 无关），会话独立保存。

**会冲突吗？** 不会。网页版用独立 `partition`，登录态/Cookie 与主客户端完全隔离。

## 许可证

[MIT](LICENSE)

## 免责声明

本工具是通用功能增强，不绕过任何应用的授权或计费机制；网页版服务归属各自官方，可用性与
计费政策以官方为准。本项目与 DeepSeek 等任何 AI 厂商无隶属关系。
