/**
 * Hyper-V Dashboard — ES module frontend
 */

import {
  vmPanelLayout,
  vmTableHeaderLine,
  vmTableDataLine,
  asciiFramedLines,
  BOX_TL,
  BOX_TR,
  BOX_BL,
  BOX_BR,
  BOX_L,
  BOX_R,
  BOX_V,
  createASCIIBox,
} from './components/ASCIIBox.js';
import { mountSidebar } from './components/Sidebar.js';
import { renderTool } from './js/tool-views.js';

const API = '';
const POLL_MS = 2000;

let vms = [];
let hosts = [];
let selectedVm = null;
let pollTimer = null;
let dashboardMetrics = { avgCpu: 0, memPressurePct: 0, networkPct: 0 };

const $ = (id) => document.getElementById(id);

function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body && (method === 'POST' || method === 'PUT')) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(API + path, opts).then(async (r) => {
    const text = await r.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text.trim() || r.statusText };
      }
    } else {
      data = {};
    }
    if (!r.ok) {
      const msg =
        (data && (data.error || data.message)) || r.statusText || 'Request failed';
      throw new Error(msg);
    }
    return data;
  });
}

function toast(msg, type = 'success') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

function setLoading(loading) {
  const text = $('statusText');
  if (loading) text.textContent = 'Loading...';
  else text.textContent = 'Ready';
}

function formatBytes(n) {
  if (n == null || n === 0) return '—';
  const mb = Math.round(Number(n) / (1024 * 1024));
  return mb + ' MB';
}

function formatUptime(s) {
  if (!s) return '—';
  return String(s).replace(/\.\d+$/, '');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function asciiPctBar(pct, width) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const f = Math.round((p / 100) * width);
  return '#'.repeat(f) + '-'.repeat(Math.max(0, width - f));
}

function miniMetricBar(label, pct, w) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `${label}[${asciiPctBar(p, w)}]${String(Math.round(p)).padStart(3)}%`;
}

function asciiUtilLine(label, pct, width) {
  if (pct == null || Number.isNaN(Number(pct))) {
    return `${label.padEnd(4)} [${'-'.repeat(width)}]  n/a`;
  }
  const p = Math.max(0, Math.min(100, Number(pct)));
  return `${label.padEnd(4)} [${asciiPctBar(p, width)}] ${Math.round(p)}%`;
}

function renderHeader() {
  const el = $('headerAscii');
  if (!el) return;
  const host = ($('hostName') && $('hostName').textContent) || '—';
  const status = ($('statusText') && $('statusText').textContent) || '';
  const time = ($('lastRefresh') && $('lastRefresh').textContent) || '';
  const dot = $('statusDot');
  const d =
    dot && dot.classList.contains('error')
      ? '!'
      : dot && dot.classList.contains('ready')
        ? '*'
        : '·';
  const line1 = `${host}  ${d}  ${status}  ${time}`.trim();
  const m = dashboardMetrics;
  const line2 = `${miniMetricBar('CPU', m.avgCpu, 8)}  ${miniMetricBar('MEM', m.memPressurePct, 8)}  ${miniMetricBar('NET', m.networkPct, 8)}`;
  const lines = asciiFramedLines('HYPER-V DASHBOARD', [line1, line2]);
  el.textContent = lines.join('\n');
}

function renderVmLiveGraph() {
  const mount = $('vmGraphMount');
  if (!mount) return;
  if (!selectedVm || $('vmsPanel').classList.contains('hidden')) {
    mount.classList.add('hidden');
    mount.innerHTML = '';
    return;
  }
  const v = selectedVm;
  const name = v.Name || v.name;
  const state = String(v.State || '').toLowerCase();
  const running = state === 'running';
  let cpuPct = null;
  if (running && v.CPUUsage != null) cpuPct = Number(v.CPUUsage);
  let ramPct = null;
  const assigned = Number(v.MemoryAssigned) || 0;
  const demand = Number(v.MemoryDemand) || 0;
  if (running && assigned > 0) {
    ramPct = Math.min(100, Math.round((demand / assigned) * 100));
  }
  const title = `${name} — live`;
  const body = [
    asciiUtilLine('CPU', cpuPct, 36),
    asciiUtilLine('RAM', ramPct, 36) +
      (running && assigned ? '  (demand/assigned)' : ''),
  ];
  const lines = asciiFramedLines(title, body);
  const iw = Math.max(2, (lines[0] && lines[0].length) - 2);
  mount.innerHTML = '';
  mount.style.setProperty('--ascii-inner-w', String(iw));
  mount.classList.remove('hidden');
  lines.forEach((ln) => {
    const d = document.createElement('div');
    d.className = 'ascii-box-line ascii-box-edge';
    d.textContent = ln;
    mount.appendChild(d);
  });
}

