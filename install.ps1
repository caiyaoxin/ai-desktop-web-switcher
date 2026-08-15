<#
.SYNOPSIS
  DeepSeek Harness Desktop 内置网页版浏览器补丁 —— 一键安装脚本。

.DESCRIPTION
  将增强版 main.js / preload.js 写入已安装的 DeepSeek Harness Desktop 的
  app.asar 中，从而在左侧栏新增一个"打开 DeepSeek 网页版"按钮。
  点击按钮会在主区域打开 chat.deepseek.com，简单提问无需消耗 API token。

.PARAMETER AsarPath
  可选。app.asar 的完整路径。默认自动探测标准安装位置：
  $env:LOCALAPPDATA\Programs\DeepSeek Harness Desktop\resources\app.asar

.PARAMETER Label
  可选。按钮显示名称。默认 "DeepSeek 网页版"。
  也可在安装后编辑 %APPDATA%\deepseek-harness-desktop\deepseek-browser.json 自定义。

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Label "网页版免费用"
  .\install.ps1 -AsarPath "D:\MyApp\resources\app.asar"
#>
[CmdletBinding()]
param(
  [string]$AsarPath = '',
  [string]$Label = 'DeepSeek 网页版',
  [string]$Url = 'https://chat.deepseek.com/'
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) {
  Write-Host "[*] $msg" -ForegroundColor Cyan
}
function Write-Ok([string]$msg) {
  Write-Host "[+] $msg" -ForegroundColor Green
}
function Write-Err([string]$msg) {
  Write-Host "[-] $msg" -ForegroundColor Red
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mainJs = Join-Path $scriptDir 'main.js'
$preloadJs = Join-Path $scriptDir 'preload.js'

Write-Step "检查补丁文件..."
if (-not (Test-Path $mainJs)) { Write-Err "找不到 main.js（应位于本脚本同目录）"; exit 1 }
if (-not (Test-Path $preloadJs)) { Write-Err "找不到 preload.js（应位于本脚本同目录）"; exit 1 }

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

# 检查应用是否正在运行（替换运行中文件在 Windows 上可能被占用）
$running = Get-Process -Name 'DeepSeek Harness Desktop' -ErrorAction SilentlyContinue
if ($running) {
  Write-Warning "检测到 DeepSeek Harness Desktop 正在运行。"
  Write-Warning "请先关闭应用，再重新运行本脚本；否则替换可能失败。"
  $answer = Read-Host "是否已关闭应用？(y/N)"
  if ($answer -notin @('y', 'Y')) { Write-Err "已取消。"; exit 1 }
}

# 备份
$backup = "$AsarPath.bak"
Write-Step "备份原 app.asar -> app.asar.bak"
if (Test-Path $backup) {
  Write-Warning "已存在备份 $backup，跳过备份（保留原有备份）。"
} else {
  Copy-Item $AsarPath $backup -Force
  Write-Ok "备份完成：$backup"
}

# 临时工作目录
$work = Join-Path $env:TEMP "dsh-web-browser-patch"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
$extracted = Join-Path $work 'extracted'
New-Item -ItemType Directory -Force -Path $extracted | Out-Null

# 解包 asar（使用 npx @electron/asar；离线时可改用已安装的 node_modules 内 asar）
Write-Step "解包 app.asar..."
$asarOk = $false
$npx = Get-Command npx -ErrorAction SilentlyContinue
if ($npx) {
  try {
    & npx --yes @electron/asar extract $AsarPath $extracted *> $null
    if ($LASTEXITCODE -eq 0) { $asarOk = $true }
  } catch { $asarOk = $false }
}
if (-not $asarOk) {
  # 回退：尝试使用 DeepSeek Harness Desktop 自带的 node + 本地 asar（如有）
  $nodeExe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness Desktop\resources\harness\runtime\node.exe'
  if (Test-Path $nodeExe) {
    Write-Step "使用自带的 node 尝试解包..."
    try {
      & $nodeExe -e "require('@electron/asar')" *> $null
    } catch {}
  }
  Write-Err "无法解包 asar。请确认已安装 Node.js 且可联网（脚本需 npx 拉取 @electron/asar）。"
  exit 1
}
Write-Ok "解包完成"

# 覆盖补丁文件
Write-Step "写入补丁文件 main.js / preload.js..."
Copy-Item $mainJs (Join-Path $extracted 'main.js') -Force
Copy-Item $preloadJs (Join-Path $extracted 'preload.js') -Force
Write-Ok "已写入"

# 重新打包
Write-Step "重新打包 app.asar..."
$packed = Join-Path $work 'app.asar'
& npx --yes @electron/asar pack $extracted $packed *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Err "打包失败。原 app.asar 未被修改，备份仍在：$backup"
  exit 1
}
Write-Ok "打包完成"

# 替换
Write-Step "替换 app.asar..."
Copy-Item $packed $AsarPath -Force
Write-Ok "替换完成"

# 写入用户配置（按钮名称可自定义）
Write-Step "写入用户配置 deepseek-browser.json..."
$userData = Join-Path $env:APPDATA 'deepseek-harness-desktop'
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$configPath = Join-Path $userData 'deepseek-browser.json'
$config = @{ label = $Label; url = $Url } | ConvertTo-Json
Set-Content -Path $configPath -Value $config -Encoding UTF8
Write-Ok "配置已写入：$configPath"
Write-Ok "按钮名称：$Label；网页地址：$Url"

# 清理临时目录
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Ok "安装完成！请重新启动 DeepSeek Harness Desktop。"
Write-Host "   左侧栏会出现「$Label」按钮，点击打开网页版（不消耗 API token）。" -ForegroundColor Yellow
Write-Host "   如需改名称/网址，编辑 $configPath 后重启。" -ForegroundColor Yellow
Write-Host "   如需还原，运行 uninstall.ps1。" -ForegroundColor Yellow
