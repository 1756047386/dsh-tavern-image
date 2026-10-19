[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $Tag, [Parameter(Mandatory = $true)][string] $SourceZipPath, [Parameter(Mandatory = $true)][string] $InstallZipPath, [Parameter(Mandatory = $true)][string] $OutputDirectory)
$ErrorActionPreference = 'Stop'
$SourceZipPath = [IO.Path]::GetFullPath($SourceZipPath)
$InstallZipPath = [IO.Path]::GetFullPath($InstallZipPath)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if ([IO.Path]::GetFileName($SourceZipPath) -cne 'dsh-tavern-image-source.zip') { throw '源码资产必须命名为 dsh-tavern-image-source.zip。' }
if ([IO.Path]::GetFileName($InstallZipPath) -cne 'dsh-tavern-image-install.zip') { throw '安装资产必须命名为 dsh-tavern-image-install.zip。' }
foreach ($path in @($SourceZipPath, $InstallZipPath)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "发布资产不存在：$path" } }
$checksumPath = Join-Path $OutputDirectory 'SHA256SUMS'
if (Test-Path -LiteralPath $checksumPath) { throw "校验文件已存在，不会覆盖：$checksumPath" }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($SourceZipPath)
try {
  $entry = $archive.GetEntry('dsh-tavern-image/package.json')
  if (-not $entry) { throw '源码 ZIP 缺少 dsh-tavern-image/package.json。' }
  $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
  try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
if (-not $manifest.version -or $Tag -cne "v$($manifest.version)") { throw "Git tag '$Tag' 必须严格等于源码 package.json 版本对应的 v$($manifest.version)。" }
$compatibility = $manifest.dsh.compatibility
if (-not $compatibility -or -not ($compatibility.PSObject.Properties.Name -contains 'tavernApiVersion')) { throw '源码 package.json 必须声明 dsh.compatibility.tavernApiVersion 最低宿主 API 数字。' }
$apiValue = $compatibility.tavernApiVersion
if ($apiValue -isnot [ValueType] -or $apiValue -is [bool]) { throw 'dsh.compatibility.tavernApiVersion 必须是 JSON 数字类型的安全整数。' }
$minimumApi = [double]$apiValue
if ([double]::IsNaN($minimumApi) -or [double]::IsInfinity($minimumApi) -or $minimumApi -lt 1 -or $minimumApi -gt 9007199254740991 -or [Math]::Truncate($minimumApi) -ne $minimumApi) {
  throw 'dsh.compatibility.tavernApiVersion 必须是 1 到 9007199254740991 之间的安全整数。'
}
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$algorithm = [Security.Cryptography.SHA256]::Create()
try {
  $lines = foreach ($path in @($SourceZipPath, $InstallZipPath)) {
    $stream = [IO.File]::OpenRead($path)
    try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose() }
    "$hash  $([IO.Path]::GetFileName($path))"
  }
} finally { $algorithm.Dispose() }
[IO.File]::WriteAllText($checksumPath, ($lines -join [Environment]::NewLine) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Host "已验证 tag $Tag、最低 Tavern API $minimumApi，并生成 SHA256SUMS。"