function getTargetVmName() {
  const v =
    selectedVm ||
    vms.find((x) => (x.Name || x.name || '').toLowerCase() === 'pterodactyl') ||
    vms[0];
  return v ? v.Name || v.name : null;
}

function getTargetVm() {
  const n = getTargetVmName();
  return n ? vms.find((x) => (x.Name || x.name) === n) : null;
}

function toolCtx() {
  return {
    api,
    toast,
    refresh,
    getTargetVmName,
    getTargetVm,
    selectVm,
    runAction,
    activateView,
    vms,
    hosts,
    computerName:
      (hosts[0] && (hosts[0].Name || hosts[0].Id)) ||
      (($('hostName') && $('hostName').textContent) || '').trim() ||
      'localhost',
  };
}

function openTool(toolId) {
  activateView('tool', toolId);
}

function activateView(view, toolId) {
  $('vmsPanel').classList.toggle('hidden', view !== 'vms');
  $('createPanel').classList.toggle('hidden', view !== 'create');
  $('credsPanel').classList.toggle('hidden', view !== 'creds');
  const tp = $('toolPanel');
  if (tp) tp.classList.toggle('hidden', view !== 'tool');
  const hideDetail =
    view === 'create' || view === 'creds' || view === 'tool';
  $('detailPanel').classList.toggle('hidden', hideDetail);
  if (view !== 'vms') {
    const gm = $('vmGraphMount');
    if (gm) gm.classList.add('hidden');
  } else {
    renderVmLiveGraph();
  }
  if (view === 'tool' && toolId) {
    const ta = $('toolTitleAscii');
    const tb = $('toolBody');
    if (ta && tb) renderTool(toolId, ta, tb, toolCtx());
  }
}

function renderVmTable() {
  const mount = $('vmTableMount');
  if (!mount) return;

  const headerLine = vmTableHeaderLine();
  const dataLines = vms.map((vm) => vmTableDataLine(vm, formatBytes, formatUptime));
  const { mt, bar, title, headerLine: hl, rows } = vmPanelLayout(
    'Virtual Machines',
    headerLine,
    dataLines,
    'No VMs found'
  );

  mount.innerHTML = '';
  mount.style.setProperty('--ascii-inner-w', String(bar.length));

  const appendEdge = (text) => {
    const d = document.createElement('div');
    d.className = 'ascii-box-line ascii-box-edge';
    d.textContent = text;
    mount.appendChild(d);
  };

  const appendMidRow = (coreText, className) => {
    const d = document.createElement('div');
    d.className = 'ascii-panel-row ' + (className || '');
    const l = document.createElement('span');
    l.className = 'ascii-box-edge-ch';
    l.textContent = BOX_V;
    const m = document.createElement('span');
    m.className = 'ascii-box-row-mid';
    m.textContent = ' ' + String(coreText).slice(0, mt).padEnd(mt) + ' ';
    const r = document.createElement('span');
    r.className = 'ascii-box-edge-ch';
    r.textContent = BOX_V;
    d.append(l, m, r);
    mount.appendChild(d);
  };

  appendEdge(BOX_TL + bar + BOX_TR);
  appendMidRow(title, 'ascii-table-title');
  appendEdge(BOX_L + bar + BOX_R);
  appendMidRow(hl, 'ascii-table-title');
  appendEdge(BOX_L + bar + BOX_R);

  if (!vms.length) {
    appendMidRow(rows[0], '');
    appendEdge(BOX_BL + bar + BOX_BR);
    return;
  }

  vms.forEach((vm) => {
    const n = vm.Name || vm.name;
    const btn = document.createElement('button');
    btn.type = 'button';
    const sel =
      selectedVm && (selectedVm.Name || selectedVm.name) === n ? ' selected' : '';
    btn.className = 'ascii-table-row' + sel;
    const line = vmTableDataLine(vm, formatBytes, formatUptime);
    const core = ' ' + line.slice(0, mt).padEnd(mt) + ' ';

    const left = document.createElement('span');
    left.className = 'ascii-box-edge-ch';
    left.textContent = BOX_V;
    const mid = document.createElement('span');
    mid.className = 'ascii-box-row-mid ascii-table-row-inner';
    mid.textContent = core;
    const right = document.createElement('span');
    right.className = 'ascii-box-edge-ch';
    right.textContent = BOX_V;
    btn.append(left, mid, right);
    btn.addEventListener('click', () => selectVm(n));
    mount.appendChild(btn);
  });

  appendEdge(BOX_BL + bar + BOX_BR);
}

