# DeepSeek Harness Web Browser（内置网页版浏览器补丁）

> 给 DeepSeek Harness Desktop 加一个左侧栏「网页版」按钮，点击即在主区域打开
> [chat.deepseek.com](https://chat.deepseek.com/)。**简单提问用网页版，不消耗 API token。**

[English](README.en.md)

## 为什么要这个？

DeepSeek Harness 走的是 API（按 token 计费）。但很多简单问题——比如翻译个词、算个数、闲聊两句——
用官方网页版就行，**免费、不消耗 API 额度**。这个补丁让网页版和 Harness 并存：

- 左侧栏新增一个按钮（样式与「新对话」一致，名称可自定义）
- 点击 → 主区域打开网页版浏览器
- 再点按钮或点「新对话」→ 关闭网页版，回到 Harness 对话
- 网页版独立登录、独立会话，和 API 对话互不干扰

## 效果

| 操作 | 结果 |
| --- | --- |
| 点左侧栏「DeepSeek 网页版」按钮 | 主区域打开网页版（浅色，跟随软件主题） |
| 网页版打开时点「新对话」 | 自动关闭网页版并回到新对话 |
| 再点一次按钮 | 关闭网页版 |

## 原理

`chat.deepseek.com` 响应头带 `Content-Security-Policy: frame-ancestors 'none'`，
**普通 `<iframe>` 会被浏览器直接拦截**。因此本补丁在桌面壳（Electron 主进程）中新增一个
原生 `WebContentsView` 来加载网页版——原生视图不受网页 CSP 限制，和 Harness 官方界面
本身就是用 `WebContentsView` 加载的方式一致。

补丁只改两个文件：

- `main.js` —— 新增浏览器视图、切换逻辑、侧栏按钮注入
- `preload.js` —— 新增 `toggleDeepseek` 桥接 API

不修改任何 Harness 核心包（`@deepseek-ai/*`），卸载可完整还原。

## 安装

> 前置：已安装 [DeepSeek Harness Desktop](https://github.com/cc1252/deepseek-harness-desktop)，
> 且本机有 Node.js（脚本用 `npx @electron/asar` 解包/重打包）。

1. 克隆本仓库：

   ```powershell
   git clone https://github.com/<你的用户名>/dsh-web-browser.git
   cd dsh-web-browser
   ```

2. 关闭正在运行的 DeepSeek Harness Desktop。

3. 运行安装脚本：

   ```powershell
   .\install.ps1
   ```

   可选参数：

   ```powershell
   .\install.ps1 -Label "网页版免费" -Url "https://chat.deepseek.com/"
   .\install.ps1 -AsarPath "D:\MyApp\resources\app.asar"
   ```

4. 重新启动 DeepSeek Harness Desktop，左侧栏出现新按钮。

## 自定义按钮名称 / 网址

安装后编辑配置文件（首次运行自动生成）：

```
%APPDATA%\deepseek-harness-desktop\deepseek-browser.json
```

```json
{
  "label": "DeepSeek 网页版",
  "url": "https://chat.deepseek.com/"
}
```

改完重启应用生效。

## 卸载 / 还原

```powershell
.\uninstall.ps1
```

脚本用安装时自动生成的 `app.asar.bak` 还原原版。

## 常见问题

**Q：按钮没出现？**
确认安装脚本输出「安装完成」，且重启了应用。若左侧栏是折叠态，按钮会显示为图标。

**Q：网页版显示登录页？**
正常。网页版需要自己的账号登录（和 API key 无关），登录一次后会话独立保存。

**Q：颜色不是浅色？**
补丁已强制 `nativeTheme` 为浅色以跟随软件主题；若网页版内部有独立深色开关，需在网页版设置里关闭。

**Q：和 API 对话会冲突吗？**
不会。网页版是独立 `partition` 会话，登录态、Cookie 与 Harness 完全隔离。

## 许可证

[MIT](LICENSE)

## 免责声明

本项目是给第三方开源桌面壳 [deepseek-harness-desktop](https://github.com/cc1252/deepseek-harness-desktop)
（MIT 协议）的非官方功能补丁，与 DeepSeek 官方无关。网页版为 DeepSeek 官方服务，其可用性与计费政策以官方为准。
