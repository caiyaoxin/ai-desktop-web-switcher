<#
.SYNOPSIS
  ai-desktop-web-switcher —— 给 AI 桌面客户端加「网页版并排」入口的一键安装脚本。

.DESCRIPTION
  解包目标应用的 app.asar，写入 lib/ 核心模块与所选适配器的 main.js/preload.js，
  重新打包。安装后目标应用左侧栏出现「网页版」按钮，点击打开网页版聊天，
  简单提问无需消耗 API token。

.PARAMETER AsarPath
  可选。app.asar 完整路径。默认自动探测 DeepSeek Harness Desktop 标准安装位置。

.PARAMETER Adapter
  可选。适配器目录名（adapters/ 下）。默认 deepseek-harness-desktop。

.PARAMETER Label
  可选。按钮显示名称。默认由适配器决定（"DeepSeek 网页版"）。

.PARAMETER Url
  可选。网页版地址。默认由适配器决定（https://chat.deepseek.com/）。

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Label "网页版免费" -Url "https://chat.deepseek.com/"
  .\install.ps1 -AsarPath "D:\MyApp\resources\app.asar"
#>
[CmdletBinding()]
param(
  [string]$AsarPath = '',
  [string]$Adapter = 'deepseek-harness-desktop',
  [string]$Label = '',
  [string]$Url = ''
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Err([string]$msg) { Write-Host "[-] $msg" -ForegroundColor Red }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$libDir = Join-Path $scriptDir 'lib'
$adapterDir = Join-Path $scriptDir 'adapters'
$selectedAdapterDir = Join-Path $adapterDir $Adapter

Write-Step "检查文件..."
if (-not (Test-Path (Join-Path $libDir 'web-switcher.js'))) {
  Write-Err "缺少 lib/web-switcher.js"; exit 1
}
if (-not (Test-Path $selectedAdapterDir)) {
  Write-Err "适配器不存在：$selectedAdapterDir"; exit 1
}
$adapterMain = Join-Path $selectedAdapterDir 'main.js'
$adapterPreload = Join-Path $selectedAdapterDir 'preload.js'
if (-not (Test-Path $adapterMain)) { Write-Err "适配器缺少 main.js"; exit 1 }
if (-not (Test-Path $adapterPreload)) { Write-Err "适配器缺少 preload.js"; exit 1 }

Write-Step "定位 app.asar..."
if ($AsarPath -eq '') {
  $AsarPath = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness Desktop\resources\app.asar'
}
if (-not (Test-Path $AsarPath)) {
  Write-Err "未找到 app.asar：$AsarPath"
  Write-Err "请用 -AsarPath 参数指定路径。"
  exit 1
}
$AsarPath = (Resolve-Path $AsarPath).Path
Write-Ok "找到 app.asar：$AsarPath"

$running = Get-Process -Name 'DeepSeek Harness Desktop' -ErrorAction SilentlyContinue
if ($running) {
  Write-Warning "检测到应用正在运行。请先关闭，再重新运行本脚本。"
  $answer = Read-Host "是否已关闭？(y/N)"
  if ($answer -notin @('y', 'Y')) { Write-Err "已取消。"; exit 1 }
}

$backup = "$AsarPath.bak"
Write-Step "备份原 app.asar..."
if (Test-Path $backup) {
  Write-Warning "已存在备份，跳过（保留原备份）。"
} else {
  Copy-Item $AsarPath $backup -Force
  Write-Ok "备份完成：$backup"
}

$work = Join-Path $env:TEMP "ai-desktop-web-switcher"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
$extracted = Join-Path $work 'extracted'
New-Item -ItemType Directory -Force -Path $extracted | Out-Null

Write-Step "解包 app.asar..."
$npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npx) {
  Write-Err "未找到 npx。请先安装 Node.js。"
  exit 1
}
& npx --yes @electron/asar extract $AsarPath $extracted *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Err "解包失败。原文件未修改，备份仍在：$backup"
  exit 1
}
Write-Ok "解包完成"

Write-Step "写入核心模块 lib/ 与适配器 $Adapter ..."
New-Item -ItemType Directory -Force -Path (Join-Path $extracted 'lib') | Out-Null
Copy-Item (Join-Path $libDir 'web-switcher.js') (Join-Path $extracted 'lib\web-switcher.js') -Force
Copy-Item $adapterMain (Join-Path $extracted 'main.js') -Force
Copy-Item $adapterPreload (Join-Path $extracted 'preload.js') -Force
Write-Ok "已写入"

Write-Step "重新打包 app.asar..."
$packed = Join-Path $work 'app.asar'
& npx --yes @electron/asar pack $extracted $packed *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Err "打包失败。原 app.asar 未修改，备份仍在：$backup"
  exit 1
}
Write-Ok "打包完成"

Write-Step "替换 app.asar..."
Copy-Item $packed $AsarPath -Force
Write-Ok "替换完成"

# 用户配置（按钮名称/网址可自定义）
Write-Step "写入用户配置 deepseek-browser.json..."
$userData = Join-Path $env:APPDATA 'deepseek-harness-desktop'
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$configPath = Join-Path $userData 'deepseek-browser.json'
$defaultLabel = if ($Label) { $Label } else { 'DeepSeek 网页版' }
$defaultUrl = if ($Url) { $Url } else { 'https://chat.deepseek.com/' }
$existing = $null
if (Test-Path $configPath) {
  try { $existing = Get-Content $configPath -Raw | ConvertFrom-Json } catch { $existing = $null }
}
$config = @{
  label = if ($Label) { $Label } elseif ($existing.label) { $existing.label } else { $defaultLabel }
  url   = if ($Url) { $Url } elseif ($existing.url) { $existing.url } else { $defaultUrl }
} | ConvertTo-Json
Set-Content -Path $configPath -Value $config -Encoding UTF8
Write-Ok "配置已写入：$configPath"

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Ok "安装完成！请重新启动应用。"
Write-Host "   左侧栏会出现「$($config.label)」按钮，点击打开网页版（不消耗 API token）。" -ForegroundColor Yellow
Write-Host "   改名称/网址：编辑 $configPath 后重启。" -ForegroundColor Yellow
Write-Host "   还原：运行 uninstall.ps1。" -ForegroundColor Yellow