function selectVm(name) {
  selectedVm = vms.find((v) => (v.Name || v.name) === name) || null;
  renderVmTable();
  renderVmLiveGraph();
  renderActions();
  renderDetail();
}

function renderActions() {
  const host = $('actionsMount');
  if (!host) return;
  host.innerHTML = '';

  if (!selectedVm) {
    host.appendChild(
      createASCIIBox({
        title: 'ACTIONS',
        items: [{ label: 'Select a VM', disabled: true }],
        onItemClick: () => {},
      })
    );
    return;
  }

  const n = selectedVm.Name || selectedVm.name;
  const state = (selectedVm.State || selectedVm.state || '').toLowerCase();
  const running = state === 'running';
  const off = state === 'off';
  const paused = state.includes('paus') || state === 'saved';
  const title = n.length > 22 ? n.slice(0, 20) + '..' : n;

  const box = createASCIIBox({
    title,
    items: [
      { label: 'Full settings…', disabled: false },
      { label: 'Start', disabled: running },
      { label: 'Stop', disabled: off },
      { label: 'Restart', disabled: off },
      { label: 'Pause', disabled: !running },
      { label: 'Resume', disabled: !paused },
      { label: 'Checkpoint', disabled: false },
      { label: 'Snapshots', disabled: false },
      { label: 'Delete VM', disabled: false },
    ],
    onItemClick: (label) => {
      if (label === 'Full settings…') {
        openTool('vm-settings');
        return;
      }
      const map = {
        Start: 'start',
        Stop: 'stop',
        Restart: 'restart',
        Pause: 'pause',
        Resume: 'resume',
        Checkpoint: 'checkpoint',
        Snapshots: 'checkpoints',
        'Delete VM': 'delete',
      };
      runAction(map[label] || label.toLowerCase().replace(/\s/g, ''));
    },
  });
  host.appendChild(box);
}

function runAction(action) {
  if (!selectedVm) return;
  const name = selectedVm.Name || selectedVm.name;
  const run = (fn) => {
    setLoading(true);
    fn()
      .then(() => {
        toast('Done');
        refresh();
      })
      .catch((e) => {
        toast(e.message || 'Error', 'error');
      })
      .finally(() => setLoading(false));
  };
  switch (action) {
    case 'start':
      run(() => api('POST', `/api/vms/${encodeURIComponent(name)}/start`));
      break;
    case 'stop':
      run(() => api('POST', `/api/vms/${encodeURIComponent(name)}/stop`));
      break;
    case 'restart':
      run(() => api('POST', `/api/vms/${encodeURIComponent(name)}/restart`));
      break;
    case 'pause':
      run(() => api('POST', `/api/vms/${encodeURIComponent(name)}/pause`));
      break;
    case 'resume':
      run(() => api('POST', `/api/vms/${encodeURIComponent(name)}/resume`));
      break;
    case 'checkpoint':
      run(() => api('POST', `/api/vms/${encodeURIComponent(name)}/checkpoint`, {}));
      break;
    case 'checkpoints':
      api('GET', `/api/vms/${encodeURIComponent(name)}/checkpoints`)
        .then(({ checkpoints }) => showCheckpointsModal(name, checkpoints || []))
        .catch((e) => toast(e.message, 'error'));
      break;
    case 'delete':
      showConfirmModal(`Delete VM "${name}"? This cannot be undone.`, () => {
        run(() => api('DELETE', `/api/vms/${encodeURIComponent(name)}`));
        selectedVm = null;
      });
      break;
    default:
      console.log('action', action);
  }
}

function showConfirmModal(msg, onConfirm) {
  const modal = $('modal');
  const box = $('modalBox');
  box.textContent = '';
  box.innerHTML = `${escapeHtml(msg)}\n\n`;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn';
  cancelBtn.id = 'modalCancel';
  cancelBtn.textContent = 'Cancel';
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'btn btn-danger';
  okBtn.id = 'modalConfirm';
  okBtn.textContent = 'Delete';
  box.appendChild(cancelBtn);
  box.appendChild(document.createTextNode(' '));
  box.appendChild(okBtn);
  modal.classList.remove('hidden');
  const cancel = () => {
    modal.classList.add('hidden');
  };
  cancelBtn.onclick = cancel;
  okBtn.onclick = () => {
    cancel();
    onConfirm();
  };
}

