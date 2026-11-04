// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { ComputerNodeModel } from './computerModel.js';
import { BlockBridge } from './blockBridge.js';
import { NetworkPanel } from './networkPanel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SPEEDS = ['1 Gbps', '2.5 Gbps', '10 Gbps', '25 Gbps', '100 Gbps'];

export { ComputerNodeModel };

export class ComputerApp {
  constructor() {
    this.model = new ComputerNodeModel();
    this.bridge = new BlockBridge({
      name: 'Computer Buddy',
      type: 'computer_node',
      onBlockLoaded: (b, m) => this.handleBlockLoaded(b, m),
      onBlockChanged: () => this.render()
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
    this.bridge.notifyChanged();
  }

  handleBlockLoaded(block, meta) {
    if (block) {
      this.model.fromBlock(block);
      this.render();
    }
  }

  initControls() {
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.bridge.saveBlock(this.model.toBlock(), { name: this.model.hostname });
      });
    }

    const btnOpen = document.getElementById('btn-open');
    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              this.following = false;
              this.model.fromBlock(data);
              this.render();
            } catch (err) {
              alert('Invalid block file: ' + err.message);
            }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }

    const btnClose = document.getElementById('btn-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.bridge.close());
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

  renderChassis() {
    if (!this.svgContainer) return;

    const width = 640;
    const height = 90;
    const ifaceCount = this.model.interfaces.length;

    let portsSvg = '';
    this.model.interfaces.forEach((iface, idx) => {
      const x = 320 + idx * 42;
      if (x + 36 > width - 50) return;
      const is10G = /^(10|25|40|100) Gbps/.test(iface.speed || '');
      const portColor = is10G ? '#F4902C' : '#4A9EFF';

      portsSvg += `
        <rect x="${x}" y="32" width="28" height="24" rx="2" fill="#121212" stroke="${portColor}" stroke-width="1.5"/>
        <circle cx="${x + 6}" cy="24" r="2.5" fill="#4ADE80"/>
        <circle cx="${x + 22}" cy="24" r="2.5" fill="#F4902C"/>
        <text x="${x + 14}" y="48" fill="#f4f4f5" font-size="8" font-family="JetBrains Mono, monospace" text-anchor="middle">${esc(iface.name)}</text>
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="chassisGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2c2c2c"/>
            <stop offset="100%" stop-color="#18181b"/>
          </linearGradient>
        </defs>

        <!-- Main 19-inch 1U Faceplate -->
        <rect x="25" y="10" width="${width - 50}" height="70" rx="3" fill="url(#chassisGrad)" stroke="#2B3C5D" stroke-width="1.5"/>

        <!-- Left Rack Ear with wide (horizontal) mounting slots -->
        <rect x="10" y="10" width="15" height="70" rx="2" fill="#0f0f11" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="17.5" cy="24" rx="5" ry="3" fill="#121212" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="17.5" cy="66" rx="5" ry="3" fill="#121212" stroke="#2B3C5D" stroke-width="1"/>

        <!-- Right Rack Ear with wide (horizontal) mounting slots -->
        <rect x="${width - 25}" y="10" width="15" height="70" rx="2" fill="#0f0f11" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="${width - 17.5}" cy="24" rx="5" ry="3" fill="#121212" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="${width - 17.5}" cy="66" rx="5" ry="3" fill="#121212" stroke="#2B3C5D" stroke-width="1"/>

        <!-- Power Button & Health LEDs -->
        <circle cx="50" cy="45" r="8" fill="#121212" stroke="#4ADE80" stroke-width="1.5"/>
        <text x="50" y="48" fill="#4ADE80" font-size="9" font-weight="bold" font-family="sans-serif" text-anchor="middle">⏻</text>

        <circle cx="72" cy="38" r="3" fill="#4ADE80"/>
        <text x="80" y="41" fill="#888888" font-size="8" font-family="sans-serif">PWR</text>
        <circle cx="72" cy="52" r="3" fill="#4A9EFF"/>
        <text x="80" y="55" fill="#888888" font-size="8" font-family="sans-serif">ACT</text>

        <!-- Hostname Badge -->
        <rect x="110" y="28" width="140" height="34" rx="4" fill="#121212" stroke="#2B3C5D" stroke-width="1"/>
        <text x="120" y="44" fill="#F4902C" font-size="12" font-weight="bold" font-family="JetBrains Mono, monospace">${esc(this.model.hostname)}</text>
        <text x="120" y="56" fill="#888888" font-size="9" font-family="sans-serif">${esc(this.model.formFactor)}${this.model.powerWatts ? ` • ${esc(this.model.powerWatts)}W` : ''}</text>

        <!-- Airflow Vent Grille -->
        <g stroke="#2c2c2c" stroke-width="2">
          <line x1="265" y1="26" x2="265" y2="64"/>
          <line x1="272" y1="26" x2="272" y2="64"/>
          <line x1="279" y1="26" x2="279" y2="64"/>
          <line x1="286" y1="26" x2="286" y2="64"/>
          <line x1="293" y1="26" x2="293" y2="64"/>
          <line x1="300" y1="26" x2="300" y2="64"/>
        </g>

        <!-- Port matrix -->
        ${portsSvg}
      </svg>
    `;
    this.svgContainer.innerHTML = svg;
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
