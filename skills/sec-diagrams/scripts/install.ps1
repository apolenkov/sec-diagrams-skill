[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$installArgs = @()
if ($Force) { $installArgs += '--force' }
& node (Join-Path $PSScriptRoot 'install.mjs') @installArgs
exit $LASTEXITCODE
