/**
 * Full VM settings read/write (Hyper-V Manager–style).
 */
function escapeForPs(str) {
  if (str == null) return '""';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

function b64Utf8(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function getVMFullSettingsScript(name, remote) {
  const n = escapeForPs(name);
  const loadVm = remote
    ? `$vm = Get-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${n} -ErrorAction Stop`
    : `$vm = Get-VM -Name ${n} -ErrorAction Stop`;
  return `
$ErrorActionPreference = 'Stop'
try {
  ${loadVm}
  $gen = [int]$vm.Generation
  $out = @{}
  $out.general = @{
    Name = $vm.Name
    Notes = [string]$vm.Notes
    Generation = $gen
    State = $vm.State.ToString()
    SmartPagingFilePath = if ($vm.SmartPagingFilePath) { [string]$vm.SmartPagingFilePath.Path } else { '' }
    CheckpointType = $vm.CheckpointType.ToString()
    AutomaticStartAction = $vm.AutomaticStartAction.ToString()
    AutomaticStartDelaySeconds = [int]$vm.AutomaticStartDelay.TotalSeconds
    AutomaticStopAction = $vm.AutomaticStopAction.ToString()
  }
  $m = Get-VMMemory -VM $vm
  $out.memory = @{
    StartupMB = [int][math]::Round([double]$m.Startup / 1MB)
    DynamicMemoryEnabled = [bool]$m.DynamicMemoryEnabled
    MinimumMB = [int][math]::Round([double]$m.Minimum / 1MB)
    MaximumMB = [int][math]::Round([double]$m.Maximum / 1MB)
    Priority = [int]$m.Priority
    Buffer = [int]$m.Buffer
  }
  $p = Get-VMProcessor -VM $vm
  $out.processor = @{
    Count = [int]$p.Count
    Reserve = [int]$p.Reserve
    Maximum = [int]$p.Maximum
    RelativeWeight = [int]$p.RelativeWeight
    CompatibilityForMigrationEnabled = [bool]$p.CompatibilityForMigrationEnabled
    CompatibilityForOlderOperatingSystemsEnabled = [bool]$p.CompatibilityForOlderOperatingSystemsEnabled
  }
  $out.firmware = $null
  if ($gen -ge 2) {
    try {
      $f = Get-VMFirmware -VM $vm
      $bootTypes = New-Object System.Collections.ArrayList
      foreach ($b in $f.BootOrder) { [void]$bootTypes.Add($b.GetType().Name) }
      $out.firmware = @{
        SecureBoot = $f.SecureBoot.ToString()
        PreferredNetworkBootProtocol = $f.PreferredNetworkBootProtocol.ToString()
        BootOrder = @($bootTypes)
      }
    } catch {
      $out.firmware = @{ SecureBoot = 'Off'; PreferredNetworkBootProtocol = 'IPv4'; BootOrder = @() }
    }
  }
  $out.security = $null
  if ($gen -ge 2) {
    try {
      $s = Get-VMSecurity -VM $vm
      $out.security = @{
        TpmEnabled = [bool]$s.TpmEnabled
        EncryptStateAndVmMigrationTrafficEnabled = [bool]$s.EncryptStateAndVmMigrationTrafficEnabled
        Shielded = [bool]$s.Shielded
      }
    } catch { $out.security = @{ TpmEnabled = $false; EncryptStateAndVmMigrationTrafficEnabled = $false; Shielded = $false } }
  }
  $out.networkAdapters = @(Get-VMNetworkAdapter -VM $vm | ForEach-Object {
    $vlan = 0
    try { if ($_.VlanSetting.AccessVlanId) { $vlan = [int]$_.VlanSetting.AccessVlanId } } catch {}
    @{
      Name = $_.Name
      SwitchName = [string]$_.SwitchName
      MacAddress = [string]$_.MacAddress
      DynamicMacAddressEnabled = [bool]$_.DynamicMacAddressEnabled
      VlanId = $vlan
    }
  })
  $out.scsiControllers = @(Get-VMScsiController -VM $vm | ForEach-Object { @{ ControllerNumber = [int]$_.ControllerNumber } })
  $out.hardDrives = @(Get-VMHardDiskDrive -VM $vm | ForEach-Object {
    @{
      Path = [string]$_.Path
      ControllerType = $_.ControllerType.ToString()
      ControllerNumber = [int]$_.ControllerNumber
      ControllerLocation = [int]$_.ControllerLocation
    }
  })
  $out.dvdDrives = @(Get-VMDvdDrive -VM $vm | ForEach-Object {
    @{
      Path = if ($_.Path) { [string]$_.Path } else { '' }
      ControllerNumber = [int]$_.ControllerNumber
      ControllerLocation = [int]$_.ControllerLocation
    }
  })
  $out.integrationServices = @(Get-VMIntegrationService -VM $vm | ForEach-Object {
    @{ Name = [string]$_.Name; Enabled = [bool]$_.Enabled }
  })
  $out | ConvertTo-Json -Depth 12 -Compress
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
}

function setVMFullSettingsScript(name, remote, payloadB64) {
  const n = escapeForPs(name);
  const loadVm = remote
    ? `$vm = Get-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${n} -ErrorAction Stop`
    : `$vm = Get-VM -Name ${n} -ErrorAction Stop`;
  const reload = (vmNameVar) =>
    remote
      ? `$vm = Get-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${vmNameVar} -ErrorAction Stop`
      : `$vm = Get-VM -Name ${vmNameVar} -ErrorAction Stop`;
  const renameLine = remote
    ? `Rename-VM -ComputerName $HV_cn -Credential $HV_cred -Name $vm.Name -NewName $newNm -ErrorAction Stop`
    : `Rename-VM -VM $vm -NewName $newNm -ErrorAction Stop`;

  return `
$ErrorActionPreference = 'Stop'
try {
  $cfg = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadB64}')) | ConvertFrom-Json
  ${loadVm}
  if ($cfg.renameTo -and [string]$cfg.renameTo -ne '' -and $cfg.renameTo -ne $vm.Name) {
    $newNm = [string]$cfg.renameTo
    ${renameLine}
    ${reload('$newNm')}
  }
  $g = $cfg.general
  if ($g) {
    if ($null -ne $g.Notes) { Set-VM -VM $vm -Notes ([string]$g.Notes) -ErrorAction Stop }
    if ($g.SmartPagingFilePath -and [string]$g.SmartPagingFilePath -ne '') {
      Set-VM -VM $vm -SmartPagingFilePath ([string]$g.SmartPagingFilePath) -ErrorAction Stop
    }
    if ($g.CheckpointType) {
      $ct = [string]$g.CheckpointType
      if ($ct -eq 'Production') { Set-VM -VM $vm -CheckpointType Production -ErrorAction Stop }
      elseif ($ct -eq 'Standard') { Set-VM -VM $vm -CheckpointType Standard -ErrorAction Stop }
    }
    if ($g.AutomaticStartAction) {
      $asa = [string]$g.AutomaticStartAction
      if ($asa -eq 'Nothing') { Set-VM -VM $vm -AutomaticStartAction Nothing -ErrorAction Stop }
      elseif ($asa -eq 'StartIfRunning') { Set-VM -VM $vm -AutomaticStartAction StartIfRunning -ErrorAction Stop }
      elseif ($asa -eq 'AlwaysStartAutomaticDelay') { Set-VM -VM $vm -AutomaticStartAction AlwaysStartAutomaticDelay -ErrorAction Stop }
    }
    if ($null -ne $g.AutomaticStartDelaySeconds) {
      Set-VM -VM $vm -AutomaticStartDelay (New-TimeSpan -Seconds ([int]$g.AutomaticStartDelaySeconds)) -ErrorAction Stop
    }
    if ($g.AutomaticStopAction) {
      $ast = [string]$g.AutomaticStopAction
      if ($ast -eq 'Save') { Set-VM -VM $vm -AutomaticStopAction Save -ErrorAction Stop }
      elseif ($ast -eq 'TurnOff') { Set-VM -VM $vm -AutomaticStopAction TurnOff -ErrorAction Stop }
      elseif ($ast -eq 'ShutDown') { Set-VM -VM $vm -AutomaticStopAction ShutDown -ErrorAction Stop }
    }
  }
  $mem = $cfg.memory
  if ($mem) {
    $dyn = [bool]$mem.DynamicMemoryEnabled
    if (-not $dyn) {
      Set-VMMemory -VM $vm -DynamicMemoryEnabled $false -ErrorAction Stop
      Set-VMMemory -VM $vm -StartupBytes ([int64][int]$mem.StartupMB * 1048576) -ErrorAction Stop
    } else {
      Set-VMMemory -VM $vm -StartupBytes ([int64][int]$mem.StartupMB * 1048576) -ErrorAction Stop
      Set-VMMemory -VM $vm -DynamicMemoryEnabled $true -MinimumBytes ([int64][int]$mem.MinimumMB * 1048576) -MaximumBytes ([int64][int]$mem.MaximumMB * 1048576) -Priority ([int]$mem.Priority) -Buffer ([int]$mem.Buffer) -ErrorAction Stop
    }
  }
  $proc = $cfg.processor
  if ($proc) {
    Set-VMProcessor -VM $vm -Count ([int]$proc.Count) -Reserve ([int]$proc.Reserve) -Maximum ([int]$proc.Maximum) -RelativeWeight ([int]$proc.RelativeWeight) -CompatibilityForMigrationEnabled ([bool]$proc.CompatibilityForMigrationEnabled) -CompatibilityForOlderOperatingSystemsEnabled ([bool]$proc.CompatibilityForOlderOperatingSystemsEnabled) -ErrorAction Stop
  }
  if ($cfg.firmware -and $vm.Generation -ge 2) {
    $fw = $cfg.firmware
    if ($fw.SecureBoot) { Set-VMFirmware -VM $vm -SecureBoot ([string]$fw.SecureBoot) -ErrorAction SilentlyContinue }
    if ($fw.PreferredNetworkBootProtocol) { Set-VMFirmware -VM $vm -PreferredNetworkBootProtocol ([string]$fw.PreferredNetworkBootProtocol) -ErrorAction SilentlyContinue }
    if ($fw.BootOrder -and @($fw.BootOrder).Count -gt 0) {
      $cur = Get-VMFirmware -VM $vm
      $map = @{}
      foreach ($b in $cur.BootOrder) { $map[$b.GetType().Name] = $b }
      $newBo = New-Object System.Collections.ArrayList
      foreach ($t in $fw.BootOrder) {
        if ($map[$t]) { [void]$newBo.Add($map[$t]) }
      }
      if ($newBo.Count -gt 0) { Set-VMFirmware -VM $vm -BootOrder ($newBo.ToArray()) -ErrorAction Stop }
    }
  }
  if ($cfg.security -and $vm.Generation -ge 2) {
    $sec = $cfg.security
    try {
      Set-VMSecurity -VM $vm -TpmEnabled ([bool]$sec.TpmEnabled) -EncryptStateAndVmMigrationTrafficEnabled ([bool]$sec.EncryptStateAndVmMigrationTrafficEnabled) -ErrorAction Stop
    } catch { }
  }
  if ($cfg.networkAdapters) {
    foreach ($na in $cfg.networkAdapters) {
      $ad = Get-VMNetworkAdapter -VM $vm -Name $na.Name -ErrorAction SilentlyContinue
      if (-not $ad) { continue }
      if ($na.SwitchName) { Connect-VMNetworkAdapter -VMNetworkAdapter $ad -SwitchName ([string]$na.SwitchName) -ErrorAction SilentlyContinue }
      Set-VMNetworkAdapter -VMNetworkAdapter $ad -VlanId ([int]$na.VlanId) -ErrorAction SilentlyContinue
      if ($null -ne $na.DynamicMacAddressEnabled) {
        Set-VMNetworkAdapter -VMNetworkAdapter $ad -DynamicMacAddressEnabled ([bool]$na.DynamicMacAddressEnabled) -ErrorAction SilentlyContinue
      }
    }
  }
  if ($cfg.integrationServices) {
    foreach ($is in $cfg.integrationServices) {
      try {
        if ([bool]$is.Enabled) { Enable-VMIntegrationService -VM $vm -Name $is.Name -ErrorAction SilentlyContinue }
        else { Disable-VMIntegrationService -VM $vm -Name $is.Name -ErrorAction SilentlyContinue }
      } catch { }
    }
  }
  @{ success = $true } | ConvertTo-Json -Compress
} catch {
  @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
}

function addHardwareScript(name, remote, type, opts) {
  const n = escapeForPs(name);
  const loadVm = remote
    ? `$vm = Get-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${n} -ErrorAction Stop`
    : `$vm = Get-VM -Name ${n} -ErrorAction Stop`;
  const sw = escapeForPs((opts && opts.switchName) || '');
  const path = escapeForPs((opts && opts.path) || '');
  if (type === 'networkAdapter') {
    return `
$ErrorActionPreference = 'Stop'
try {
  ${loadVm}
  Add-VMNetworkAdapter -VM $vm -SwitchName ${sw} -ErrorAction Stop
  @{ success = $true } | ConvertTo-Json -Compress
} catch { @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
`;
  }
  if (type === 'scsiController') {
    return `
$ErrorActionPreference = 'Stop'
try {
  ${loadVm}
  Add-VMScsiController -VM $vm -ErrorAction Stop
  @{ success = $true } | ConvertTo-Json -Compress
} catch { @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
`;
  }
  if (type === 'hardDrive') {
    return `
$ErrorActionPreference = 'Stop'
try {
  ${loadVm}
  Add-VMHardDiskDrive -VM $vm -Path ${path} -ErrorAction Stop
  @{ success = $true } | ConvertTo-Json -Compress
} catch { @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
`;
  }
  throw new Error('Unknown hardware type');
}

module.exports = {
  getVMFullSettingsScript,
  setVMFullSettingsScript,
  addHardwareScript,
  b64Utf8,
};
