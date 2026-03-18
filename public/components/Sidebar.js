import { createASCIIBox } from './ASCIIBox.js';

const SERVER_ITEMS = [
  'Quick Create...',
  'New',
  'Import Virtual Machine...',
  'Hyper-V Settings...',
  'Virtual Switch Manager...',
  'Virtual SAN Manager...',
  'Edit Disk...',
  'Inspect Disk...',
  'Stop Service',
  'Remove Server',
  'Refresh',
  'View',
  'Help',
  '> VM list',
  '> New VM',
  '> Credentials',
];

const VM_ITEMS = [
  'Connect...',
  'Settings...',
  'Start',
  'Checkpoint',
  'Move...',
  'Export...',
  'Rename...',
  'Delete...',
  'Help',
];

/**
 * @param {HTMLElement} container
 * @param {function(section: 'server'|'vm', label: string): void} onAction
 */
export function mountSidebar(container, onAction) {
  container.innerHTML = '';
  container.classList.add('sidebar-ascii-root');
  container.tabIndex = 0;
  container.setAttribute('aria-label', 'Hyper-V actions');

  const stub = (section, label) => {
    console.log(`[${section}]`, label);
    onAction && onAction(section, label);
  };

  const serverBox = createASCIIBox({
    title: 'MEOW',
    items: SERVER_ITEMS,
    onItemClick: (label) => stub('server', label),
    collapsible: true,
    startCollapsed: false,
  });

  const vmBox = createASCIIBox({
    title: 'pterodactyl',
    items: VM_ITEMS,
    onItemClick: (label) => stub('vm', label),
    collapsible: true,
    startCollapsed: false,
  });

  container.appendChild(serverBox);
  const gap = document.createElement('div');
  gap.className = 'sidebar-ascii-gap';
  container.appendChild(gap);
  container.appendChild(vmBox);

  let focusIdx = 0;

  function allRows() {
    const a = serverBox.getFocusableRows();
    const b = vmBox.getFocusableRows();
    return [...a, ...b];
  }

  function focusRow(i) {
    const rows = allRows();
    if (!rows.length) return;
    focusIdx = ((i % rows.length) + rows.length) % rows.length;
    rows.forEach((r, j) => {
      r.tabIndex = j === focusIdx ? 0 : -1;
    });
    rows[focusIdx].focus();
  }

  container.addEventListener('keydown', (e) => {
    const rows = allRows();
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = document.activeElement;
      const idx = rows.indexOf(cur);
      if (idx >= 0) focusRow(idx + 1);
      else focusRow(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = document.activeElement;
      const idx = rows.indexOf(cur);
      if (idx >= 0) focusRow(idx - 1);
      else focusRow(rows.length - 1);
    }
  });

  container.addEventListener('focusin', () => {
    const rows = allRows();
    if (!rows.length) return;
    const cur = document.activeElement;
    const idx = rows.indexOf(cur);
    if (idx >= 0) focusIdx = idx;
  });

  return { serverBox, vmBox, focusRow };
}
