$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('refract-glass-policy-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$policyPath = [Security.SecurityElement]::Escape([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src/GlassPolicy.cs')))
$casesPath = [Security.SecurityElement]::Escape((Join-Path $PSScriptRoot 'GlassPolicyTests.cs.txt'))
$project = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup>
  <ItemGroup><Compile Include="$policyPath" /><Compile Include="$casesPath" /></ItemGroup>
</Project>
"@
[IO.File]::WriteAllText((Join-Path $testRoot 'GlassPolicyTests.csproj'), $project)
dotnet run --project (Join-Path $testRoot 'GlassPolicyTests.csproj') --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'Glass policy checks failed.' }