function showCheckpointsModal(vmName, checkpoints) {
  const modal = $('modal');
  const box = $('modalBox');
  const closeModal = () => modal.classList.add('hidden');
  if (!checkpoints.length) {
    box.textContent = '';
    box.appendChild(document.createTextNode(`No checkpoints for ${vmName}\n\n`));
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeModal);
    box.appendChild(closeBtn);
  } else {
    box.textContent = `Checkpoints for ${vmName}:\n`;
    checkpoints.forEach((cp) => {
      const row = document.createElement('div');
      row.textContent = cp.Name + ' ';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn btn-danger btn-sm';
      rm.textContent = 'Remove';
      rm.dataset.snapshot = cp.Name;
      rm.addEventListener('click', () => {
        const snap = rm.dataset.snapshot;
        api(
          'DELETE',
          `/api/vms/${encodeURIComponent(vmName)}/checkpoints/${encodeURIComponent(snap)}`
        )
          .then(() => {
            toast('Checkpoint removed');
            showCheckpointsModal(
              vmName,
              checkpoints.filter((c) => c.Name !== snap)
            );
          })
          .catch((e) => toast(e.message, 'error'));
      });
      row.appendChild(rm);
      box.appendChild(row);
    });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeModal);
    box.appendChild(document.createElement('br'));
    box.appendChild(closeBtn);
  }
  modal.classList.remove('hidden');
}

function renderDetail() {
  const mount = $('detailMount');
  if (!mount) return;
  mount.innerHTML = '';
  if (!selectedVm) {
    const lines = asciiFramedLines('VM Details', ['Select a VM']);
    lines.forEach((ln) => {
      const d = document.createElement('div');
      d.className = 'ascii-box-line ascii-box-edge';
      d.textContent = ln;
      mount.appendChild(d);
    });
    return;
  }
  const v = selectedVm;
  const state = v.State || v.state || '—';
  const body = [
    `Name: ${v.Name || v.name}`,
    `State: ${state}`,
    `CPU usage: ${v.CPUUsage != null ? v.CPUUsage + '%' : '—'}`,
    `RAM assigned: ${formatBytes(v.MemoryAssigned)}`,
    `Uptime: ${formatUptime(v.Uptime)}`,
  ];
  const framed = asciiFramedLines('VM Details', body);
  framed.forEach((ln) => {
    const d = document.createElement('div');
    d.className = 'ascii-box-line ascii-box-edge';
    d.textContent = ln;
    mount.appendChild(d);
  });
}

function renderCreateFrame() {
  const mount = $('createFrameMount');
  if (!mount) return;
  mount.innerHTML = '';
  const lines = asciiFramedLines('New Virtual Machine', [
    'Fill name, RAM, CPUs, disk — then Create.',
  ]);
  lines.forEach((ln) => {
    const d = document.createElement('div');
    d.className = 'ascii-box-line ascii-box-edge';
    d.textContent = ln;
    mount.appendChild(d);
  });
  const form = document.createElement('div');
  form.className = 'create-fields';
  form.innerHTML = `
    <label>Name</label>
    <input type="text" id="newVmName" placeholder="VM name" class="input input-wide" />
    <label>RAM (MB)</label>
    <input type="number" id="newVmRam" value="1024" min="256" class="input num" />
    <label>CPUs</label>
    <input type="number" id="newVmCpu" value="2" min="1" max="64" class="input num" />
    <label>Disk (GB)</label>
    <input type="number" id="newVmDisk" value="60" min="1" class="input num" />
    <button type="button" class="btn btn-create" id="btnCreateVm">Create VM</button>`;
  mount.appendChild(form);
  $('btnCreateVm').addEventListener('click', () => {
    const name = ($('newVmName').value || '').trim();
    if (!name) {
      toast('Enter a VM name', 'error');
      return;
    }
    const ram = parseInt($('newVmRam').value, 10) || 1024;
    const cpu = parseInt($('newVmCpu').value, 10) || 2;
    const disk = parseInt($('newVmDisk').value, 10) || 60;
    setLoading(true);
    api('POST', '/api/vms', {
      name,
      memoryMB: ram,
      processorCount: cpu,
      diskSizeGB: disk,
    })
      .then(() => {
        toast('VM created');
        $('newVmName').value = '';
        activateView('vms');
        refresh();
      })
      .catch((e) => toast(e.message || 'Create failed', 'error'))
      .finally(() => setLoading(false));
  });
}

