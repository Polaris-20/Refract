param([string]$OutputDirectory = "", [switch]$NoRestore)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $projectRoot "dist\REFRACT" }
$targetDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if ((Test-Path -LiteralPath $targetDirectory) -and @(Get-ChildItem -LiteralPath $targetDirectory -Force).Count -gt 0) {
    throw "Publish into an empty directory so personal data and old build files cannot enter the package."
}
$publishOptions = @()
if ($NoRestore) { $publishOptions += '--no-restore' }
& dotnet publish (Join-Path $projectRoot "Refract.csproj") -c Release --no-self-contained -p:RestoreLockedMode=true -p:PlatformTarget=x64 -p:DebugType=None -p:DebugSymbols=false "-p:PathMap=$projectRoot=/_/Refract" -o $targetDirectory @publishOptions
if ($LASTEXITCODE -ne 0) { throw "Build failed." }
New-Item -ItemType File -Path (Join-Path $targetDirectory "portable.flag") -Force | Out-Null
foreach ($file in @("LICENSE", "README.md", "USER_GUIDE.md", "PRIVACY.md", "CONTRIBUTING.md", "THIRD_PARTY_NOTICES.md")) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $targetDirectory -Force }
Copy-Item -LiteralPath (Join-Path $projectRoot "third-party") -Destination $targetDirectory -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "docs") -Destination $targetDirectory -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "examples") -Destination $targetDirectory -Recurse -Force
Write-Output "Portable build ready: $targetDirectory"
