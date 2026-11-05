// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { ComputerNodeModel } from './computerModel.js';
import { NetworkPanel } from './networkPanel.js';

/* APKSoftapp.esc when the client is loaded; the same five-character escape in node tests. */
const esc = (s) => (typeof window !== 'undefined' && window.APKSoftapp ? window.APKSoftapp.esc(s)
  : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const SPEEDS = ['1 Gbps', '2.5 Gbps', '10 Gbps', '25 Gbps', '100 Gbps'];

export { ComputerNodeModel };

export class ComputerApp {
  constructor() {
    this.model = new ComputerNodeModel();
    window.APKSoftapp.describe({
      name: 'Computer Buddy',
      does: 'One computer as a compute node block: chassis, hardware, network interfaces and services; or a real one picked live from the network.',
      inputs: [
        { name: 'Compute node block', from: 'the CAD (when opened from a drawing), or a .json file via Open Block', kind: 'file' },
        { name: 'Computers on the network', from: 'the bus: bare-metal agents, protocol scanners and Discovery presence', kind: 'bus' },
        { name: 'Computer rules', from: 'config/computer-rules.json (which machines count as computers)', kind: 'file' },
      ],
      outputs: [
        { name: 'Compute node block', to: 'the CAD on Save & Return and on every edit; standalone Save downloads <hostname>.json', kind: 'file' },
      ],
      controls: [
        { name: 'Network panel', how: 'filter and search the live list; click one to load it (it follows the bus until you edit)' },
        { name: 'Hostname, form factor, OS, CPU, RAM, GPU, storage, power (W)', how: 'edit; the chassis drawing follows' },
        { name: '+ Add Interface', how: 'add a network interface row; edit or delete it in the table' },
        { name: '+ Add Service (or Enter)', how: 'add a running service by name; x on its badge removes it' },
        { name: 'Open Block / Network / Save & Return / Close', how: 'header buttons' },
      ],
      problems: ['bad_json', 'bad_input', 'file_unreadable', 'not_in_cad', 'bus_missing', 'config_invalid', 'device_stale'],
    });
    /* The CAD bridge: cad.like.audio/host@1 through the vendored APKSoftapp
       client (vendor/apk-softapp). Same origin only; standalone, Save downloads. */
    this.host = window.APKSoftapp.connectHost({
      editor: 'Computer Buddy',
      blockType: 'computer_node',
      onLoad: (b, m) => this.handleBlockLoaded(b, m),
      onRequest: () => ({ block: this.model.toBlock(), meta: { name: this.model.hostname } }),
    });

    this.servicesContainer = document.getElementById('services-list');
    this.svgContainer = document.getElementById('chassis-svg');
    this.initControls();
    this.render();

    /* The real computers on the network (bus via APKBus, topics via APKContracts).
       Picking one loads it; while it is untouched it follows the bus live. An
       edit stops the following, so live data never overwrites a hand change. */
    this.following = false;
    const root = document.getElementById('net-panel');
    if (root) {
      this.network = new NetworkPanel({
        root,
        onPick: (m, block) => { this.following = true; this.loadMachine(block); },
        onUpdate: (m, block) => { if (this.following && !this.isTyping()) this.loadMachine(block); },
      });
      this.network.start();
    }
  }

  /** Focus in an editor field: a live refresh now would eat the keystrokes. */
  isTyping() {
    const el = document.activeElement;
    return !!el && (el.isContentEditable || ((el.tagName === 'INPUT' || el.tagName === 'SELECT') && !el.closest('#net-panel')));
  }

  loadMachine(block) {
    this.model.replaceWith(block);
    const tag = document.getElementById('block-tag');
    if (tag) tag.textContent = this.following ? 'LIVE FROM THE NETWORK' : 'COMPUTE NODE BLOCK';
    this.render();
  }

  edited() {
    if (this.following) {
      this.following = false;
      const tag = document.getElementById('block-tag');
      if (tag) tag.textContent = 'EDITED (no longer following the bus)';
    }
    this.host.changed(this.model.toBlock());
  }

  handleBlockLoaded(block, meta) {
    if (block) {
      this.following = false;
      this.model.fromBlock(block);
      this.render();
    }
  }

  initControls() {
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.host.save(this.model.toBlock(), { name: this.model.hostname, filename: this.model.hostname || 'computer_node' });
      });
    }

    const btnOpen = document.getElementById('btn-open');
    if (btnOpen) {
      const open = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onerror = () => window.APKSoftapp.showProblem('file_unreadable', {
            subject: file.name, detail: reader.error && reader.error.message, onRetry: open,
          });
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              this.following = false;
              this.model.fromBlock(data);
              this.render();
            } catch (err) {
              window.APKSoftapp.showProblem(err instanceof SyntaxError ? 'bad_json' : 'bad_input', {
                subject: file.name,
                detail: err.message,
                fix: ['Open a compute node block .json (Save & Return outside the CAD downloads <hostname>.json).'],
                onRetry: open,
              });
            }
          };
          reader.readAsText(file);
        };
        input.click();
      };
      btnOpen.addEventListener('click', open);
    }

    const btnClose = document.getElementById('btn-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.host.close());
    }

    const btnDiscovered = document.getElementById('btn-discovered');
    if (btnDiscovered) {
      btnDiscovered.addEventListener('click', () => {
        document.body.classList.toggle('net-hidden');
      });
    }

    const btnAddIface = document.getElementById('btn-add-iface');
    if (btnAddIface) {
      btnAddIface.addEventListener('click', () => {
        this.model.addInterface();
        this.render();
        this.edited();
      });
    }

    const btnAddService = document.getElementById('btn-add-service');
    const inputNewService = document.getElementById('new-service-input');
    if (btnAddService && inputNewService) {
      const doAdd = () => {
        const val = inputNewService.value.trim();
        if (val) {
          this.model.addService(val);
          inputNewService.value = '';
          this.renderServices();
          this.edited();
        }
      };
      btnAddService.addEventListener('click', doAdd);
      inputNewService.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doAdd();
      });
    }

    // Property inputs
    ['hostname', 'formFactor', 'os', 'cpu', 'ram', 'gpu', 'storage', 'powerWatts'].forEach(field => {
      const el = document.getElementById(`prop-${field}`);
      if (el) {
        el.addEventListener('input', (e) => {
          this.model[field] = e.target.value;
          this.renderChassis();
          this.edited();
        });
      }
    });
  }

  render() {
    this.renderForm();
    this.renderChassis();
    this.renderInterfaces();
    this.renderServices();
  }

  renderForm() {
    ['hostname', 'formFactor', 'os', 'cpu', 'ram', 'gpu', 'storage', 'powerWatts'].forEach(field => {
      const el = document.getElementById(`prop-${field}`);
      if (el && this.model[field] !== undefined) {
        if (el.tagName === 'SELECT' && this.model[field] && ![...el.options].some((o) => o.value === this.model[field])) {
          el.add(new Option(this.model[field], this.model[field]));
        }
        el.value = this.model[field];
      }
    });

    const titleEl = document.getElementById('display-node-title');
    if (titleEl) {
      titleEl.textContent = `${this.model.hostname} (${[this.model.formFactor, this.model.os].filter(Boolean).join(' • ')})`;
    }
  }

  /* The front, drawn in mm (viewBox units are mm). EIA-310: a 482.6 mm (19")
     panel, a 440 mm body between two ears, 44.45 mm per U, fixing slots at
     ±15.875 mm from the U's centre, 7.95 mm in from the panel edge — the same
     numbers EDITORS.Device draws with. The slots are WIDE (9.5 x 7 mm,
     horizontal), never tall and skinny. Ports, LEDs and badge are symbols, not
     a product's dimensions. */
  renderChassis() {
    if (!this.svgContainer) return;

    const PANEL_W = 482.6, BODY_W = 440, U = 44.45, HOLE_OFFSET = 15.875;
    const SLOT_W = 9.5, SLOT_H = 7, SLOT_FROM_EDGE = 7.95;
    const EAR_W = (PANEL_W - BODY_W) / 2;
    const M = 4;
    const ru = Math.min(8, Math.max(1, parseInt(/(\d+)\s*U/i.exec(this.model.formFactor || '')?.[1] || '1', 10) || 1));
    const H = ru * U;
    const bx = M + EAR_W;
    const midY = M + U / 2;                     // symbols sit on the first U
    const parts = [];

    for (const x0 of [M, M + PANEL_W - EAR_W]) {
      parts.push(`<rect x="${x0}" y="${M}" width="${EAR_W}" height="${H}" fill="#0f0f11" stroke="#2B3C5D" stroke-width="0.5"/>`);
      const cx = x0 === M ? M + SLOT_FROM_EDGE : M + PANEL_W - SLOT_FROM_EDGE;
      for (let u = 0; u < ru; u++) {
        const uc = M + u * U + U / 2;
        for (const cy of [uc - HOLE_OFFSET, uc + HOLE_OFFSET]) {
          parts.push(`<rect x="${cx - SLOT_W / 2}" y="${cy - SLOT_H / 2}" width="${SLOT_W}" height="${SLOT_H}" rx="${SLOT_H / 2}" fill="#121212" stroke="#2B3C5D" stroke-width="0.4"/>`);
        }
      }
    }
    parts.push(`<rect x="${bx}" y="${M}" width="${BODY_W}" height="${H}" rx="1" fill="url(#chassisGrad)" stroke="#2B3C5D" stroke-width="0.6"/>`);

    // power, LEDs, hostname badge, vent: symbols
    parts.push(`<circle cx="${bx + 12}" cy="${midY}" r="5" fill="#121212" stroke="#4ADE80" stroke-width="0.6"/>`);
    parts.push(`<text x="${bx + 12}" y="${midY + 2}" fill="#4ADE80" font-size="5" font-weight="bold" font-family="sans-serif" text-anchor="middle">⏻</text>`);
    parts.push(`<circle cx="${bx + 24}" cy="${midY - 5}" r="1.5" fill="#4ADE80"/><text x="${bx + 27}" y="${midY - 3.8}" fill="#888888" font-size="3.5" font-family="sans-serif">PWR</text>`);
    parts.push(`<circle cx="${bx + 24}" cy="${midY + 5}" r="1.5" fill="#4A9EFF"/><text x="${bx + 27}" y="${midY + 6.2}" fill="#888888" font-size="3.5" font-family="sans-serif">ACT</text>`);
    parts.push(`<rect x="${bx + 40}" y="${midY - 10}" width="95" height="20" rx="1.5" fill="#121212" stroke="#2B3C5D" stroke-width="0.4"/>`);
    parts.push(`<text x="${bx + 44}" y="${midY - 1}" fill="#F4902C" font-size="6" font-weight="bold" font-family="JetBrains Mono, monospace">${esc(this.model.hostname)}</text>`);
    parts.push(`<text x="${bx + 44}" y="${midY + 6}" fill="#888888" font-size="4" font-family="sans-serif">${esc(this.model.formFactor)}${this.model.powerWatts ? ` • ${esc(this.model.powerWatts)}W` : ''}</text>`);
    for (let i = 0; i < 6; i++) parts.push(`<line x1="${bx + 142 + i * 4}" y1="${midY - 10}" x2="${bx + 142 + i * 4}" y2="${midY + 10}" stroke="#2c2c2c" stroke-width="1"/>`);

    // one port symbol per interface, while they fit on the body
    const PORT_PITCH = 18, PORT_W = 13, PORT_H = 11;
    this.model.interfaces.forEach((iface, idx) => {
      const x = bx + 175 + idx * PORT_PITCH;
      if (x + PORT_W > bx + BODY_W - 4) return;
      const fast = /^(10|25|40|100) Gbps/.test(iface.speed || '');
      const color = fast ? '#F4902C' : '#4A9EFF';
      parts.push(`<rect x="${x}" y="${midY - 4}" width="${PORT_W}" height="${PORT_H}" rx="1" fill="#121212" stroke="${color}" stroke-width="0.6"/>`);
      parts.push(`<circle cx="${x + 2.5}" cy="${midY - 7}" r="1.2" fill="#4ADE80"/><circle cx="${x + PORT_W - 2.5}" cy="${midY - 7}" r="1.2" fill="#F4902C"/>`);
      parts.push(`<text x="${x + PORT_W / 2}" y="${midY + 3}" fill="#f4f4f5" font-size="3.5" font-family="JetBrains Mono, monospace" text-anchor="middle">${esc(iface.name)}</text>`);
    });

    const W = PANEL_W + 2 * M, HH = H + 2 * M;
    this.svgContainer.innerHTML = `
      <svg viewBox="0 0 ${W} ${HH}" width="100%" xmlns="http://www.w3.org/2000/svg" data-units="mm">
        <defs>
          <linearGradient id="chassisGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2c2c2c"/>
            <stop offset="100%" stop-color="#18181b"/>
          </linearGradient>
        </defs>
        ${parts.join('\n        ')}
      </svg>
    `;
  }

  /* The interfaces are an APKTable (vendor/apk-table): one table module for the
     whole project, reachable by script as APKTable.get('computer-interfaces'). */
  renderInterfaces() {
    const host = document.getElementById('iface-table');
    if (!host || !window.APKTable) return;
    if (!this.ifaceTable) {
      this.ifaceTable = window.APKTable.create(host, {
        id: 'computer-interfaces',
        searchPlaceholder: 'Filter interfaces',
        empty: 'No interfaces. Add one, or pick a machine on the network.',
        columns: [
          { key: 'name', label: 'IFace', mono: true },
          { key: 'ip', label: 'IP Address', mono: true },
          { key: 'subnet', label: 'Subnet Mask', mono: true },
          { key: 'mac', label: 'MAC Address', mono: true },
          { key: 'speed', label: 'Speed', type: 'select', options: ['', ...SPEEDS] },
          { key: 'role', label: 'Role' },
          { key: 'vlan', label: 'VLAN', type: 'number' },
        ],
        rows: this.model.interfaces,
        onEdit: () => { this.renderChassis(); this.edited(); },
        onDelete: (i) => {
          this.model.removeInterface(i);
          this.render();
          this.edited();
        },
      });
    } else {
      this.ifaceTable.setRows(this.model.interfaces);
    }
  }

  renderServices() {
    if (!this.servicesContainer) return;
    this.servicesContainer.innerHTML = '';

    this.model.services.forEach((service, idx) => {
      const badge = document.createElement('span');
      badge.className = 'service-badge';
      badge.innerHTML = `
        <span>${esc(service)}</span>
        <button class="badge-remove" data-idx="${idx}">×</button>
      `;
      this.servicesContainer.appendChild(badge);
    });

    this.servicesContainer.querySelectorAll('.badge-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.model.removeService(idx);
        this.renderServices();
        this.edited();
      });
    });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new ComputerApp();
  });
}
