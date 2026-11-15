# 直连 github.com 会被偶尔屏蔽（DNS 常解析到不通的节点），这里轮流用几个可用 IP 直连推送。
# 用法： powershell -File scripts\gh-push.ps1            （推当前分支到 origin/main）
#        powershell -File scripts\gh-push.ps1 -Branch main
param(
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [string[]]$Ips = @("140.82.114.3", "140.82.113.3", "20.27.177.113", "4.237.22.38", "140.82.112.3")
)

$ErrorActionPreference = "Continue"
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  foreach ($ip in $Ips) {
    Write-Host "尝试 github.com via $ip ..."
    git -c "http.curloptResolve=github.com:443:$ip" push $Remote "HEAD:$Branch" 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -eq 0) {
      Write-Host "推送成功（节点 $ip）"
      exit 0
    }
  }
  Write-Host "所有节点都失败：请检查网络，或换一个 IP 列表重试。"
  exit 1
} finally {
  Pop-Location
}