function renderCredsAscii() {
  const mount = $('credsAsciiMount');
  if (!mount) return;
  mount.innerHTML = '';
  const lines = asciiFramedLines('Hyper-V access', [
    'If you see authorization or permission errors:',
    'Run start.ps1 as Administrator, or add your user',
    'to Hyper-V Administrators, or save credentials below.',
  ]);
  lines.forEach((ln) => {
    const d = document.createElement('div');
    d.className = 'ascii-box-line ascii-box-edge';
    d.textContent = ln;
    mount.appendChild(d);
  });
}

function refresh() {
  setLoading(true);
  const banner = $('permBanner');
  let hostErr = null;
  let vmErr = null;
  api('GET', '/api/hosts')
    .then((hRes) => {
      hosts = hRes.hosts || [];
      const h0 = hosts[0];
      if (h0 && h0.Error) hostErr = h0.Error;
    })
    .catch((e) => {
      hostErr = e.message;
      hosts = [];
    })
    .then(() => api('GET', '/api/vms'))
    .then((vRes) => {
      vms = vRes.vms || [];
      dashboardMetrics = vRes.metrics || {
        avgCpu: 0,
        memPressurePct: 0,
        networkPct: 0,
      };
    })
    .catch((e) => {
      vmErr = e.message;
      vms = [];
      dashboardMetrics = { avgCpu: 0, memPressurePct: 0, networkPct: 0 };
    })
    .then(() => {
      const msg = vmErr || hostErr;
      const show =
        msg &&
        (/permission|authorization|required|access|denied|credential/i.test(msg) ||
          vmErr);
      if (show) {
        banner.textContent =
          (msg || '') +
          ' — Open Credentials (sidebar), use Hyper-V Administrators, or run start.ps1 as Administrator.';
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
      const hn = (hosts[0] && (hosts[0].Name || hosts[0].Id)) || 'Local';
      $('hostName').textContent = hn;
      renderVmTable();
      renderVmLiveGraph();
      if (selectedVm) {
        selectedVm =
          vms.find(
            (v) => (v.Name || v.name) === (selectedVm.Name || selectedVm.name)
          ) || selectedVm;
        renderActions();
        renderDetail();
      } else {
        renderActions();
        renderDetail();
      }
      $('lastRefresh').textContent = new Date().toLocaleTimeString();
      const dot = $('statusDot');
      if (vmErr && !hostErr) {
        dot.className = 'status-dot error';
        $('statusText').textContent = 'VM list error';
      } else if (hostErr && !vms.length) {
        dot.className = 'status-dot error';
        $('statusText').textContent = 'Host error';
      } else {
        dot.className = 'status-dot ready';
        $('statusText').textContent = 'Ready';
      }
      renderHeader();
      if (vmErr) toast(vmErr, 'error');
    })
    .finally(() => setLoading(false));
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, POLL_MS);
}

function initCreds() {
  api('GET', '/api/session')
    .then((s) => {
      const hint = $('localHostHint');
      if (hint && s.localHost) hint.textContent = '(this PC: ' + s.localHost + ')';
      const st = $('credsStatus');
      if (st && s.configured) {
        st.textContent =
          'Using saved credentials: ' + s.username + ' @ ' + s.computerName;
        st.classList.remove('err');
      }
    })
    .catch(() => {});
  $('btnCredSave').addEventListener('click', () => {
    const username = ($('credUser').value || '').trim();
    const password = $('credPass').value || '';
    const computerName = ($('credComputer').value || '').trim();
    const st = $('credsStatus');
    if (!username || !password) {
      st.textContent = 'Enter username and password.';
      st.classList.add('err');
      return;
    }
    api('POST', '/api/session', { username, password, computerName })
      .then(() => {
        st.textContent = 'Saved. Refreshing…';
        st.classList.remove('err');
        $('credPass').value = '';
        refresh();
      })
      .catch((e) => {
        st.textContent = e.message || 'Save failed';
        st.classList.add('err');
      });
  });
  $('btnCredTest').addEventListener('click', () => {
    const username = ($('credUser').value || '').trim();
    const password = $('credPass').value || '';
    const computerName = ($('credComputer').value || '').trim();
    const st = $('credsStatus');
    if (!username || !password) {
      st.textContent = 'Enter username and password to test.';
      st.classList.add('err');
      return;
    }
    st.textContent = 'Testing…';
    st.classList.remove('err');
    fetch(API + '/api/session/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, computerName }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          st.textContent =
            'OK — ' + j.vmCount + ' VM(s). Click Save & use to keep.';
          st.classList.remove('err');
        } else {
          st.textContent = j.error || 'Failed';
          st.classList.add('err');
        }
      })
      .catch((e) => {
        st.textContent = e.message;
        st.classList.add('err');
      });
  });
  $('btnCredClear').addEventListener('click', () => {
    api('DELETE', '/api/session').then(() => {
      $('credsStatus').textContent = 'Cleared.';
      $('credsStatus').classList.remove('err');
      refresh();
    });
  });
}

