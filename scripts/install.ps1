[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot '../skills/sec-diagrams/scripts/install.ps1') -Force:$Force
exit $LASTEXITCODE
