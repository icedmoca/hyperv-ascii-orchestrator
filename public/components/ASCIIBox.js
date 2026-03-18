/**
 * Single source for UTF-8 box drawing: ┌ ┐ └ ┘ ─ │
 * Inner width = max(text lengths) + 2 (one space each side of text column).
 */

export const BOX_H = '─';
export const BOX_TL = '┌';
export const BOX_TR = '┐';
export const BOX_BL = '└';
export const BOX_BR = '┘';
export const BOX_L = '├';
export const BOX_R = '┤';
export const BOX_V = '│';

const H = BOX_H;
const TL = BOX_TL;
const TR = BOX_TR;
const BL = BOX_BL;
const BR = BOX_BR;
const L = BOX_L;
const R = BOX_R;
const V = BOX_V;

/**
 * @param {string} title
 * @param {string[]} items
 * @returns {number} characters between corners (excluding vertical bars)
 */
function itemLabel(it) {
  return typeof it === 'string' ? it : String(it.label || '');
}

export function innerWidth(title, items) {
  const list = items || [];
  const lens = list.map((s) => itemLabel(s).length);
  const maxText = Math.max(String(title).length, ...(lens.length ? lens : [0]));
  return maxText + 2;
}

/**
 * @param {string} title
 * @param {string[]} items
 * @returns {string[]} each full line including border chars (no newline)
 */
export function asciiBoxLines(title, items) {
  const iw = innerWidth(title, items);
  const bar = H.repeat(iw);
  const maxText = iw - 2;
  const cell = (text) => {
    const t = String(text).slice(0, maxText);
    return V + ' ' + t.padEnd(maxText) + ' ' + V;
  };
  const lines = [
    TL + bar + TR,
    cell(title),
    L + bar + R,
    ...(items || []).map((it) => cell(itemLabel(it))),
    BL + bar + BR,
  ];
  return lines;
}

/**
 * @param {string} title
 * @param {string[]} items
 * @returns {string}
 */
export function asciiBoxText(title, items) {
  return asciiBoxLines(title, items).join('\n');
}

/**
 * Framed block: title row + separator + body lines (plain text, no wrapping).
 * @param {string} title
 * @param {string[]} bodyLines
 */
export function asciiFramedLines(title, bodyLines) {
  const body = bodyLines || [];
  const maxText = Math.max(
    String(title).length,
    ...body.map((s) => String(s).length)
  );
  const iw = maxText + 2;
  const bar = H.repeat(iw);
  const maxT = iw - 2;
  const cell = (text) => {
    const t = String(text).slice(0, maxT);
    return V + ' ' + t.padEnd(maxT) + ' ' + V;
  };
  return [TL + bar + TR, cell(title), L + bar + R, ...body.map(cell), BL + bar + BR];
}

function padStr(s, w) {
  const t = String(s);
  return t.length <= w ? t.padEnd(w) : t.slice(0, w);
}

/**
 * VM list table: fixed columns, aligned rows.
 */
export function vmTableHeaderLine() {
  return (
    padStr('NAME', 16) +
    ' ' +
    padStr('STATE', 10) +
    ' ' +
    padStr('CPU %', 6) +
    ' ' +
    padStr('RAM(MB)', 10) +
    ' ' +
    padStr('UPTIME', 20)
  );
}

export function vmTableDataLine(vm, formatBytes, formatUptime) {
  const name = vm.Name || vm.name || '';
  const state = vm.State || vm.state || '—';
  const cpu = vm.CPUUsage != null ? String(vm.CPUUsage) + '%' : '—';
  const ram = formatBytes(vm.MemoryAssigned);
  const up = formatUptime(vm.Uptime);
  return (
    padStr(name, 16) +
    ' ' +
    padStr(state, 10) +
    ' ' +
    padStr(cpu, 6) +
    ' ' +
    padStr(ram, 10) +
    ' ' +
    padStr(up, 20)
  );
}

/**
 * VM panel: title + header row + data rows; returns dims + row strings for DOM rows.
 */
export function vmPanelLayout(title, headerLine, dataLines, emptyMsg) {
  const rows = dataLines.length ? dataLines : [emptyMsg || 'No VMs'];
  const maxText = Math.max(
    String(title).length,
    String(headerLine).length,
    ...rows.map((r) => String(r).length)
  );
  const iw = maxText + 2;
  const mt = iw - 2;
  const bar = H.repeat(iw);
  return { iw, mt, bar, title, headerLine, rows };
}

