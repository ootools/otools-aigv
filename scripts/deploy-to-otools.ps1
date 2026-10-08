# 把插件同步到 otools 仓库的 plugins 目录
# 用法：pwsh -File scripts/deploy-to-otools.ps1 [-OtoolsRoot "D:\Repos\xyito\otools\otools"]
#
# 同步后，vite.config.ts 会自动探测到宿主 SDK
# （<OtoolsRoot>/vendor/otools-plugin-sdk）并改用 SDK 的 shim 别名。
param(
  [string]$OtoolsRoot = "D:\Repos\xyito\otools\otools"
)

$ErrorActionPreference = "Stop"
$pluginRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $OtoolsRoot "plugins\otools-aigv"

if (-not (Test-Path (Join-Path $OtoolsRoot "vendor\otools-plugin-sdk\src\index.ts"))) {
  Write-Error "未找到 otools 仓库：$OtoolsRoot（可用 -OtoolsRoot 指定其它路径）"
}

if (Test-Path $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

# 复制源码与构建产物（排除 .git、node_modules、rust target）
$exclude = @(".git", "node_modules", "target", "docs", "e2e")
Get-ChildItem -LiteralPath $pluginRoot -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
}

Write-Host "已同步到 $target"
Write-Host "在 otools 中执行：pnpm --dir plugins/otools-aigv install ; pnpm --dir plugins/otools-aigv build"
