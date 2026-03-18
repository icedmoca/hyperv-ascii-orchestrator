/**
 * Hyper-V Manager–style VM settings (full form).
 */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function bootTypeLabel(t) {
  const m = {
    BootDeviceNetworkAdapter: 'Network adapter',
    BootDeviceHardDrive: 'Hard drive',
    BootDeviceDVD: 'DVD',
    BootDeviceFloppy: 'Floppy',
  };
  return m[t] || t;
}

export async function mountFullVmSettings(root, vmName, ctx) {
  const { api, toast, refresh, selectVm } = ctx;
  const enc = encodeURIComponent(vmName);

  root.innerHTML = '<p class="tool-p vmset-loading">Loading VM settings…</p>';

  let data;
  let switches = [];
  try {
    const [sr, sw] = await Promise.all([
      api('GET', `/api/vms/${enc}/settings`),
      api('GET', '/api/switches').catch(() => ({ switches: [] })),
    ]);
    data = sr.settings;
    switches = sw.switches || [];
  } catch (e) {
    root.innerHTML = `<p class="tool-err">${esc(e.message)}</p><p class="tool-hint">VM may need to be on this host, or Hyper-V access may be denied.</p>`;
    return;
  }

  const g = data.general || {};
  const mem = data.memory || {};
  const proc = data.processor || {};
  const fw = data.firmware;
  const sec = data.security;
  const swOpts = switches
    .map((s) => `<option value="${esc(s.Name)}">${esc(s.Name)}</option>`)
    .join('');

  const bootOrder = fw && fw.BootOrder ? [...fw.BootOrder] : [];
  const bootListId = 'vmset-boot-list';

  root.innerHTML = `
<div class="vmset-banner ${g.State === 'Running' ? 'vmset-warn' : ''}">
  <strong>State:</strong> ${esc(g.State)} — Some changes require the VM to be <strong>Off</strong> (memory mode, firmware, security, add hardware).
</div>

<fieldset class="vmset-fieldset"><legend>Add hardware</legend>
  <div class="vmset-row">
    <label>Network adapter → switch</label>
    <select id="vmsetAddSw" class="input">${swOpts || '<option value="">(no switches)</option>'}</select>
    <button type="button" class="btn btn-sm" id="vmsetAddNic">Add network adapter</button>
  </div>
  <div class="vmset-row">
    <button type="button" class="btn btn-sm" id="vmsetAddScsi">Add SCSI controller</button>
  </div>
  <div class="vmset-row">
    <label>VHD/VHDX path</label>
    <input type="text" class="input input-wide" id="vmsetAddDiskPath" placeholder="D:\\Disks\\disk.vhdx" />
    <button type="button" class="btn btn-sm" id="vmsetAddDisk">Attach hard drive</button>
  </div>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Name & description</legend>
  <label class="tool-label">Display name (rename)</label>
  <input type="text" class="input input-wide" id="vmsetName" value="${esc(g.Name)}" />
  <label class="tool-label">Notes</label>
  <textarea class="input input-wide vmset-notes" id="vmsetNotes" rows="3">${esc(g.Notes || '')}</textarea>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Memory</legend>
  <label><input type="checkbox" id="vmsetDynMem" ${mem.DynamicMemoryEnabled ? 'checked' : ''} /> Dynamic memory</label>
  <div class="vmset-grid">
    <div><label>Startup RAM (MB)</label><input type="number" class="input num" id="vmsetRamStart" value="${mem.StartupMB || 1024}" min="32" /></div>
    <div class="vmset-dyn"><label>Minimum (MB)</label><input type="number" class="input num" id="vmsetRamMin" value="${mem.MinimumMB || 512}" min="32" /></div>
    <div class="vmset-dyn"><label>Maximum (MB)</label><input type="number" class="input num" id="vmsetRamMax" value="${mem.MaximumMB || 8192}" min="32" /></div>
    <div class="vmset-dyn"><label>Priority</label><input type="number" class="input num" id="vmsetRamPri" value="${mem.Priority || 100}" min="0" max="200" /></div>
    <div class="vmset-dyn"><label>Buffer (%)</label><input type="number" class="input num" id="vmsetRamBuf" value="${mem.Buffer || 20}" min="5" max="95" /></div>
  </div>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Processor</legend>
  <div class="vmset-grid">
    <div><label>Number of virtual processors</label><input type="number" class="input num" id="vmsetCpu" value="${proc.Count || 2}" min="1" max="240" /></div>
    <div><label>Reserve (%)</label><input type="number" class="input num" id="vmsetRes" value="${proc.Reserve || 0}" min="0" max="100" /></div>
    <div><label>Limit (%)</label><input type="number" class="input num" id="vmsetMax" value="${proc.Maximum || 100}" min="0" max="100" /></div>
    <div><label>Relative weight</label><input type="number" class="input num" id="vmsetWgt" value="${proc.RelativeWeight || 100}" min="1" max="10000" /></div>
  </div>
  <label><input type="checkbox" id="vmsetMig" ${proc.CompatibilityForMigrationEnabled ? 'checked' : ''} /> Migrate to a physical computer with a different processor version</label><br/>
  <label><input type="checkbox" id="vmsetOld" ${proc.CompatibilityForOlderOperatingSystemsEnabled ? 'checked' : ''} /> Run an older operating system (e.g. Windows 7)</label>
</fieldset>

${
  fw
    ? `<fieldset class="vmset-fieldset"><legend>Firmware (Gen ${g.Generation})</legend>
  <label>Secure Boot</label>
  <select id="vmsetSb" class="input">
    <option value="On" ${fw.SecureBoot === 'On' ? 'selected' : ''}>On</option>
    <option value="Off" ${fw.SecureBoot === 'Off' ? 'selected' : ''}>Off</option>
    <option value="NotSpecified" ${fw.SecureBoot === 'NotSpecified' ? 'selected' : ''}>Not specified</option>
  </select>
  <label>Preferred network boot protocol</label>
  <select id="vmsetNb" class="input">
    <option value="IPv4" ${(fw.PreferredNetworkBootProtocol || '').includes('IPv4') ? 'selected' : ''}>IPv4</option>
    <option value="IPv6" ${(fw.PreferredNetworkBootProtocol || '').includes('IPv6') ? 'selected' : ''}>IPv6</option>
  </select>
  <p class="tool-hint">Boot order (use ↑ ↓)</p>
  <ul id="${bootListId}" class="vmset-bootlist"></ul>
</fieldset>`
    : '<p class="tool-hint">Firmware options apply to Generation 2 VMs only.</p>'
}

${
  sec
    ? `<fieldset class="vmset-fieldset"><legend>Security</legend>
  <label><input type="checkbox" id="vmsetTpm" ${sec.TpmEnabled ? 'checked' : ''} /> Enable Trusted Platform Module</label><br/>
  <label><input type="checkbox" id="vmsetEnc" ${sec.EncryptStateAndVmMigrationTrafficEnabled ? 'checked' : ''} /> Encrypt state and VM migration traffic</label><br/>
  <label class="tool-hint">Shielded: ${sec.Shielded ? 'Yes (read-only here)' : 'No'}</label>
</fieldset>`
    : ''
}

<fieldset class="vmset-fieldset"><legend>SCSI controllers</legend>
  <ul class="vmset-plain">${(data.scsiControllers || []).map((c) => `<li>SCSI controller ${c.ControllerNumber}</li>`).join('') || '<li>None listed</li>'}</ul>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Network adapters</legend>
  <div id="vmsetNicWrap"></div>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Hard drives</legend>
  <ul class="vmset-plain">${(data.hardDrives || []).map((d) => `<li><code>${esc(d.Path)}</code> — ${esc(d.ControllerType)} ${d.ControllerNumber}:${d.ControllerLocation}</li>`).join('') || '<li>None</li>'}</ul>
</fieldset>

<fieldset class="vmset-fieldset"><legend>DVD drives</legend>
  <ul class="vmset-plain">${(data.dvdDrives || []).map((d) => `<li>${d.Path ? esc(d.Path) : '(empty)'} — IDE ${d.ControllerNumber}:${d.ControllerLocation}</li>`).join('') || '<li>None</li>'}</ul>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Integration services</legend>
  <div id="vmsetIntWrap"></div>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Checkpoints</legend>
  <select id="vmsetCkpt" class="input">
    <option value="Production" ${g.CheckpointType === 'Production' ? 'selected' : ''}>Production checkpoints</option>
    <option value="Standard" ${g.CheckpointType === 'Standard' ? 'selected' : ''}>Standard checkpoints</option>
  </select>
</fieldset>

<fieldset class="vmset-fieldset"><legend>Smart paging file location</legend>
  <input type="text" class="input input-wide" id="vmsetPage" value="${esc(g.SmartPagingFilePath || '')}" placeholder="Leave default or set folder path" />
</fieldset>

<fieldset class="vmset-fieldset"><legend>Automatic start action</legend>
  <select id="vmsetAutoStart" class="input">
    <option value="Nothing" ${g.AutomaticStartAction === 'Nothing' ? 'selected' : ''}>Nothing</option>
    <option value="StartIfRunning" ${g.AutomaticStartAction === 'StartIfRunning' ? 'selected' : ''}>If the virtual machine was running when the physical computer shut down</option>
    <option value="AlwaysStartAutomaticDelay" ${g.AutomaticStartAction === 'AlwaysStartAutomaticDelay' ? 'selected' : ''}>Always start this virtual machine automatically</option>
  </select>
  <label>Startup delay (seconds)</label>
  <input type="number" class="input num" id="vmsetDelay" value="${g.AutomaticStartDelaySeconds || 0}" min="0" max="7200" />
</fieldset>

<fieldset class="vmset-fieldset"><legend>Automatic stop action</legend>
  <select id="vmsetAutoStop" class="input">
    <option value="Save" ${g.AutomaticStopAction === 'Save' ? 'selected' : ''}>Save the virtual machine state</option>
    <option value="TurnOff" ${g.AutomaticStopAction === 'TurnOff' ? 'selected' : ''}>Turn off the virtual machine</option>
    <option value="ShutDown" ${g.AutomaticStopAction === 'ShutDown' ? 'selected' : ''}>Shut down the guest operating system</option>
  </select>
</fieldset>

<div class="vmset-savebar">
  <button type="button" class="btn" id="vmsetSave">Apply all settings</button>
  <button type="button" class="btn btn-sm" id="vmsetReload">Reload from host</button>
</div>
`;

  const bootUl = root.querySelector('#' + bootListId);
  if (bootUl) {
    bootOrder.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'vmset-boot-item';
      li.dataset.type = t;
      li.innerHTML = `<span>${esc(bootTypeLabel(t))}</span>
        <button type="button" class="btn btn-sm vmset-up" data-i="${i}">↑</button>
        <button type="button" class="btn btn-sm vmset-down" data-i="${i}">↓</button>`;
      bootUl.appendChild(li);
    });
    bootUl.addEventListener('click', (e) => {
      const up = e.target.closest('.vmset-up');
      const dn = e.target.closest('.vmset-down');
      const items = [...bootUl.querySelectorAll('.vmset-boot-item')];
      const idx = items.indexOf(e.target.closest('li'));
      if (up && idx > 0) {
        items[idx - 1].before(items[idx]);
      }
      if (dn && idx >= 0 && idx < items.length - 1) {
        items[idx + 1].after(items[idx]);
      }
    });
  }

  const nicWrap = root.querySelector('#vmsetNicWrap');
  (data.networkAdapters || []).forEach((na, i) => {
    const div = document.createElement('div');
    div.className = 'vmset-nic';
    const hasSw = switches.some((s) => s.Name === na.SwitchName);
    const swSelect =
      (!hasSw && na.SwitchName
        ? `<option value="${esc(na.SwitchName)}" selected>${esc(na.SwitchName)}</option>`
        : '') +
      switches
        .map((s) =>
          `<option value="${esc(s.Name)}" ${hasSw && s.Name === na.SwitchName ? 'selected' : ''}>${esc(s.Name)}</option>`
        )
        .join('');
    div.innerHTML = `
      <strong>${esc(na.Name)}</strong> — MAC ${esc(na.MacAddress)}<br/>
      <label>Virtual switch</label>
      <select class="input input-wide vmset-sw" data-i="${i}">
        ${swSelect || '<option value="">(no switch)</option>'}
      </select>
      <label>VLAN ID (0 = untagged)</label>
      <input type="number" class="input num vmset-vlan" data-i="${i}" value="${na.VlanId || 0}" min="0" max="4094" />
      <label><input type="checkbox" class="vmset-dynmac" data-i="${i}" ${na.DynamicMacAddressEnabled ? 'checked' : ''} /> Dynamic MAC</label>
      <input type="hidden" class="vmset-nicname" data-i="${i}" value="${esc(na.Name)}" />
    `;
    nicWrap.appendChild(div);
  });
  if (!data.networkAdapters || !data.networkAdapters.length) {
    nicWrap.innerHTML = '<p class="tool-hint">No network adapters. Use Add hardware above.</p>';
  }

  const intWrap = root.querySelector('#vmsetIntWrap');
  intWrap.innerHTML = (data.integrationServices || [])
    .map(
      (svc, i) =>
        `<label><input type="checkbox" id="vmsetInt${i}" data-name="${esc(svc.Name)}" ${svc.Enabled ? 'checked' : ''} /> ${esc(svc.Name)}</label><br/>`
    )
    .join('');

  const dynCb = root.querySelector('#vmsetDynMem');
  const toggleDyn = () => {
    root.querySelectorAll('.vmset-dyn').forEach((el) => {
      el.style.opacity = dynCb.checked ? '1' : '0.45';
      el.querySelectorAll('input').forEach((inp) => {
        inp.disabled = !dynCb.checked;
      });
    });
  };
  dynCb.addEventListener('change', toggleDyn);
  toggleDyn();

  function collectPayload() {
    const newName = root.querySelector('#vmsetName').value.trim();
    const nicEls = nicWrap.querySelectorAll('.vmset-nic');
    const networkAdapters = [];
    nicEls.forEach((div) => {
      const i = div.querySelector('.vmset-nicname').dataset.i;
      networkAdapters.push({
        Name: div.querySelector('.vmset-nicname').value,
        SwitchName: div.querySelector('.vmset-sw').value,
        VlanId: parseInt(div.querySelector('.vmset-vlan').value, 10) || 0,
        DynamicMacAddressEnabled: div.querySelector('.vmset-dynmac').checked,
      });
    });
    const integrationServices = [];
    intWrap.querySelectorAll('input[type=checkbox][data-name]').forEach((cb) => {
      integrationServices.push({ Name: cb.dataset.name, Enabled: cb.checked });
    });
    let bootOrderOut = [];
    if (bootUl) {
      bootUl.querySelectorAll('.vmset-boot-item').forEach((li) => bootOrderOut.push(li.dataset.type));
    }
    const sb = root.querySelector('#vmsetSb');
    const tpm = root.querySelector('#vmsetTpm');
    return {
      renameTo: newName !== vmName ? newName : '',
      general: {
        Notes: root.querySelector('#vmsetNotes').value,
        SmartPagingFilePath: root.querySelector('#vmsetPage').value.trim(),
        CheckpointType: root.querySelector('#vmsetCkpt').value,
        AutomaticStartAction: root.querySelector('#vmsetAutoStart').value,
        AutomaticStartDelaySeconds: parseInt(root.querySelector('#vmsetDelay').value, 10) || 0,
        AutomaticStopAction: root.querySelector('#vmsetAutoStop').value,
      },
      memory: {
        DynamicMemoryEnabled: dynCb.checked,
        StartupMB: parseInt(root.querySelector('#vmsetRamStart').value, 10),
        MinimumMB: parseInt(root.querySelector('#vmsetRamMin').value, 10),
        MaximumMB: parseInt(root.querySelector('#vmsetRamMax').value, 10),
        Priority: parseInt(root.querySelector('#vmsetRamPri').value, 10),
        Buffer: parseInt(root.querySelector('#vmsetRamBuf').value, 10),
      },
      processor: {
        Count: parseInt(root.querySelector('#vmsetCpu').value, 10),
        Reserve: parseInt(root.querySelector('#vmsetRes').value, 10),
        Maximum: parseInt(root.querySelector('#vmsetMax').value, 10),
        RelativeWeight: parseInt(root.querySelector('#vmsetWgt').value, 10),
        CompatibilityForMigrationEnabled: root.querySelector('#vmsetMig').checked,
        CompatibilityForOlderOperatingSystemsEnabled: root.querySelector('#vmsetOld').checked,
      },
      firmware:
        fw && sb
          ? {
              SecureBoot: sb.value,
              PreferredNetworkBootProtocol: root.querySelector('#vmsetNb').value,
              BootOrder: bootOrderOut,
            }
          : undefined,
      security:
        sec && tpm
          ? {
              TpmEnabled: tpm.checked,
              EncryptStateAndVmMigrationTrafficEnabled: root.querySelector('#vmsetEnc').checked,
            }
          : undefined,
      networkAdapters,
      integrationServices,
    };
  }

  root.querySelector('#vmsetSave').onclick = async () => {
    try {
      const encName = encodeURIComponent(vmName);
      await api('PUT', `/api/vms/${encName}/settings`, collectPayload());
      toast('Settings applied');
      const newN = root.querySelector('#vmsetName').value.trim();
      if (newN && newN !== vmName) selectVm(newN);
      await refresh();
      await mountFullVmSettings(root, newN || vmName, ctx);
    } catch (e) {
      toast(e.message || 'Failed', 'error');
    }
  };

  root.querySelector('#vmsetReload').onclick = async () => {
    await mountFullVmSettings(root, root.querySelector('#vmsetName').value.trim() || vmName, ctx);
    toast('Reloaded');
  };

  async function addHw(type, extra) {
    try {
      await api('POST', `/api/vms/${enc}/hardware`, { type, ...extra });
      toast('Hardware added');
      await mountFullVmSettings(root, vmName, ctx);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  root.querySelector('#vmsetAddNic').onclick = () => {
    const sw = root.querySelector('#vmsetAddSw').value;
    if (!sw) return toast('Pick a switch', 'error');
    addHw('networkAdapter', { switchName: sw });
  };
  root.querySelector('#vmsetAddScsi').onclick = () => addHw('scsiController', {});
  root.querySelector('#vmsetAddDisk').onclick = () => {
    const path = root.querySelector('#vmsetAddDiskPath').value.trim();
    if (!path) return toast('Enter disk path', 'error');
    addHw('hardDrive', { path });
  };
}
