/**
 * Hyper-V via PowerShell. Optional: run as another local user, or remote host.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const { getSession } = require('./session');

const execFileAsync = promisify(execFile);
const POWERSHELL = 'powershell.exe';
const BASE_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'];

function localHostname() {
  return (os.hostname() || '').toLowerCase();
}

/**
 * Start-Process -Credential often rejects ".\user"; use COMPUTERNAME\user.
 * Microsoft account: use full email as username.
 */
function normalizeUsername(username) {
  let u = String(username || '').trim();
  if (!u) return u;
  if (u.includes('@')) return u;
  const h = os.hostname() || 'localhost';
  if (u.startsWith('.\\')) {
    return `${h}\\${u.slice(2)}`;
  }
  if (!u.includes('\\')) {
    return `${h}\\${u}`;
  }
  return u;
}

function isLocalComputer(name) {
  if (!name || !String(name).trim()) return true;
  const c = String(name).trim().toLowerCase();
  if (c === 'localhost' || c === '.' || c === '127.0.0.1') return true;
  return c === localHostname();
}

function escapeForPs(str) {
  if (str == null) return '""';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

function b64Utf8(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

/**
 * Run inner PowerShell as current user.
 */
function runDirect(script) {
  return execFileAsync(POWERSHELL, [...BASE_ARGS, script], {
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  }).then(({ stdout, stderr }) => {
    const trimmed = (stdout || '').trim();
    if (!trimmed) {
      const err = (stderr || '').trim();
      if (err) throw new Error(err);
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }).catch(err => {
    const msg = (err.stderr || err.message || '').trim();
    throw new Error(msg || 'PowerShell command failed');
  });
}

/**
 * Run inner script as different Windows user (local machine). Fixes "authorization policy" when dashboard user lacks Hyper-V rights.
 */
function runAsDifferentUser(username, password, innerScript) {
  const innerB64 = b64Utf8(innerScript.replace(/^\uFEFF/, '').trim());
  const userB64 = b64Utf8(username);
  const passB64 = b64Utf8(password);
  const outer = `
$ErrorActionPreference = 'Stop'
$u = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${userB64}'))
$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${passB64}'))
$inner = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${innerB64}'))
$sp = Join-Path $env:TEMP ('hvd_' + [guid]::NewGuid().ToString() + '.ps1')
$op = Join-Path $env:TEMP ('hvo_' + [guid]::NewGuid().ToString() + '.txt')
$ep = Join-Path $env:TEMP ('hve_' + [guid]::NewGuid().ToString() + '.txt')
try {
  Set-Content -LiteralPath $sp -Value $inner -Encoding UTF8
  $sec = ConvertTo-SecureString $p -AsPlainText -Force
  $cred = New-Object System.Management.Automation.PSCredential($u, $sec)
  $args = @('-NoProfile','-ExecutionPolicy','Bypass','-NonInteractive','-File', $sp)
  $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Credential $cred -Wait -PassThru -LoadUserProfile -RedirectStandardOutput $op -RedirectStandardError $ep
  $out = if (Test-Path -LiteralPath $op) { Get-Content -LiteralPath $op -Raw } else { '' }
  $err = if (Test-Path -LiteralPath $ep) { Get-Content -LiteralPath $ep -Raw } else { '' }
  if (-not $proc) { throw 'Start-Process failed (logon?). Use COMPUTERNAME\\user e.g. MEOW\\kyled or run elevated.' }
  if ($proc.ExitCode -ne 0 -and $err) { throw $err }
  if ($proc.ExitCode -ne 0 -and -not [string]::IsNullOrWhiteSpace($out)) { }
  elseif ($proc.ExitCode -ne 0) { throw "Process exited $($proc.ExitCode)" }
  ($out | Out-String).Trim()
} finally {
  Remove-Item -LiteralPath $sp,$op,$ep -Force -ErrorAction SilentlyContinue
}
`;
  return runDirect(outer).catch((e) => {
    const m = String(e.message || '');
    if (/user name or password is incorrect|logon failure|1326/i.test(m)) {
      throw new Error(
        'Logon failed. Try MEOW\\kyled (not .\\kyled in the box — that is converted automatically). ' +
        'Microsoft account: use your email as username + Microsoft password. ' +
        'Or run start.ps1 as Administrator, or add your user to Hyper-V Administrators (see README).'
      );
    }
    throw e;
  });
}

function remotePrefix(computerName, username, password) {
  const userB64 = b64Utf8(username);
  const passB64 = b64Utf8(password);
  const cn = escapeForPs(computerName);
  return `
$HV_cn = ${cn}
$HV_p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${passB64}'))
$HV_u = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${userB64}'))
$HV_sec = ConvertTo-SecureString $HV_p -AsPlainText -Force
$HV_cred = New-Object System.Management.Automation.PSCredential($HV_u, $HV_sec)
Import-Module Hyper-V -ErrorAction Stop
`;
}

async function runScript(innerScript) {
  const sess = getSession();
  if (!sess) {
    return runDirect(innerScript);
  }
  const local = isLocalComputer(sess.computerName);
  if (local) {
    const body = `Import-Module Hyper-V -ErrorAction Stop
${innerScript}`;
    return runAsDifferentUser(normalizeUsername(sess.username), sess.password, body);
  }
  const prefixed = remotePrefix(sess.computerName, sess.username, sess.password) + innerScript;
  return runDirect(prefixed);
}

function remoteGetVM() {
  const sess = getSession();
  if (sess && !isLocalComputer(sess.computerName)) {
    return 'Get-VM -ComputerName $HV_cn -Credential $HV_cred';
  }
  return 'Get-VM';
}

function remoteVmNameParam(vmName) {
  const sess = getSession();
  if (sess && !isLocalComputer(sess.computerName)) {
    return `-ComputerName $HV_cn -Credential $HV_cred -Name ${escapeForPs(vmName)}`;
  }
  return `-Name ${escapeForPs(vmName)}`;
}

async function getHosts() {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const gv = remoteGetVM();
  const hostNameExpr = remote ? '$HV_cn' : '$env:COMPUTERNAME';
  const script = `
    $hosts = @()
    try {
      $hostName = ${hostNameExpr}
      $vms = ${gv} -ErrorAction Stop
      $hosts += [PSCustomObject]@{
        Name = $hostName
        Id = $hostName
        IsLocal = ${remote ? '$false' : '$true'}
        VMCount = ($vms | Measure-Object).Count
      }
    } catch {
      $hosts += [PSCustomObject]@{ Name = ${hostNameExpr}; Id = ${hostNameExpr}; IsLocal = ${remote ? '$false' : '$true'}; VMCount = 0; Error = $_.Exception.Message }
    }
    $hosts | ConvertTo-Json -Depth 3 -Compress
  `;
  const result = await runScript(script);
  return Array.isArray(result) ? result : (result ? [result] : []);
}

async function getVMs() {
  const gv = remoteGetVM();
  const script = `
    try {
      ${gv} -ErrorAction Stop | ForEach-Object {
        $uptime = if ($_.Uptime) { $_.Uptime.ToString() } else { $null }
        [PSCustomObject]@{
          Name = $_.Name
          State = $_.State.ToString()
          ProcessorCount = $_.ProcessorCount
          CPUUsage = $_.CPUUsage
          MemoryAssigned = $_.MemoryAssigned
          MemoryDemand = $_.MemoryDemand
          Uptime = $uptime
          Id = $_.Id.ToString()
          Status = $_.Status
          Generation = $_.Generation
        }
      } | ConvertTo-Json -Depth 3 -Compress
    } catch {
      @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;
  const result = await runScript(script);
  if (result && result.error) throw new Error(result.error);
  return Array.isArray(result) ? result : (result ? [result] : []);
}

async function getVMsWithMetrics() {
  const gv = remoteGetVM();
  const script = `
    try {
      $list = @(${gv} -ErrorAction Stop | ForEach-Object {
        $uptime = if ($_.Uptime) { $_.Uptime.ToString() } else { $null }
        [PSCustomObject]@{
          Name = $_.Name
          State = $_.State.ToString()
          ProcessorCount = $_.ProcessorCount
          CPUUsage = $_.CPUUsage
          MemoryAssigned = $_.MemoryAssigned
          MemoryDemand = $_.MemoryDemand
          Uptime = $uptime
          Id = $_.Id.ToString()
          Status = $_.Status
          Generation = $_.Generation
        }
      })
      $run = @($list | Where-Object { $_.State -eq 'Running' })
      $avgCpu = 0
      if ($run.Count -gt 0) {
        $cpuSum = 0; $cpuN = 0
        foreach ($v in $run) {
          if ($null -ne $v.CPUUsage) { $cpuSum += [double]$v.CPUUsage; $cpuN++ }
        }
        if ($cpuN -gt 0) { $avgCpu = [int][math]::Round($cpuSum / $cpuN) }
      }
      $md = 0L; $ma = 0L
      foreach ($v in $run) {
        if ($v.MemoryAssigned -gt 0) {
          $md += [int64]$v.MemoryDemand
          $ma += [int64]$v.MemoryAssigned
        }
      }
      $memPct = 0
      if ($ma -gt 0) { $memPct = [int][math]::Min(100, [math]::Round(100.0 * $md / $ma)) }
      $netPct = 0
      try {
        $ctr = Get-Counter '\\Network Interface(*)\\Bytes Total/sec' -ErrorAction Stop
        $samples = @($ctr.CounterSamples)
        $bps = 0.0
        foreach ($s in $samples) {
          if ($s.InstanceName -notmatch 'Loopback|isatap|Teredo|Any|6to4') {
            $bps += [math]::Max(0, [double]$s.CookedValue)
          }
        }
        $mbps = if ($bps -gt 0) { ($bps * 8.0) / 1048576.0 } else { 0 }
        $netPct = [int][math]::Min(100, [math]::Round($mbps * 8))
      } catch { }
      @{ vms = $list; metrics = @{ avgCpu = $avgCpu; memPressurePct = $memPct; networkPct = $netPct } } | ConvertTo-Json -Depth 8 -Compress
    } catch {
      @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;
  const result = await runScript(script);
  if (result && result.error) throw new Error(result.error);
  const vms = result.vms;
  const list = Array.isArray(vms) ? vms : vms ? [vms] : [];
  const m = result.metrics || {};
  return {
    vms: list,
    metrics: {
      avgCpu: Number(m.avgCpu) || 0,
      memPressurePct: Number(m.memPressurePct) || 0,
      networkPct: Number(m.networkPct) || 0,
    },
  };
}

async function vmAction(name, action) {
  const actions = {
    start: 'Start-VM',
    stop: 'Stop-VM -Force',
    restart: 'Restart-VM -Force',
    pause: 'Suspend-VM',
    resume: 'Resume-VM'
  };
  const cmd = actions[action];
  if (!cmd) throw new Error('Invalid action');
  const rp = remoteVmNameParam(name);
  const script = `
    try {
      & ${cmd} ${rp} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Action failed');
  return result;
}

async function createCheckpoint(vmName, checkpointName) {
  const rp = remoteVmNameParam(vmName);
  const script = `
    try {
      $snapshotName = if (${escapeForPs(checkpointName)}) { ${escapeForPs(checkpointName)} } else { "Checkpoint_$(Get-Date -Format 'yyyyMMdd_HHmmss')" }
      Checkpoint-VM ${rp} -SnapshotName $snapshotName -ErrorAction Stop
      @{ success = $true; name = $snapshotName } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Checkpoint failed');
  return result;
}

async function getCheckpoints(vmName) {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = remote
    ? `
    try {
      Get-VMSnapshot -VMName ${escapeForPs(vmName)} -ComputerName $HV_cn -Credential $HV_cred -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{ Name = $_.Name; Id = $_.Id.ToString(); CreationTime = $_.CreationTime.ToString('o') }
      } | ConvertTo-Json -Depth 3 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `
    : `
    try {
      Get-VMSnapshot -VMName ${escapeForPs(vmName)} -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{ Name = $_.Name; Id = $_.Id.ToString(); CreationTime = $_.CreationTime.ToString('o') }
      } | ConvertTo-Json -Depth 3 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const result = await runScript(script);
  return Array.isArray(result) ? result : (result ? [result] : []);
}

async function removeCheckpoint(vmName, snapshotName) {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = remote
    ? `
    try {
      Remove-VMSnapshot -VMName ${escapeForPs(vmName)} -Name ${escapeForPs(snapshotName)} -ComputerName $HV_cn -Credential $HV_cred -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `
    : `
    try {
      Remove-VMSnapshot -VMName ${escapeForPs(vmName)} -Name ${escapeForPs(snapshotName)} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Remove checkpoint failed');
  return result;
}

async function getVMSwitches() {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const scriptLocal = `
    try {
      Get-VMSwitch -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{
          Name = $_.Name
          Id = $_.Id.ToString()
          SwitchType = $_.SwitchType.ToString()
          NetAdapterInterfaceDescription = $_.NetAdapterInterfaceDescription
          AllowManagementOS = [bool]$_.AllowManagementOS
          Notes = $_.Notes
          NetAdapterName = if ($_.NetAdapterInterfaceDescription) { (Get-NetAdapter -InterfaceDescription $_.NetAdapterInterfaceDescription -ErrorAction SilentlyContinue | Select-Object -First 1).Name } else { $null }
        }
      } | ConvertTo-Json -Depth 3 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const scriptRemote = `
    try {
      Get-VMSwitch -ComputerName $HV_cn -Credential $HV_cred -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{
          Name = $_.Name
          Id = $_.Id.ToString()
          SwitchType = $_.SwitchType.ToString()
          NetAdapterInterfaceDescription = $_.NetAdapterInterfaceDescription
          AllowManagementOS = [bool]$_.AllowManagementOS
          Notes = $_.Notes
          NetAdapterName = $null
        }
      } | ConvertTo-Json -Depth 3 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const result = await runScript(remote ? scriptRemote : scriptLocal);
  return Array.isArray(result) ? result : (result ? [result] : []);
}

async function getNetAdaptersForSwitch() {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const scriptLocal = `
    try {
      Get-NetAdapter -ErrorAction SilentlyContinue |
        Where-Object { $_.Status -match 'Up|Disconnected|Disabled' } |
        Select-Object Name, InterfaceDescription, Status, LinkSpeed |
        ConvertTo-Json -Depth 4 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const scriptRemote = `
    try {
      $ad = Invoke-Command -ComputerName $HV_cn -Credential $HV_cred -ScriptBlock {
        Get-NetAdapter -ErrorAction SilentlyContinue |
          Where-Object { $_.Status -match 'Up|Disconnected|Disabled' } |
          Select-Object Name, InterfaceDescription, Status, LinkSpeed
      }
      @($ad) | ConvertTo-Json -Depth 4 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const result = await runScript(remote ? scriptRemote : scriptLocal);
  return Array.isArray(result) ? result : (result ? [result] : []);
}

async function createVMSwitch(opts) {
  const name = String(opts.name || '').trim();
  const stRaw = String(opts.switchType || 'Internal').toLowerCase();
  const stMap = { external: 'External', internal: 'Internal', private: 'Private' };
  const switchType = stMap[stRaw] || 'Internal';
  const netAdapterName = String(opts.netAdapterName || '').trim();
  const allowManagementOS = opts.allowManagementOS !== false;
  const notes = opts.notes != null ? String(opts.notes) : '';
  if (!name) throw new Error('Switch name required');
  const valid = ['External', 'Internal', 'Private'];
  if (!valid.includes(switchType)) throw new Error('switchType must be External, Internal, or Private');
  if (switchType === 'External' && !netAdapterName) {
    throw new Error('External switch requires netAdapterName (physical adapter)');
  }
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const n = escapeForPs(name);
  const na = escapeForPs(netAdapterName);
  const notePs = escapeForPs(notes);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  let inner;
  if (switchType === 'External') {
    inner = `
    try {
      $sw = New-VMSwitch ${rc}-Name ${n} -NetAdapterName ${na} -AllowManagementOS $${allowManagementOS ? 'true' : 'false'} -ErrorAction Stop
      if (${notePs ? '1' : '0'}) { Set-VMSwitch ${rc}-Name ${n} -Notes ${notePs} -ErrorAction SilentlyContinue | Out-Null }
      @{ success = $true; name = $sw.Name } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  } else {
    inner = `
    try {
      $sw = New-VMSwitch ${rc}-Name ${n} -SwitchType ${switchType} -ErrorAction Stop
      if (${notePs ? '1' : '0'}) { Set-VMSwitch ${rc}-Name ${n} -Notes ${notePs} -ErrorAction SilentlyContinue | Out-Null }
      @{ success = $true; name = $sw.Name } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  }
  const result = await runScript(inner);
  if (result && !result.success) throw new Error(result.error || 'Create switch failed');
  return result;
}

async function removeVMSwitch(name, force) {
  const n = escapeForPs(decodeURIComponent(name));
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  const f = force ? '-Force ' : '';
  const script = `
    try {
      Remove-VMSwitch ${rc}-Name ${n} ${f}-ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Remove switch failed');
  return result;
}

async function renameVMSwitch(oldName, newName) {
  const o = escapeForPs(decodeURIComponent(oldName));
  const nn = escapeForPs(String(newName || '').trim());
  if (!nn) throw new Error('New name required');
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  const script = `
    try {
      Rename-VMSwitch ${rc}-Name ${o} -NewName ${nn} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Rename failed');
  return result;
}

async function setVMSwitch(name, opts) {
  const n = escapeForPs(decodeURIComponent(name));
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  const parts = [];
  if (opts.allowManagementOS !== undefined && opts.allowManagementOS !== null) {
    parts.push(`-AllowManagementOS $${opts.allowManagementOS ? 'true' : 'false'}`);
  }
  if (opts.netAdapterName && String(opts.netAdapterName).trim()) {
    parts.push(`-NetAdapterName ${escapeForPs(String(opts.netAdapterName).trim())}`);
  }
  if (opts.notes !== undefined && opts.notes !== null) {
    parts.push(`-Notes ${escapeForPs(String(opts.notes))}`);
  }
  if (opts.minimumBandwidthMode && String(opts.minimumBandwidthMode).trim()) {
    const m = String(opts.minimumBandwidthMode).trim();
    parts.push(`-MinimumBandwidthMode ${m}`);
  }
  if (!parts.length) throw new Error('No properties to update');
  const script = `
    try {
      Set-VMSwitch ${rc}-Name ${n} ${parts.join(' ')} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Set switch failed');
  return result;
}

async function getVMSans() {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  const script = `
    try {
      Get-VMSan ${rc}-ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{
          Name = $_.Name
          HostWorldWideNodeName = @($_.HostWorldWideNodeName | ForEach-Object { $_.ToString() })
          HostWorldWidePortName = @($_.HostWorldWidePortName | ForEach-Object { $_.ToString() })
          Notes = $_.Notes
        }
      } | ConvertTo-Json -Depth 6 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const result = await runScript(script);
  return Array.isArray(result) ? result : (result ? [result] : []);
}

function normalizeWwn(s) {
  return String(s || '').replace(/[:\s.-]/gi, '').toLowerCase();
}

async function createVMSan(opts) {
  const name = String(opts.name || '').trim();
  const wwnn = normalizeWwn(opts.hostWorldWideNodeName || opts.wwnn);
  let wwpns = opts.hostWorldWidePortNames || opts.wwpns;
  if (!Array.isArray(wwpns)) {
    wwpns = String(wwpns || '')
      .split(/[\s,;]+/)
      .map((x) => normalizeWwn(x))
      .filter(Boolean);
  } else {
    wwpns = wwpns.map((x) => normalizeWwn(x)).filter(Boolean);
  }
  if (!name) throw new Error('SAN name required');
  if (!wwnn || wwnn.length < 8) throw new Error('Host WWNN required (hex, e.g. 20000000c951d3d1)');
  if (!wwpns.length) throw new Error('At least one host WWPN required');
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  const n = escapeForPs(name);
  const portArr = `@(${wwpns.map((p) => `'${p}'`).join(',')})`;
  const notes = opts.notes != null ? escapeForPs(String(opts.notes)) : '';
  const cleanScript = `
    try {
      $wwn = @('${wwnn}')
      $wwp = ${portArr}
      New-VMSan ${rc}-Name ${n} -HostWorldWideNodeName $wwn -HostWorldWidePortName $wwp -ErrorAction Stop | Out-Null
      if (${notes ? '1' : '0'}) { Set-VMSan ${rc}-Name ${n} -Notes ${notes} -ErrorAction SilentlyContinue | Out-Null }
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  const result = await runScript(cleanScript);
  if (result && !result.success) throw new Error(result.error || 'Create SAN failed');
  return result;
}

async function removeVMSan(name) {
  const n = escapeForPs(decodeURIComponent(name));
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  const script = `
    try {
      Remove-VMSan ${rc}-Name ${n} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Remove SAN failed');
  return result;
}

async function setVMSan(name, opts) {
  const n = escapeForPs(decodeURIComponent(name));
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const rc = remote ? '-ComputerName $HV_cn -Credential $HV_cred ' : '';
  const parts = [];
  if (opts.notes !== undefined) {
    parts.push(`-Notes ${escapeForPs(String(opts.notes))}`);
  }
  let wwnScript = '';
  if (opts.hostWorldWideNodeName || (opts.hostWorldWidePortNames && opts.hostWorldWidePortNames.length)) {
    const wwnn = opts.hostWorldWideNodeName ? normalizeWwn(opts.hostWorldWideNodeName) : null;
    let wwpns = opts.hostWorldWidePortNames;
    if (wwpns && !Array.isArray(wwpns)) {
      wwpns = String(wwpns)
        .split(/[\s,;]+/)
        .map((x) => normalizeWwn(x))
        .filter(Boolean);
    } else if (Array.isArray(wwpns)) {
      wwpns = wwpns.map((x) => normalizeWwn(x)).filter(Boolean);
    }
    if (wwnn && wwnn.length >= 8 && wwpns && wwpns.length) {
      wwnScript = `
      $wwn = @('${wwnn}')
      $wwp = @(${wwpns.map((p) => `'${p}'`).join(',')})
      Set-VMSan ${rc}-Name ${n} -HostWorldWideNodeName $wwn -HostWorldWidePortName $wwp -ErrorAction Stop | Out-Null
      `;
    }
  }
  if (!parts.length && !wwnScript) throw new Error('Nothing to update');
  const script = `
    try {
      ${wwnScript}
      ${parts.length ? `Set-VMSan ${rc}-Name ${n} ${parts.join(' ')} -ErrorAction Stop | Out-Null` : ''}
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }`;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Update SAN failed');
  return result;
}

async function getFibreChannelHostBusAdapters() {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const scriptLocal = `
    try {
      Get-VMHostFibreChannelHba -ErrorAction SilentlyContinue | ForEach-Object {
        $ports = @()
        if ($_.WorldWidePortName) { $ports += $_.WorldWidePortName.ToString() }
        if ($_.WorldWidePortNames) { foreach ($p in @($_.WorldWidePortNames)) { $ports += $p.ToString() } }
        [PSCustomObject]@{
          Name = $_.Name
          WorldWideNodeName = if ($_.WorldWideNodeName) { $_.WorldWideNodeName.ToString() } else { $null }
          WorldWidePortNames = $ports
        }
      } | ConvertTo-Json -Depth 6 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const scriptRemote = `
    try {
      $hb = Invoke-Command -ComputerName $HV_cn -Credential $HV_cred -ScriptBlock {
        Get-VMHostFibreChannelHba -ErrorAction SilentlyContinue | ForEach-Object {
          $ports = @()
          if ($_.WorldWidePortName) { $ports += $_.WorldWidePortName.ToString() }
          if ($_.WorldWidePortNames) { foreach ($p in @($_.WorldWidePortNames)) { $ports += $p.ToString() } }
          [PSCustomObject]@{
            Name = $_.Name
            WorldWideNodeName = if ($_.WorldWideNodeName) { $_.WorldWideNodeName.ToString() } else { $null }
            WorldWidePortNames = $ports
          }
        }
      }
      @($hb) | ConvertTo-Json -Depth 6 -Compress
    } catch { @() | ConvertTo-Json -Compress }
    `;
  const result = await runScript(remote ? scriptRemote : scriptLocal);
  return Array.isArray(result) ? result : (result ? [result] : []);
}

async function createVM(options) {
  const { name, memoryMB = 1024, processorCount = 2, diskSizeGB = 60 } = options;
  const memoryBytes = memoryMB * 1024 * 1024;
  const diskBytes = diskSizeGB * 1024 * 1024 * 1024;
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = remote
    ? `
    try {
      $switch = (Get-VMSwitch -ComputerName $HV_cn -Credential $HV_cred -ErrorAction Stop | Select-Object -First 1).Name
      if (-not $switch) { throw 'No virtual switch on remote host.' }
      $vmPath = (Get-VMHost -ComputerName $HV_cn -Credential $HV_cred).VirtualMachinePath
      $vmName = ${escapeForPs(name)}
      $vhdPath = Join-Path $vmPath ($vmName + '\\' + $vmName + '.vhdx')
      New-VM -ComputerName $HV_cn -Credential $HV_cred -Name $vmName -MemoryStartupBytes $(${memoryBytes}) -SwitchName $switch -Generation 2 -ErrorAction Stop | Out-Null
      Set-VM -ComputerName $HV_cn -Credential $HV_cred -Name $vmName -ProcessorCount $(${processorCount}) -ErrorAction Stop | Out-Null
      New-VHD -ComputerName $HV_cn -Credential $HV_cred -Path $vhdPath -SizeBytes $(${diskBytes}) -Dynamic -ErrorAction Stop | Out-Null
      Add-VMHardDiskDrive -ComputerName $HV_cn -Credential $HV_cred -VMName $vmName -Path $vhdPath -ErrorAction Stop | Out-Null
      @{ success = $true; path = $vhdPath } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `
    : `
    try {
      $switch = (Get-VMSwitch -ErrorAction Stop | Select-Object -First 1).Name
      if (-not $switch) { throw 'No virtual switch found. Create one in Hyper-V Manager first.' }
      $vmPath = (Get-VMHost).VirtualMachinePath
      $vmName = ${escapeForPs(name)}
      $vhdPath = Join-Path $vmPath ($vmName + '\\' + $vmName + '.vhdx')
      New-VM -Name $vmName -MemoryStartupBytes $(${memoryBytes}) -SwitchName $switch -Generation 2 -ErrorAction Stop | Out-Null
      Set-VM -Name $vmName -ProcessorCount $(${processorCount}) -ErrorAction Stop | Out-Null
      New-VHD -Path $vhdPath -SizeBytes $(${diskBytes}) -Dynamic -ErrorAction Stop | Out-Null
      Add-VMHardDiskDrive -VMName $vmName -Path $vhdPath -ErrorAction Stop | Out-Null
      @{ success = $true; path = $vhdPath } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Create VM failed');
  return result;
}

async function updateVM(name, options) {
  const { memoryMB, processorCount } = options;
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const parts = [];
  if (memoryMB != null) {
    parts.push(remote
      ? `Set-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${escapeForPs(name)} -MemoryStartupBytes $(${memoryMB * 1024 * 1024}) -ErrorAction Stop`
      : `Set-VM -Name ${escapeForPs(name)} -MemoryStartupBytes $(${memoryMB * 1024 * 1024}) -ErrorAction Stop`);
  }
  if (processorCount != null) {
    parts.push(remote
      ? `Set-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${escapeForPs(name)} -ProcessorCount $(${processorCount}) -ErrorAction Stop`
      : `Set-VM -Name ${escapeForPs(name)} -ProcessorCount $(${processorCount}) -ErrorAction Stop`);
  }
  if (parts.length === 0) return { success: true };
  const script = `
    try {
      ${parts.join('; ')}
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Update failed');
  return result;
}

async function getVMHostInfo() {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = remote
    ? `
    try {
      $h = Get-VMHost -ComputerName $HV_cn -Credential $HV_cred -ErrorAction Stop
      [PSCustomObject]@{
        ComputerName = $HV_cn
        VirtualMachinePath = $h.VirtualMachinePath
        VirtualHardDiskPath = $h.VirtualHardDiskPath
      } | ConvertTo-Json -Compress
    } catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress }
    `
    : `
    try {
      $h = Get-VMHost -ErrorAction Stop
      [PSCustomObject]@{
        ComputerName = $env:COMPUTERNAME
        VirtualMachinePath = $h.VirtualMachinePath
        VirtualHardDiskPath = $h.VirtualHardDiskPath
      } | ConvertTo-Json -Compress
    } catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress }
    `;
  const result = await runScript(script);
  if (result && result.error) throw new Error(result.error);
  return result;
}

async function inspectVhd(vhdPath) {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const p = escapeForPs(vhdPath);
  const script = remote
    ? `
    try {
      Get-VHD -Path ${p} -ComputerName $HV_cn -Credential $HV_cred -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{
          Path = $_.Path
          VhdFormat = $_.VhdFormat.ToString()
          VhdType = $_.VhdType.ToString()
          Size = $_.Size
          FileSize = $_.FileSize
          MinimumSize = $_.MinimumSize
        }
      } | ConvertTo-Json -Compress
    } catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress }
    `
    : `
    try {
      Get-VHD -Path ${p} -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{
          Path = $_.Path
          VhdFormat = $_.VhdFormat.ToString()
          VhdType = $_.VhdType.ToString()
          Size = $_.Size
          FileSize = $_.FileSize
          MinimumSize = $_.MinimumSize
        }
      } | ConvertTo-Json -Compress
    } catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress }
    `;
  const result = await runScript(script);
  if (result && result.error) throw new Error(result.error);
  return result;
}

async function resizeVhd(vhdPath, sizeBytes) {
  const p = escapeForPs(vhdPath);
  const script = `
    try {
      Resize-VHD -Path ${p} -SizeBytes $(${Number(sizeBytes)}) -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Resize failed');
  return result;
}

async function renameVMVm(oldName, newName) {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = remote
    ? `
    try {
      Rename-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${escapeForPs(oldName)} -NewName ${escapeForPs(newName)} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `
    : `
    try {
      Rename-VM -Name ${escapeForPs(oldName)} -NewName ${escapeForPs(newName)} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Rename failed');
  return result;
}

async function moveVMVm(name, destination) {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const dest = escapeForPs(destination);
  const script = remote
    ? `
    try {
      Move-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${escapeForPs(name)} -Destination ${dest} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `
    : `
    try {
      Move-VM -Name ${escapeForPs(name)} -Destination ${dest} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Move failed');
  return result;
}

async function exportVMVm(name, folder) {
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = remote
    ? `
    try {
      Export-VM -ComputerName $HV_cn -Credential $HV_cred -Name ${escapeForPs(name)} -Path ${escapeForPs(folder)} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `
    : `
    try {
      Export-VM -Name ${escapeForPs(name)} -Path ${escapeForPs(folder)} -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Export failed');
  return result;
}

async function deleteVM(name) {
  const rp = remoteVmNameParam(name);
  const script = `
    try {
      $vm = Get-VM ${rp} -ErrorAction Stop
      if ($vm.State -ne 'Off') { Stop-VM ${rp} -Force -ErrorAction Stop; Start-Sleep -Seconds 3 }
      Remove-VM ${rp} -Force -ErrorAction Stop
      @{ success = $true } | ConvertTo-Json -Compress
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;
  const result = await runScript(script);
  if (result && !result.success) throw new Error(result.error || 'Delete failed');
  return result;
}

const vmSt = require('./vmSettings');

async function getVMFullSettings(name) {
  const decoded = decodeURIComponent(name);
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = vmSt.getVMFullSettingsScript(decoded, remote);
  const r = await runScript(script);
  if (r && r.error) throw new Error(r.error);
  return r;
}

async function setVMFullSettings(name, body) {
  const decoded = decodeURIComponent(name);
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const b64 = vmSt.b64Utf8(JSON.stringify(body));
  const script = vmSt.setVMFullSettingsScript(decoded, remote, b64);
  const r = await runScript(script);
  if (r && !r.success) throw new Error(r.error || 'Settings apply failed');
  return r;
}

async function addVMHardware(name, type, opts) {
  const decoded = decodeURIComponent(name);
  const sess = getSession();
  const remote = sess && !isLocalComputer(sess.computerName);
  const script = vmSt.addHardwareScript(decoded, remote, type, opts || {});
  const r = await runScript(script);
  if (r && !r.success) throw new Error(r.error || 'Add hardware failed');
  return r;
}

module.exports = {
  getHosts,
  getVMs,
  getVMsWithMetrics,
  vmAction,
  createCheckpoint,
  getCheckpoints,
  removeCheckpoint,
  getVMSwitches,
  getNetAdaptersForSwitch,
  createVMSwitch,
  removeVMSwitch,
  renameVMSwitch,
  setVMSwitch,
  getVMSans,
  createVMSan,
  removeVMSan,
  setVMSan,
  getFibreChannelHostBusAdapters,
  createVM,
  updateVM,
  deleteVM,
  getVMHostInfo,
  inspectVhd,
  resizeVhd,
  renameVMVm,
  exportVMVm,
  moveVMVm,
  getVMFullSettings,
  setVMFullSettings,
  addVMHardware,
  runScript,
  isLocalComputer,
  localHostname
};
