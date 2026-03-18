/**
 * Hyper-V Dashboard - Local API server
 * Serves static frontend and REST API for Hyper-V management.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ps = require('./powershell');
const session = require('./session');

const PORT = process.env.PORT || 3780;
const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
};

function send(res, status, body, contentType = 'application/json') {
  res.writeHead(status, { 'Content-Type': contentType });
  if (Buffer.isBuffer(body)) {
    res.end(body);
    return;
  }
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

const routes = {
  'GET /api/session': async () => ({
    ...session.getSessionPublic(),
    localHost: ps.localHostname()
  }),
  'POST /api/session': async (body) => {
    session.setSession({
      username: body.username,
      password: body.password,
      computerName: (body.computerName || '').trim()
    });
    return { ok: true, ...session.getSessionPublic(), localHost: ps.localHostname() };
  },
  'DELETE /api/session': async () => {
    session.clearSession();
    return { ok: true };
  },
  'POST /api/session/test': async () => {
    const vms = await ps.getVMs();
    return { ok: true, vmCount: vms.length };
  },
  'POST /api/session/verify': async (body) => {
    if (!body.username || !body.password) {
      return { ok: false, error: 'Enter username and password' };
    }
    const snap = session.snapshotSession();
    try {
      session.setSession({
        username: body.username,
        password: body.password,
        computerName: (body.computerName || '').trim()
      });
      const vms = await ps.getVMs();
      const list = Array.isArray(vms) ? vms : (vms ? [vms] : []);
      return { ok: true, vmCount: list.length };
    } catch (e) {
      return { ok: false, error: e.message || 'Verify failed' };
    } finally {
      session.restoreSession(snap);
    }
  },
  'GET /api/hosts': async () => {
    try {
      const hosts = await ps.getHosts();
      return { hosts };
    } catch (e) {
      const msg = e.message || 'Host query failed';
      return {
        hosts: [
          {
            Name: ps.localHostname(),
            Id: ps.localHostname(),
            IsLocal: true,
            VMCount: 0,
            Error: msg
          }
        ]
      };
    }
  },
  'GET /api/vms': async () => {
    try {
      const { vms, metrics } = await ps.getVMsWithMetrics();
      return { vms: vms || [], metrics: metrics || {} };
    } catch {
      let vms = await ps.getVMs();
      if (vms && !Array.isArray(vms)) vms = [vms];
      return {
        vms: vms || [],
        metrics: { avgCpu: 0, memPressurePct: 0, networkPct: 0 },
      };
    }
  },
  'POST /api/vms/:name/start': async (_, name) => {
    await ps.vmAction(name, 'start');
    return { ok: true };
  },
  'POST /api/vms/:name/stop': async (_, name) => {
    await ps.vmAction(name, 'stop');
    return { ok: true };
  },
  'POST /api/vms/:name/restart': async (_, name) => {
    await ps.vmAction(name, 'restart');
    return { ok: true };
  },
  'POST /api/vms/:name/pause': async (_, name) => {
    await ps.vmAction(name, 'pause');
    return { ok: true };
  },
  'POST /api/vms/:name/resume': async (_, name) => {
    await ps.vmAction(name, 'resume');
    return { ok: true };
  },
  'GET /api/vms/:name/settings': async (_, name) => {
    const settings = await ps.getVMFullSettings(name);
    return { settings };
  },
  'PUT /api/vms/:name/settings': async (body, name) => {
    await ps.setVMFullSettings(name, body);
    return { ok: true };
  },
  'POST /api/vms/:name/hardware': async (body, name) => {
    const t = body.type || body.hardwareType;
    if (!t) throw new Error('type required: networkAdapter | scsiController | hardDrive');
    await ps.addVMHardware(name, t, body);
    return { ok: true };
  },
  'GET /api/vms/:name/checkpoints': async (_, name) => {
    const checkpoints = await ps.getCheckpoints(name);
    return { checkpoints };
  },
  'POST /api/vms/:name/checkpoint': async (body, name) => {
    const result = await ps.createCheckpoint(name, body.name || body.snapshotName);
    return result;
  },
  'DELETE /api/vms/:name/checkpoints/:snapshot': async (_, name, snapshot) => {
    await ps.removeCheckpoint(name, decodeURIComponent(snapshot));
    return { ok: true };
  },
  'GET /api/switches/adapters': async () => {
    const adapters = await ps.getNetAdaptersForSwitch();
    return { adapters };
  },
  'GET /api/switches': async () => {
    const switches = await ps.getVMSwitches();
    return { switches };
  },
  'POST /api/switches': async (body) => {
    await ps.createVMSwitch(body || {});
    return { ok: true };
  },
  'PUT /api/switches/:name': async (body, name) => {
    const decoded = decodeURIComponent(name);
    if (body && body.newName && String(body.newName).trim()) {
      await ps.renameVMSwitch(decoded, body.newName.trim());
      return { ok: true, renamed: true };
    }
    await ps.setVMSwitch(decoded, body || {});
    return { ok: true };
  },
  'DELETE /api/switches/:name': async (_, name, force) => {
    await ps.removeVMSwitch(name, !!force);
    return { ok: true };
  },
  'GET /api/sans/hbas': async () => {
    const hbas = await ps.getFibreChannelHostBusAdapters();
    return { hbas };
  },
  'GET /api/sans': async () => {
    const sans = await ps.getVMSans();
    return { sans };
  },
  'POST /api/sans': async (body) => {
    await ps.createVMSan(body || {});
    return { ok: true };
  },
  'PUT /api/sans/:name': async (body, name) => {
    await ps.setVMSan(name, body || {});
    return { ok: true };
  },
  'DELETE /api/sans/:name': async (_, name) => {
    await ps.removeVMSan(name);
    return { ok: true };
  },
  'GET /api/vmhost': async () => {
    const host = await ps.getVMHostInfo();
    return { host };
  },
  'POST /api/vhd/inspect': async (body) => {
    if (!body.path) throw new Error('path required');
    const info = await ps.inspectVhd(body.path.trim());
    return { vhd: info };
  },
  'POST /api/vhd/resize': async (body) => {
    if (!body.path || body.sizeGB == null) throw new Error('path and sizeGB required');
    await ps.resizeVhd(body.path.trim(), Math.round(Number(body.sizeGB) * 1024 * 1024 * 1024));
    return { ok: true };
  },
  'POST /api/vms/:name/rename': async (body, name) => {
    if (!body.newName) throw new Error('newName required');
    await ps.renameVMVm(decodeURIComponent(name), String(body.newName).trim());
    return { ok: true };
  },
  'POST /api/vms/:name/export': async (body, name) => {
    if (!body.folder) throw new Error('folder required');
    await ps.exportVMVm(decodeURIComponent(name), String(body.folder).trim());
    return { ok: true };
  },
  'POST /api/vms/:name/move': async (body, name) => {
    if (!body.destination) throw new Error('destination folder required');
    await ps.moveVMVm(decodeURIComponent(name), String(body.destination).trim());
    return { ok: true };
  },
  'POST /api/vms': async (body) => {
    const result = await ps.createVM({
      name: body.name,
      memoryMB: body.memoryMB ?? body.ram,
      processorCount: body.processorCount ?? body.cpu,
      diskSizeGB: body.diskSizeGB ?? body.diskSize
    });
    return result;
  },
  'PUT /api/vms/:name': async (body, name) => {
    await ps.updateVM(name, {
      memoryMB: body.memoryMB ?? body.ram,
      processorCount: body.processorCount ?? body.cpu
    });
    return { ok: true };
  },
  'DELETE /api/vms/:name': async (_, name) => {
    await ps.deleteVM(name);
    return { ok: true };
  }
};

function matchRoute(method, url) {
  const [pathPart, query] = url.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  for (const [key, handler] of Object.entries(routes)) {
    const [m, ...pattern] = key.split(' ');
    const pathPattern = pattern.join('/').split('/').filter(Boolean);
    if (m !== method || segments.length < pathPattern.length) continue;
    const params = [];
    let match = true;
    for (let i = 0; i < pathPattern.length; i++) {
      if (pathPattern[i].startsWith(':')) {
        params.push(segments[i]);
      } else if (pathPattern[i] !== segments[i]) {
        match = false;
        break;
      }
    }
    if (match && segments.length === pathPattern.length) {
      return { handler, params, query: query || '' };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const rawUrl = req.url.split('?')[0];
  if (rawUrl === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url === '/' ? '/index.html' : req.url;
  const route = matchRoute(req.method, url);

  if (route) {
    try {
      const body = req.method === 'POST' || req.method === 'PUT' ? await parseBody(req) : {};
      const pathOnly = req.url.split('?')[0];
      const isSwitchDelete =
        req.method === 'DELETE' &&
        /^\/api\/switches\/[^/]+$/i.test(pathOnly);
      let result;
      if (isSwitchDelete) {
        const sp = new URLSearchParams(route.query || '');
        const force =
          sp.get('force') === '1' ||
          sp.get('force') === 'true' ||
          sp.get('force') === 'yes';
        result = await route.handler(body, ...route.params, force);
      } else {
        result = await route.handler(body, ...route.params);
      }
      send(res, 200, result);
    } catch (err) {
      send(res, 500, { error: err.message || 'Server error' });
    }
    return;
  }

  const apiPath = rawUrl.split('?')[0];
  if (apiPath === '/api' || apiPath.startsWith('/api/')) {
    send(res, 404, {
      error: 'API route not found',
      path: apiPath,
      method: req.method,
    });
    return;
  }

  const filePath = path.join(PUBLIC, path.normalize(url).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!filePath.startsWith(PUBLIC)) {
    send(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') send(res, 404, { error: 'Not found' });
      else send(res, 500, { error: 'Error reading file' });
      return;
    }
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hyper-V Dashboard: http://127.0.0.1:${PORT}`);
});