function handleSidebarAction(section, label) {
  console.log(`[${section}]`, label);

  if (section === 'server') {
    if (
      label === 'Quick Create...' ||
      label === 'New' ||
      label === '> New VM'
    ) {
      activateView('create');
      return;
    }
    if (label === 'Import Virtual Machine...') {
      openTool('import-vm');
      return;
    }
    if (label === 'Hyper-V Settings...') {
      openTool('hyperv-settings');
      return;
    }
    if (label === 'Virtual Switch Manager...') {
      openTool('switches');
      return;
    }
    if (label === 'Virtual SAN Manager...') {
      openTool('san');
      return;
    }
    if (label === 'Edit Disk...') {
      openTool('edit-disk');
      return;
    }
    if (label === 'Inspect Disk...') {
      openTool('inspect-disk');
      return;
    }
    if (label === 'Stop Service') {
      openTool('stop-service');
      return;
    }
    if (label === 'Remove Server') {
      openTool('remove-server');
      return;
    }
    if (label === '> VM list' || label === 'View') {
      activateView('vms');
      return;
    }
    if (label === '> Credentials') {
      activateView('creds');
      return;
    }
    if (label === 'Refresh') {
      refresh();
      return;
    }
    if (label === 'Help') {
      openTool('help');
      return;
    }
    return;
  }

  if (section === 'vm') {
    const vm =
      selectedVm ||
      vms.find(
        (v) => (v.Name || v.name || '').toLowerCase() === 'pterodactyl'
      ) ||
      vms[0];
    if (label === 'Connect...') {
      openTool('vm-connect');
      return;
    }
    if (label === 'Settings...') {
      openTool('vm-settings');
      return;
    }
    if (label === 'Move...') {
      openTool('vm-move');
      return;
    }
    if (label === 'Export...') {
      openTool('vm-export');
      return;
    }
    if (label === 'Rename...') {
      openTool('vm-rename');
      return;
    }
    if (label === 'Help') {
      openTool('vm-help');
      return;
    }
    if (
      (label === 'Start' || label === 'Checkpoint' || label === 'Delete...') &&
      !vm
    ) {
      toast('No VM available', 'error');
      return;
    }
    if (label === 'Start' && vm) {
      selectVm(vm.Name || vm.name);
      runAction('start');
      return;
    }
    if (label === 'Checkpoint' && vm) {
      selectVm(vm.Name || vm.name);
      runAction('checkpoint');
      return;
    }
    if (label === 'Delete...' && vm) {
      selectVm(vm.Name || vm.name);
      runAction('delete');
      return;
    }
  }
}

function initElectronChrome() {
  if (typeof window.electronAPI === 'undefined') return;
  document.body.classList.add('electron-app');
  const ctrls = $('electronControls');
  if (ctrls) {
    ctrls.classList.remove('hidden');
    ctrls.setAttribute('aria-hidden', 'false');
  }
  const minB = $('electronMin');
  const maxB = $('electronMax');
  const closeB = $('electronClose');
  if (minB)
    minB.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI.minimize();
    });
  if (maxB)
    maxB.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI.maximize();
    });
  if (closeB)
    closeB.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI.close();
    });
}

function init() {
  const meta = document.createElement('div');
  meta.className = 'sr-only';
  meta.setAttribute('aria-hidden', 'true');
  meta.innerHTML =
    '<span id="hostName"></span><span id="statusDot" class="status-dot"></span><span id="statusText"></span><span id="lastRefresh"></span>';
  document.body.insertBefore(meta, document.body.firstChild);

  initElectronChrome();

  mountSidebar($('sidebarMount'), handleSidebarAction);

  renderCreateFrame();
  renderCredsAscii();
  initCreds();
  activateView('vms');
  refresh();
  startPolling();
}

const style = document.createElement('style');
style.textContent = '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}';
document.head.appendChild(style);

init();
