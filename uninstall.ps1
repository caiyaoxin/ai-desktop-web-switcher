<#
.SYNOPSIS
  DeepSeek Harness Desktop 内置网页版浏览器补丁 —— 一键还原脚本。

.DESCRIPTION
  用 install.ps1 生成的 app.asar.bak 备份还原原版 app.asar，撤销补丁。

.PARAMETER AsarPath
  可选。app.asar 的完整路径。默认自动探测标准安装位置。
#>
[CmdletBinding()]
param(
  [string]$AsarPath = ''
)

$ErrorActionPreference = 'Stop'

if ($AsarPath -eq '') {
  $AsarPath = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness Desktop\resources\app.asar'
}
if (-not (Test-Path $AsarPath)) {
  Write-Host "[-] 未找到 app.asar：$AsarPath" -ForegroundColor Red
  exit 1
}
$AsarPath = (Resolve-Path $AsarPath).Path

$backup = "$AsarPath.bak"
if (-not (Test-Path $backup)) {
  Write-Host "[-] 未找到备份文件：$backup" -ForegroundColor Red
  Write-Host "    无法还原（可能从未安装，或备份已删除）。" -ForegroundColor Red
  exit 1
}

$running = Get-Process -Name 'DeepSeek Harness Desktop' -ErrorAction SilentlyContinue
if ($running) {
  Write-Warning "检测到 DeepSeek Harness Desktop 正在运行，请先关闭应用。"
  exit 1
}

Write-Host "[*] 从备份还原 app.asar..." -ForegroundColor Cyan
Copy-Item $backup $AsarPath -Force
Write-Host "[+] 还原完成，原版已恢复。" -ForegroundColor Green

$config = Join-Path $env:APPDATA 'deepseek-harness-desktop\deepseek-browser.json'
if (Test-Path $config) {
  Remove-Item $config -Force
  Write-Host "[+] 已删除配置：$config" -ForegroundColor Green
}