/**
 * DOM: titled box with clickable rows (monospace-aligned).
 * @param {object} opts
 * @param {string} opts.title
 * @param {(string|{label: string, disabled?: boolean})[]} opts.items
 * @param {function(string, number): void} opts.onItemClick
 * @param {boolean} [opts.collapsible]
 * @param {boolean} [opts.startCollapsed]
 */
export function createASCIIBox(opts) {
  const {
    title,
    items,
    onItemClick,
    collapsible = false,
    startCollapsed = false,
  } = opts;
  const itemList = items || [];
  const baseTitle = String(title).replace(/^[▶▼]\s*/, '');
  let collapsed = collapsible && startCollapsed;
  const rowButtons = [];

  const el = document.createElement('div');
  el.className = 'ascii-box';

  const top = document.createElement('div');
  top.className = 'ascii-box-line ascii-box-edge';

  const titleRow = document.createElement('div');
  titleRow.className = 'ascii-box-title-row';
  const titleLeft = document.createElement('span');
  titleLeft.className = 'ascii-box-edge-ch';
  titleLeft.textContent = V;
  const titleMid = document.createElement('span');
  titleMid.className = 'ascii-box-title-mid';
  const titleRight = document.createElement('span');
  titleRight.className = 'ascii-box-edge-ch';
  titleRight.textContent = V;
  titleRow.append(titleLeft, titleMid, titleRight);

  if (collapsible) {
    titleRow.classList.add('ascii-box-collapsible-head');
    titleRow.setAttribute('role', 'button');
    titleRow.tabIndex = 0;
    titleRow.setAttribute('aria-expanded', String(!collapsed));
  }

  const sep = document.createElement('div');
  sep.className = 'ascii-box-line ascii-box-edge';

  const body = document.createElement('div');
  body.className = 'ascii-box-body';

  const bot = document.createElement('div');
  bot.className = 'ascii-box-line ascii-box-edge';

  function displayTitle() {
    if (!collapsible) return baseTitle;
    return (collapsed ? '▶ ' : '▼ ') + baseTitle;
  }

  function draw() {
    const dt = displayTitle();
    const iw = innerWidth(dt, collapsed ? [] : itemList);
    const bar = H.repeat(iw);
    const mt = iw - 2;
    top.textContent = TL + bar + TR;
    sep.textContent = L + bar + R;
    bot.textContent = BL + bar + BR;
    titleMid.textContent = ' ' + dt.slice(0, mt).padEnd(mt) + ' ';
    sep.style.display = collapsed ? 'none' : '';
    body.style.display = collapsed ? 'none' : '';
    body.innerHTML = '';
    rowButtons.length = 0;
    if (!collapsed) {
      itemList.forEach((it, i) => {
        const label = itemLabel(it);
        const dis = typeof it === 'object' && it && it.disabled;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ascii-box-row' + (dis ? ' ascii-box-row-disabled' : '');
        btn.disabled = !!dis;
        const left = document.createElement('span');
        left.className = 'ascii-box-edge-ch';
        left.textContent = V;
        const mid = document.createElement('span');
        mid.className = 'ascii-box-row-mid';
        mid.textContent = ' ' + label.slice(0, mt).padEnd(mt) + ' ';
        const right = document.createElement('span');
        right.className = 'ascii-box-edge-ch';
        right.textContent = V;
        btn.append(left, mid, right);
        btn.addEventListener('click', () => {
          if (dis) return;
          onItemClick && onItemClick(label, i);
        });
        body.appendChild(btn);
        if (!dis) rowButtons.push(btn);
      });
    }
    el.style.setProperty('--ascii-inner-w', String(iw));
    if (collapsible) {
      titleRow.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  if (collapsible) {
    titleRow.addEventListener('click', (e) => {
      e.preventDefault();
      collapsed = !collapsed;
      draw();
    });
    titleRow.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        collapsed = !collapsed;
        draw();
      }
    });
  }

  el.append(top, titleRow, sep, body, bot);
  draw();

  el.getFocusableRows = () => [...rowButtons];
  el.redraw = draw;
  return el;
}
