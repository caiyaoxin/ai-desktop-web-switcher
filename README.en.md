# DeepSeek Harness Web Browser (built-in web-app patch)

> Adds a "Web" button to the left sidebar of DeepSeek Harness Desktop. Click it to open
> [chat.deepseek.com](https://chat.deepseek.com/) in the main area. **Ask quick questions on
> the web version — no API token consumed.**

[中文说明](README.md)

## Why

DeepSeek Harness uses the API (token-billed). But plenty of quick questions — a translation,
a quick calculation, small talk — can be handled by the official web chat for free. This patch
keeps both side by side:

- A sidebar button styled like "New Chat" (label customizable)
- Click → the web version opens in the main area
- Click again, or click "New Chat" → it closes and returns to your Harness conversation
- The web version has its own login and session, fully isolated from your API chats

## How it works

`chat.deepseek.com` sends `Content-Security-Policy: frame-ancestors 'none'`, so a plain
`<iframe>` is blocked by the browser. This patch therefore adds a native Electron
`WebContentsView` in the desktop shell's main process — native views are not subject to that
CSP, and it is the same mechanism the Harness GUI itself already uses.

Only two files change:

- `main.js` — browser view, toggle logic, sidebar button injection
- `preload.js` — `toggleDeepseek` bridge API

No Harness core package (`@deepseek-ai/*`) is modified, and uninstall fully restores the original.

## Install

> Prerequisites: [DeepSeek Harness Desktop](https://github.com/cc1252/deepseek-harness-desktop)
> installed, plus Node.js on PATH (the script uses `npx @electron/asar`).

1. Clone:

   ```powershell
   git clone https://github.com/<your-username>/dsh-web-browser.git
   cd dsh-web-browser
   ```

2. Close DeepSeek Harness Desktop if it is running.

3. Run:

   ```powershell
   .\install.ps1
   ```

   Optional:

   ```powershell
   .\install.ps1 -Label "Free Web Chat" -Url "https://chat.deepseek.com/"
   .\install.ps1 -AsarPath "D:\MyApp\resources\app.asar"
   ```

4. Restart DeepSeek Harness Desktop. The new button appears in the sidebar.

## Customize label / URL

Edit (auto-created on first run):

```
%APPDATA%\deepseek-harness-desktop\deepseek-browser.json
```

```json
{
  "label": "DeepSeek 网页版",
  "url": "https://chat.deepseek.com/"
}
```

Restart to apply.

## Uninstall

```powershell
.\uninstall.ps1
```

Restores the original `app.asar` from the `app.asar.bak` created during install.

## FAQ

**No button?** Confirm the install script printed "安装完成" and that you restarted the app.
When the sidebar is collapsed the button shows as an icon.

**Login page?** Normal. The web version uses its own account (unrelated to your API key); its
session is stored separately.

**Not light-themed?** The patch forces `nativeTheme` light to match the host app. If the web
app has its own dark-mode toggle, switch it off inside the web app.

**Conflicts with API chats?** No. The web view uses an isolated `partition`; login state and
cookies are fully separate from Harness.

## License

[MIT](LICENSE)

## Disclaimer

Unofficial patch for the third-party open-source shell
[deepseek-harness-desktop](https://github.com/cc1252/deepseek-harness-desktop) (MIT). Not
affiliated with DeepSeek. The web version is an official DeepSeek service; its availability
and pricing are subject to DeepSeek.
