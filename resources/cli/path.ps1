# Adds or removes one folder on the per-user PATH without touching anything
# else (spec 7.2): the value stays REG_EXPAND_SZ with its %VARS% unexpanded, the
# compare ignores case and a trailing backslash, and repeating a call is a no-op.
# Pure NSIS string handling is not used because it truncates PATHs over 1024
# characters; [Environment]::SetEnvironmentVariable is not used because it
# flattens REG_EXPAND_SZ to REG_SZ.
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Dir,
  [string]$Key = 'Environment'
)
$ErrorActionPreference = 'Stop'
$reg = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Key)
try {
  $opts = [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
  $current = [string]$reg.GetValue('Path', '', $opts)
  $norm = { param([string]$p) $p.Trim().TrimEnd('\').ToLowerInvariant() }
  $target = & $norm $Dir
  $parts = @($current -split ';' | Where-Object { $_.Trim() -ne '' })
  $present = @($parts | Where-Object { (& $norm $_) -eq $target }).Count -gt 0
  $changed = $false
  if ($Action -eq 'add' -and -not $present) {
    $parts += $Dir.TrimEnd('\')
    $changed = $true
  }
  if ($Action -eq 'remove' -and $present) {
    $parts = @($parts | Where-Object { (& $norm $_) -ne $target })
    $changed = $true
  }
  if ($changed) {
    $reg.SetValue('Path', ($parts -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
  }
} finally {
  $reg.Close()
}
