/**
 * Full-screen tool UIs for each Hyper-V sidebar action.
 */
import { asciiFramedLines } from '../components/ASCIIBox.js';
import { mountFullVmSettings } from './vm-settings-full.js';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function header(mount, title, sub) {
  mount.innerHTML = '';
  const lines = asciiFramedLines(title, sub ? [sub] : [' ']);
  lines.forEach((ln) => {
    const e = document.createElement('div');
    e.className = 'ascii-box-line ascii-box-edge';
    e.textContent = ln;
    mount.appendChild(e);
  });
}

function section(body, html) {
  const w = document.createElement('div');
  w.className = 'tool-section';
  w.innerHTML = html;
  body.appendChild(w);
}

function fmtBytes(n) {
  if (n == null) return '—';
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  const mb = n / (1024 * 1024);
  return Math.round(mb) + ' MB';
}

export async function renderTool(toolId, titleMount, bodyMount, ctx) {
  const {
    api,
    toast,
    refresh,
    getTargetVmName,
    selectVm,
    runAction,
    activateView,
    hosts,
    computerName,
  } = ctx;

  titleMount.innerHTML = '';
  bodyMount.innerHTML = '';

  const nav = document.createElement('div');
  nav.className = 'tool-nav';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm';
    b.textContent = label;
    b.onclick = fn;
    nav.appendChild(b);
  };
  mk('← VMs', () => activateView('vms'));
  mk('New VM', () => activateView('create'));
  mk('Credentials', () => activateView('creds'));
  bodyMount.appendChild(nav);

  const vmName = getTargetVmName && getTargetVmName();

  try {
    switch (toolId) {
      case 'import-vm': {
        header(titleMount, 'Import Virtual Machine', 'Register from .vmcx or folder (manual steps)');
        section(bodyMount, `
          <p class="tool-p">Hyper-V imports are usually done from <strong>.vmcx</strong> or by copying a VM folder and using <em>Import Virtual Machine</em> in Hyper-V Manager.</p>
          <label class="tool-label">Path to VM config / folder</label>
          <input type="text" class="input input-wide" id="toolImportPath" placeholder="C:\\VMs\\MyVM\\Virtual Machines\\..." />
          <label class="tool-label">Display name (optional)</label>
          <input type="text" class="input input-wide" id="toolImportName" placeholder="Override VM name" />
          <p class="tool-hint">This dashboard does not run Import-VM yet. Copy the path above and use Hyper-V Manager, or run in PowerShell:</p>
          <pre class="tool-pre">Import-VM -Path 'C:\\path\\to\\Virtual Machines\\GUID.vmcx'</pre>
          <button type="button" class="btn" id="toolImportCopy">Copy PowerShell example</button>
        `);
        bodyMount.querySelector('#toolImportCopy').onclick = () => {
          const p = bodyMount.querySelector('#toolImportPath').value || 'C:\\path\\to\\VM.vmcx';
          const t = `Import-VM -Path '${p.replace(/'/g, "''")}'`;
          navigator.clipboard.writeText(t).then(() => toast('Copied'));
        };
        break;
      }

      case 'hyperv-settings': {
        header(titleMount, 'Hyper-V Settings', 'Host paths & session');
        let h = {};
        try {
          const r = await api('GET', '/api/vmhost');
          h = r.host || {};
        } catch (e) {
          h = { _err: e.message };
        }
        section(bodyMount, `
          <p class="tool-p"><strong>Computer:</strong> ${esc(computerName || '—')}</p>
          <p class="tool-p"><strong>Virtual machine path:</strong><br/><code class="tool-code">${esc(h.VirtualMachinePath || h._err || '—')}</code></p>
          <p class="tool-p"><strong>Virtual hard disks path:</strong><br/><code class="tool-code">${esc(h.VirtualHardDiskPath || '—')}</code></p>
          <button type="button" class="btn" id="toolOpenCreds">Open Credentials</button>
          <button type="button" class="btn" id="toolRefreshHost">Refresh</button>
        `);
        bodyMount.querySelector('#toolOpenCreds').onclick = () => activateView('creds');
        bodyMount.querySelector('#toolRefreshHost').onclick = () =>
          renderTool('hyperv-settings', titleMount, bodyMount, ctx);
        break;
      }

      case 'switches': {
        header(
          titleMount,
          'Virtual Switch Manager',
          'New-VMSwitch · Set-VMSwitch · Rename-VMSwitch · Remove-VMSwitch'
        );
        const root = document.createElement('div');
        root.className = 'tool-switch-san-root';
        bodyMount.appendChild(root);

        async function loadAdapters() {
          try {
            const r = await api('GET', '/api/switches/adapters');
            return r.adapters || [];
          } catch {
            return [];
          }
        }

        const paintSwitches = async () => {
          let list = [];
          try {
            const r = await api('GET', '/api/switches');
            list = r.switches || [];
          } catch (e) {
            root.innerHTML = `<p class="tool-err">${esc(e.message)}</p>`;
            return;
          }
          const adapters = await loadAdapters();
          const adOpts =
            adapters.length > 0
              ? adapters
                  .map(
                    (a) =>
                      `<option value="${esc(a.Name)}">${esc(a.Name)} — ${esc(
                        a.InterfaceDescription || a.Status || ''
                      )}</option>`
                  )
                  .join('')
              : '<option value="">(no adapters — run as admin / check host)</option>';

          root.innerHTML = `
            <div class="tool-toolbar">
              <button type="button" class="btn btn-sm" id="swRefresh">Refresh</button>
            </div>
            <div class="tool-section tool-create-box">
              <h3 class="tool-h3">Create virtual switch</h3>
              <p class="tool-hint">External = shared with a physical NIC. Internal = host + VMs. Private = VMs only.</p>
              <div class="tool-form-grid">
                <label class="tool-label">Name</label>
                <input type="text" id="swNewName" class="input" placeholder="e.g. External LAN" />
                <label class="tool-label">Type</label>
                <select id="swNewType" class="input">
                  <option value="Internal">Internal</option>
                  <option value="Private">Private</option>
                  <option value="External">External</option>
                </select>
                <label class="tool-label" id="swAdLbl">Physical adapter</label>
                <select id="swNewAd" class="input input-wide">${adOpts}</select>
                <label class="tool-label">Mgmt OS on NIC</label>
                <div><input type="checkbox" id="swNewAmo" checked /> <span class="tool-hint">External: let Windows use the NIC too</span></div>
                <label class="tool-label">Notes</label>
                <input type="text" id="swNewNotes" class="input input-wide" placeholder="Optional" />
              </div>
              <button type="button" class="btn" id="swCreateBtn">Create switch</button>
            </div>
            <div class="tool-section">
              <h3 class="tool-h3">Existing switches (${list.length})</h3>
              <table class="tool-data-table">
                <thead><tr><th>Name</th><th>Type</th><th>Binding</th><th>Mgmt OS</th><th>Notes</th><th>Actions</th></tr></thead>
                <tbody id="swTbody"></tbody>
              </table>
            </div>
          `;

          const tbody = root.querySelector('#swTbody');
          for (const s of list) {
            const enc = encodeURIComponent(s.Name);
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td><code>${esc(s.Name)}</code></td>
              <td>${esc(s.SwitchType || '—')}</td>
              <td class="tool-td-mono">${esc(s.NetAdapterInterfaceDescription || '—')}</td>
              <td>${s.AllowManagementOS ? 'Yes' : 'No'}</td>
              <td class="tool-td-mono">${esc((s.Notes || '').slice(0, 48))}${(s.Notes || '').length > 48 ? '…' : ''}</td>
              <td class="tool-actions">
                <button type="button" class="btn btn-sm sw-edit" data-enc="${enc}">Edit</button>
                <button type="button" class="btn btn-sm sw-del" data-enc="${enc}">Delete</button>
                <label class="tool-hint" style="display:block;margin-top:4px;"><input type="checkbox" class="sw-force" data-enc="${enc}" /> Force</label>
              </td>
            `;
            tbody.appendChild(tr);
          }

          const typeEl = root.querySelector('#swNewType');
          const syncAd = () => {
            const ext = typeEl.value === 'External';
            root.querySelector('#swAdLbl').style.visibility = ext ? 'visible' : 'hidden';
            root.querySelector('#swNewAd').style.visibility = ext ? 'visible' : 'hidden';
          };
          typeEl.onchange = syncAd;
          syncAd();

          root.querySelector('#swRefresh').onclick = () => paintSwitches();
          root.querySelector('#swCreateBtn').onclick = async () => {
            const name = root.querySelector('#swNewName').value.trim();
            const switchType = typeEl.value;
            const netAdapterName = root.querySelector('#swNewAd').value.trim();
            const allowManagementOS = root.querySelector('#swNewAmo').checked;
            const notes = root.querySelector('#swNewNotes').value.trim();
            if (!name) return toast('Enter switch name', 'error');
            try {
              await api('POST', '/api/switches', {
                name,
                switchType,
                netAdapterName,
                allowManagementOS,
                notes,
              });
              toast('Switch created');
              paintSwitches();
            } catch (e) {
              toast(e.message, 'error');
            }
          };

          root.querySelectorAll('.sw-del').forEach((b) => {
            b.onclick = async () => {
              const enc = b.dataset.enc;
              const n = decodeURIComponent(enc);
              const tr = b.closest('tr');
              const force = tr.querySelector('.sw-force')?.checked;
              if (!confirm(`Remove virtual switch "${n}"?${force ? ' (force)' : ''}`)) return;
              try {
                await api(
                  'DELETE',
                  `/api/switches/${enc}${force ? '?force=1' : ''}`
                );
                toast('Switch removed');
                paintSwitches();
              } catch (e) {
                toast(e.message, 'error');
              }
            };
          });

          root.querySelectorAll('.sw-edit').forEach((b) => {
            b.onclick = () => {
              const enc = b.dataset.enc;
              const s = list.find((x) => x.Name === decodeURIComponent(enc));
              if (!s) return;
              const ext = (s.SwitchType || '').toLowerCase() === 'external';
              const overlay = document.createElement('div');
              overlay.className = 'tool-modal-overlay';
              const curAd = s.NetAdapterName || '';
              const adOpts2 = adapters
                .map(
                  (a) =>
                    `<option value="${esc(a.Name)}" ${
                      a.Name === curAd ? 'selected' : ''
                    }>${esc(a.Name)}</option>`
                )
                .join('');
              overlay.innerHTML = `
                <div class="tool-modal" role="dialog">
                  <h3>Edit switch — ${esc(s.Name)}</h3>
                  <label>New name (rename)</label>
                  <input type="text" class="input input-wide" id="swRen" placeholder="${esc(s.Name)}" />
                  <label>Notes</label>
                  <input type="text" class="input input-wide" id="swNot" value="${esc(s.Notes || '')}" />
                  ${
                    ext
                      ? `<label>Physical adapter</label>
                  <select id="swAd2" class="input input-wide">${adOpts2 || adOpts}</select>
                  <label><input type="checkbox" id="swAmo" ${s.AllowManagementOS ? 'checked' : ''}/> Allow management OS on adapter</label>
                  <label>Minimum bandwidth mode</label>
                  <select id="swBw" class="input">
                    <option value="">(no change)</option>
                    <option value="Default">Default</option>
                    <option value="Weight">Weight</option>
                    <option value="Absolute">Absolute</option>
                    <option value="None">None</option>
                    <option value="IOPS">IOPS</option>
                  </select>`
                      : ''
                  }
                  <div class="tool-modal-btns">
                    <button type="button" class="btn" id="swApply">Save properties</button>
                    <button type="button" class="btn" id="swRenBtn">Rename only</button>
                    <button type="button" class="btn btn-sm" id="swClose">Close</button>
                  </div>
                </div>
              `;
              document.body.appendChild(overlay);
              overlay.querySelector('.tool-modal').addEventListener('click', (ev) => ev.stopPropagation());
              overlay.querySelector('#swClose').onclick = () => overlay.remove();
              overlay.onclick = () => overlay.remove();
              overlay.querySelector('#swRenBtn').onclick = async () => {
                const nn = overlay.querySelector('#swRen').value.trim();
                if (!nn || nn === s.Name)
                  return toast('Enter a different name', 'error');
                try {
                  await api('PUT', `/api/switches/${enc}`, { newName: nn });
                  toast('Renamed');
                  overlay.remove();
                  paintSwitches();
                } catch (e) {
                  toast(e.message, 'error');
                }
              };
              overlay.querySelector('#swApply').onclick = async () => {
                try {
                  const body = { notes: overlay.querySelector('#swNot').value };
                  if (ext) {
                    body.allowManagementOS =
                      overlay.querySelector('#swAmo').checked;
                    const ad = overlay.querySelector('#swAd2').value.trim();
                    if (ad && ad !== curAd) body.netAdapterName = ad;
                    const bw = overlay.querySelector('#swBw').value;
                    if (bw) body.minimumBandwidthMode = bw;
                  }
                  await api('PUT', `/api/switches/${enc}`, body);
                  toast('Updated');
                  overlay.remove();
                  paintSwitches();
                } catch (e) {
                  toast(e.message, 'error');
                }
              };
            };
          });
        };

        await paintSwitches();
        break;
      }

      case 'san': {
        header(
          titleMount,
          'Virtual SAN Manager',
          'New-VMSan · Set-VMSan · Remove-VMSan · host FC HBAs'
        );
        const sroot = document.createElement('div');
        sroot.className = 'tool-switch-san-root';
        bodyMount.appendChild(sroot);

        const paintSan = async () => {
          let sans = [];
          try {
            const r = await api('GET', '/api/sans');
            sans = r.sans || [];
          } catch (e) {
            sroot.innerHTML = `<p class="tool-err">${esc(e.message)}</p>`;
            return;
          }

          sroot.innerHTML = `
            <div class="tool-toolbar">
              <button type="button" class="btn btn-sm" id="sanRefresh">Refresh</button>
              <button type="button" class="btn btn-sm" id="sanHbaBtn">Load host Fibre Channel HBAs</button>
            </div>
            <div id="sanHbaOut" class="tool-section" style="display:none;"></div>
            <div class="tool-section tool-create-box">
              <h3 class="tool-h3">Create virtual SAN</h3>
              <p class="tool-hint">Maps host WWNN + WWPNs to a named SAN for VM Fibre Channel adapters. Requires FC hardware.</p>
              <div class="tool-form-grid">
                <label class="tool-label">SAN name</label>
                <input type="text" id="sanNewName" class="input" placeholder="Production FC" />
                <label class="tool-label">Host WWNN</label>
                <input type="text" id="sanWwnn" class="input input-wide" placeholder="20000000c951d3d1 (hex, colons optional)" />
                <label class="tool-label">Host WWPNs</label>
                <textarea id="sanWwpn" class="input input-wide" rows="3" placeholder="One per line or comma-separated, e.g. 21000000c951d3d1"></textarea>
                <label class="tool-label">Notes</label>
                <input type="text" id="sanNewNotes" class="input input-wide" placeholder="Optional" />
              </div>
              <button type="button" class="btn" id="sanCreateBtn">Create SAN</button>
            </div>
            <div class="tool-section">
              <h3 class="tool-h3">Virtual SANs (${sans.length})</h3>
              <table class="tool-data-table">
                <thead><tr><th>Name</th><th>WWNN</th><th>WWPNs</th><th>Notes</th><th>Actions</th></tr></thead>
                <tbody id="sanTbody"></tbody>
              </table>
            </div>
          `;

          const tbody = sroot.querySelector('#sanTbody');
          for (const san of sans) {
            const enc = encodeURIComponent(san.Name);
            const wwnn = (san.HostWorldWideNodeName || []).join(', ') || '—';
            const wwpn = (san.HostWorldWidePortName || []).join(', ') || '—';
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td><code>${esc(san.Name)}</code></td>
              <td class="tool-hba-row">${esc(wwnn)}</td>
              <td class="tool-hba-row">${esc(wwpn)}</td>
              <td>${esc(san.Notes || '')}</td>
              <td class="tool-actions">
                <button type="button" class="btn btn-sm san-edit" data-enc="${enc}">Edit</button>
                <button type="button" class="btn btn-sm san-del" data-enc="${enc}">Delete</button>
              </td>
            `;
            tbody.appendChild(tr);
          }

          sroot.querySelector('#sanRefresh').onclick = () => paintSan();
          sroot.querySelector('#sanHbaBtn').onclick = async () => {
            const out = sroot.querySelector('#sanHbaOut');
            out.style.display = 'block';
            out.innerHTML = '<p class="tool-p">Loading HBAs…</p>';
            try {
              const r = await api('GET', '/api/sans/hbas');
              const hbas = r.hbas || [];
              if (!hbas.length) {
                out.innerHTML =
                  '<p class="tool-hint">No FC HBAs reported (no hardware, drivers, or remote limitation).</p>';
                return;
              }
              out.innerHTML =
                '<h3 class="tool-h3">Host Fibre Channel HBAs</h3><p class="tool-hint">Use WWNN / WWPN values when creating or editing a virtual SAN.</p>' +
                '<table class="tool-data-table"><thead><tr><th>Name</th><th>WWNN</th><th>WWPNs</th></tr></thead><tbody>' +
                hbas
                  .map(
                    (h) =>
                      `<tr><td>${esc(h.Name)}</td><td class="tool-hba-row">${esc(h.WorldWideNodeName || '—')}</td><td class="tool-hba-row">${esc((h.WorldWidePortNames || []).join(', '))}</td></tr>`
                  )
                  .join('') +
                '</tbody></table>';
            } catch (e) {
              out.innerHTML = `<p class="tool-err">${esc(e.message)}</p>`;
            }
          };

          sroot.querySelector('#sanCreateBtn').onclick = async () => {
            const name = sroot.querySelector('#sanNewName').value.trim();
            const hostWorldWideNodeName = sroot.querySelector('#sanWwnn').value.trim();
            const hostWorldWidePortNames = sroot.querySelector('#sanWwpn').value;
            const notes = sroot.querySelector('#sanNewNotes').value.trim();
            if (!name) return toast('Enter SAN name', 'error');
            try {
              await api('POST', '/api/sans', {
                name,
                hostWorldWideNodeName,
                hostWorldWidePortNames,
                notes,
              });
              toast('Virtual SAN created');
              paintSan();
            } catch (e) {
              toast(e.message, 'error');
            }
          };

          sroot.querySelectorAll('.san-del').forEach((b) => {
            b.onclick = async () => {
              const enc = b.dataset.enc;
              const n = decodeURIComponent(enc);
              if (!confirm(`Remove virtual SAN "${n}"?`)) return;
              try {
                await api('DELETE', `/api/sans/${enc}`);
                toast('SAN removed');
                paintSan();
              } catch (e) {
                toast(e.message, 'error');
              }
            };
          });

          sroot.querySelectorAll('.san-edit').forEach((b) => {
            b.onclick = () => {
              const enc = b.dataset.enc;
              const san = sans.find((x) => x.Name === decodeURIComponent(enc));
              if (!san) return;
              const overlay = document.createElement('div');
              overlay.className = 'tool-modal-overlay';
              const wwnn0 = (san.HostWorldWideNodeName || [])[0] || '';
              const wwpn0 = (san.HostWorldWidePortName || []).join('\n');
              overlay.innerHTML = `
                <div class="tool-modal" role="dialog">
                  <h3>Edit SAN — ${esc(san.Name)}</h3>
                  <label>Host WWNN</label>
                  <input type="text" class="input input-wide" id="sanEwnn" value="${esc(wwnn0)}" />
                  <label>Host WWPNs (one per line)</label>
                  <textarea id="sanEwpn" class="input input-wide" rows="4">${esc(wwpn0)}</textarea>
                  <label>Notes</label>
                  <input type="text" class="input input-wide" id="sanEnotes" value="${esc(san.Notes || '')}" />
                  <div class="tool-modal-btns">
                    <button type="button" class="btn" id="sanSave">Save</button>
                    <button type="button" class="btn btn-sm" id="sanEx">Close</button>
                  </div>
                </div>
              `;
              document.body.appendChild(overlay);
              overlay.querySelector('.tool-modal').addEventListener('click', (ev) => ev.stopPropagation());
              overlay.querySelector('#sanEx').onclick = () => overlay.remove();
              overlay.onclick = () => overlay.remove();
              overlay.querySelector('#sanSave').onclick = async () => {
                try {
                  await api('PUT', `/api/sans/${enc}`, {
                    hostWorldWideNodeName: overlay.querySelector('#sanEwnn').value,
                    hostWorldWidePortNames: overlay.querySelector('#sanEwpn').value,
                    notes: overlay.querySelector('#sanEnotes').value,
                  });
                  toast('SAN updated');
                  overlay.remove();
                  paintSan();
                } catch (e) {
                  toast(e.message, 'error');
                }
              };
            };
          });
        };

        await paintSan();
        break;
      }

      case 'edit-disk': {
        header(titleMount, 'Edit Disk', 'Resize-VHD (expand dynamic disk)');
        section(bodyMount, `
          <p class="tool-hint">VM must be off. Expands dynamic VHD/VHDX to at least the new size.</p>
          <label class="tool-label">Full path to .vhd / .vhdx</label>
          <input type="text" class="input input-wide" id="toolEditPath" placeholder="D:\\VMs\\disk.vhdx" />
          <label class="tool-label">New size (GB)</label>
          <input type="number" class="input num" id="toolEditGb" value="80" min="1" />
          <button type="button" class="btn" id="toolEditGo">Apply resize</button>
        `);
        bodyMount.querySelector('#toolEditGo').onclick = async () => {
          const path = bodyMount.querySelector('#toolEditPath').value.trim();
          const sizeGB = bodyMount.querySelector('#toolEditGb').value;
          if (!path) return toast('Enter disk path', 'error');
          try {
            await api('POST', '/api/vhd/resize', { path, sizeGB: Number(sizeGB) });
            toast('Resize requested');
          } catch (e) {
            toast(e.message, 'error');
          }
        };
        break;
      }

      case 'inspect-disk': {
        header(titleMount, 'Inspect Disk', 'Get-VHD');
        section(bodyMount, `
          <label class="tool-label">Path to .vhd / .vhdx</label>
          <input type="text" class="input input-wide" id="toolInspPath" placeholder="D:\\VMs\\disk.vhdx" />
          <button type="button" class="btn" id="toolInspGo">Inspect</button>
          <div id="toolInspOut" class="tool-out"></div>
        `);
        bodyMount.querySelector('#toolInspGo').onclick = async () => {
          const path = bodyMount.querySelector('#toolInspPath').value.trim();
          if (!path) return toast('Enter path', 'error');
          const out = bodyMount.querySelector('#toolInspOut');
          out.innerHTML = 'Loading…';
          try {
            const r = await api('POST', '/api/vhd/inspect', { path });
            const v = r.vhd;
            const o = Array.isArray(v) ? v[0] : v;
            out.innerHTML = `
              <pre class="tool-pre">Path: ${esc(o.Path)}
Format: ${esc(o.VhdFormat)}
Type: ${esc(o.VhdType)}
Size: ${fmtBytes(o.Size)}
File size: ${fmtBytes(o.FileSize)}
Min size: ${fmtBytes(o.MinimumSize)}</pre>`;
          } catch (e) {
            out.innerHTML = `<p class="tool-err">${esc(e.message)}</p>`;
          }
        };
        break;
      }

      case 'stop-service': {
        header(titleMount, 'Stop Service', 'vmms — stops all VMs');
        section(bodyMount, `
          <p class="tool-err">Stopping the Hyper-V service (<code>vmms</code>) shuts down the hypervisor. All running VMs stop.</p>
          <p class="tool-p">This dashboard does not stop the service automatically. In an <strong>elevated</strong> PowerShell window:</p>
          <pre class="tool-pre">Stop-Service vmms -Force
Start-Service vmms</pre>
          <button type="button" class="btn" id="toolStopCopy">Copy Stop-Service command</button>
        `);
        bodyMount.querySelector('#toolStopCopy').onclick = () => {
          navigator.clipboard.writeText('Stop-Service vmms -Force').then(() => toast('Copied'));
        };
        break;
      }

      case 'remove-server': {
        header(titleMount, 'Remove Server', 'Disconnect from a host');
        const remote = hosts && hosts[0] && !hosts[0].IsLocal;
        section(bodyMount, `
          <p class="tool-p">To stop managing a <strong>remote</strong> Hyper-V host: clear saved credentials and leave Computer empty (local only).</p>
          <p class="tool-p">Current focus: <strong>${esc(computerName || 'local')}</strong></p>
          <button type="button" class="btn" id="toolRmClear">Clear credentials (local session)</button>
          <p class="tool-hint">Removing the local PC from Hyper-V is not applicable — this UI only disconnects remote sessions.</p>
        `);
        bodyMount.querySelector('#toolRmClear').onclick = () => {
          activateView('creds');
          toast('Use Clear saved in Credentials');
        };
        break;
      }

      case 'help': {
        header(titleMount, 'Help', 'Hyper-V Dashboard');
        section(bodyMount, `
          <ul class="tool-ul">
            <li><strong>Sidebar</strong> — MEOW = server tools; pterodactyl = VM tools.</li>
            <li><strong>VM list</strong> — click a row to select; right panel = power actions.</li>
            <li><strong>Credentials</strong> — if you lack Hyper-V rights, save an account in Hyper-V Administrators.</li>
            <li><strong>Refresh</strong> — reloads VM list (also polls every few seconds).</li>
            <li><strong>Keyboard</strong> — Tab into sidebar, ↑↓ rows, Enter on section title collapses.</li>
          </ul>
          <p class="tool-p">Server: <code>${esc(computerName || '')}</code></p>
        `);
        break;
      }

      case 'vm-connect': {
        header(titleMount, 'Connect', 'Interactive session');
        if (!vmName) {
          section(bodyMount, `<p class="tool-err">Select a VM from the list first.</p>`);
          break;
        }
        section(bodyMount, `
          <p class="tool-p">Open the VM console with <strong>vmconnect</strong> (same as Hyper-V Manager → Connect):</p>
          <pre class="tool-pre" id="toolVmconnectCmd">vmconnect ${esc(computerName || 'localhost')} "${esc(vmName)}"</pre>
          <button type="button" class="btn" id="toolVcCopy">Copy command</button>
          <p class="tool-hint">Run in <strong>Win+R</strong> or cmd. RDP to the guest OS is separate (guest IP / hostname).</p>
        `);
        bodyMount.querySelector('#toolVcCopy').onclick = () => {
          const t = `vmconnect ${computerName || 'localhost'} "${vmName}"`;
          navigator.clipboard.writeText(t).then(() => toast('Copied'));
        };
        break;
      }

      case 'vm-settings': {
        header(
          titleMount,
          'VM settings (Hyper-V Manager)',
          esc(vmName || 'VM')
        );
        if (!vmName) {
          section(
            bodyMount,
            `<p class="tool-err">Select a VM from the list first.</p>`
          );
          break;
        }
        const wrap = document.createElement('div');
        wrap.className = 'vmset-page';
        bodyMount.appendChild(wrap);
        await mountFullVmSettings(wrap, vmName, {
          api,
          toast,
          refresh,
          selectVm: ctx.selectVm,
        });
        break;
      }

      case 'vm-move': {
        header(titleMount, 'Move', esc(vmName || 'VM'));
        if (!vmName) {
          section(bodyMount, `<p class="tool-err">Select a VM from the list first.</p>`);
          break;
        }
        section(bodyMount, `
          <p class="tool-hint">Move-VM storage to another folder on the host (VM off recommended).</p>
          <label class="tool-label">Destination folder</label>
          <input type="text" class="input input-wide" id="toolMoveDest" placeholder="D:\\HyperV\\VMs" />
          <button type="button" class="btn" id="toolMoveGo">Move</button>
        `);
        bodyMount.querySelector('#toolMoveGo').onclick = async () => {
          const destination = bodyMount.querySelector('#toolMoveDest').value.trim();
          if (!destination) return toast('Enter folder', 'error');
          try {
            await api('POST', `/api/vms/${encodeURIComponent(vmName)}/move`, {
              destination,
            });
            toast('Move completed');
            refresh();
          } catch (e) {
            toast(e.message, 'error');
          }
        };
        break;
      }

      case 'vm-export': {
        header(titleMount, 'Export', esc(vmName || 'VM'));
        if (!vmName) {
          section(bodyMount, `<p class="tool-err">Select a VM from the list first.</p>`);
          break;
        }
        section(bodyMount, `
          <p class="tool-hint">Export-VM copies the VM to a folder (can take a long time).</p>
          <label class="tool-label">Export folder</label>
          <input type="text" class="input input-wide" id="toolExFolder" placeholder="D:\\Exports\\${esc(vmName)}" />
          <button type="button" class="btn" id="toolExGo">Export</button>
        `);
        bodyMount.querySelector('#toolExGo').onclick = async () => {
          let folder = bodyMount.querySelector('#toolExFolder').value.trim();
          if (!folder) folder = 'D:\\\\Exports\\\\' + vmName;
          try {
            await api('POST', `/api/vms/${encodeURIComponent(vmName)}/export`, {
              folder,
            });
            toast('Export finished');
          } catch (e) {
            toast(e.message, 'error');
          }
        };
        break;
      }

      case 'vm-rename': {
        header(titleMount, 'Rename', esc(vmName || 'VM'));
        if (!vmName) {
          section(bodyMount, `<p class="tool-err">Select a VM from the list first.</p>`);
          break;
        }
        section(bodyMount, `
          <label class="tool-label">New name</label>
          <input type="text" class="input input-wide" id="toolRenNew" value="${esc(vmName)}" />
          <button type="button" class="btn" id="toolRenGo">Rename</button>
        `);
        bodyMount.querySelector('#toolRenGo').onclick = async () => {
          const newName = bodyMount.querySelector('#toolRenNew').value.trim();
          if (!newName || newName === vmName) return toast('Enter a new name', 'error');
          try {
            await api('POST', `/api/vms/${encodeURIComponent(vmName)}/rename`, {
              newName,
            });
            toast('Renamed');
            selectVm(newName);
            refresh();
          } catch (e) {
            toast(e.message, 'error');
          }
        };
        break;
      }

      case 'vm-help': {
        header(titleMount, 'VM Help', esc(vmName || 'VM'));
        section(bodyMount, `
          <ul class="tool-ul">
            <li><strong>Connect</strong> — vmconnect for console.</li>
            <li><strong>Settings</strong> — RAM / CPUs (PUT API).</li>
            <li><strong>Start / Checkpoint / Delete</strong> — run power actions.</li>
            <li><strong>Move / Export / Rename</strong> — use forms in each screen.</li>
          </ul>
        `);
        break;
      }

      default:
        header(titleMount, toolId, 'Unknown tool');
        section(bodyMount, `<p class="tool-p">No UI for this key.</p>`);
    }
  } catch (e) {
    bodyMount.innerHTML = `<p class="tool-err">${esc(e.message)}</p>`;
  }
}
