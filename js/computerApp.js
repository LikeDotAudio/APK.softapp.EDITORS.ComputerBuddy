// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { ComputerNodeModel } from './computerModel.js';
import { BlockBridge } from './blockBridge.js';

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

    this.tableBody = document.getElementById('iface-table-body');
    this.servicesContainer = document.getElementById('services-list');
    this.svgContainer = document.getElementById('chassis-svg');
    this.initControls();
    this.render();
    this.autoConnect();
  }

  async autoConnect() {
    const discovered = await this.bridge.fetchDiscoveredProject();
    if (discovered && discovered.servers && discovered.servers.length > 0) {
      this.model.fromBlock(discovered.servers[0]);
      this.render();
    }
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
      btnDiscovered.addEventListener('click', async () => {
        const disc = await this.bridge.fetchDiscoveredProject();
        if (disc && disc.servers && disc.servers.length > 0) {
          this.model.fromBlock(disc.servers[0]);
          this.render();
        } else {
          alert('No compute node blocks found in current discovered project.');
        }
      });
    }

    const btnAddIface = document.getElementById('btn-add-iface');
    if (btnAddIface) {
      btnAddIface.addEventListener('click', () => {
        this.model.addInterface();
        this.render();
        this.bridge.notifyChanged();
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
          this.bridge.notifyChanged();
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
          this.bridge.notifyChanged();
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
        el.value = this.model[field];
      }
    });

    const titleEl = document.getElementById('display-node-title');
    if (titleEl) {
      titleEl.textContent = `${this.model.hostname} (${this.model.formFactor} • ${this.model.os})`;
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
      const is10G = iface.speed.includes('10');
      const portColor = is10G ? '#F4902C' : '#4A9EFF';

      portsSvg += `
        <rect x="${x}" y="32" width="28" height="24" rx="2" fill="#080C16" stroke="${portColor}" stroke-width="1.5"/>
        <circle cx="${x + 6}" cy="24" r="2.5" fill="#4ADE80"/>
        <circle cx="${x + 22}" cy="24" r="2.5" fill="#F4902C"/>
        <text x="${x + 14}" y="48" fill="#F0F4F8" font-size="8" font-family="JetBrains Mono, monospace" text-anchor="middle">${iface.name}</text>
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="chassisGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1E2A45"/>
            <stop offset="100%" stop-color="#121A2F"/>
          </linearGradient>
        </defs>

        <!-- Main 19-inch 1U Faceplate -->
        <rect x="25" y="10" width="${width - 50}" height="70" rx="3" fill="url(#chassisGrad)" stroke="#2B3C5D" stroke-width="1.5"/>

        <!-- Left Rack Ear with oval mounting slots -->
        <rect x="10" y="10" width="15" height="70" rx="2" fill="#0E1424" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="17.5" cy="24" rx="3" ry="5" fill="#080C16" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="17.5" cy="66" rx="3" ry="5" fill="#080C16" stroke="#2B3C5D" stroke-width="1"/>

        <!-- Right Rack Ear with oval mounting slots -->
        <rect x="${width - 25}" y="10" width="15" height="70" rx="2" fill="#0E1424" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="${width - 17.5}" cy="24" rx="3" ry="5" fill="#080C16" stroke="#2B3C5D" stroke-width="1"/>
        <ellipse cx="${width - 17.5}" cy="66" rx="3" ry="5" fill="#080C16" stroke="#2B3C5D" stroke-width="1"/>

        <!-- Power Button & Health LEDs -->
        <circle cx="50" cy="45" r="8" fill="#080C16" stroke="#4ADE80" stroke-width="1.5"/>
        <text x="50" y="48" fill="#4ADE80" font-size="9" font-weight="bold" font-family="sans-serif" text-anchor="middle">⏻</text>

        <circle cx="72" cy="38" r="3" fill="#4ADE80"/>
        <text x="80" y="41" fill="#8B9BB4" font-size="8" font-family="sans-serif">PWR</text>
        <circle cx="72" cy="52" r="3" fill="#4A9EFF"/>
        <text x="80" y="55" fill="#8B9BB4" font-size="8" font-family="sans-serif">ACT</text>

        <!-- Hostname Badge -->
        <rect x="110" y="28" width="140" height="34" rx="4" fill="#080C16" stroke="#2B3C5D" stroke-width="1"/>
        <text x="120" y="44" fill="#F4902C" font-size="12" font-weight="bold" font-family="JetBrains Mono, monospace">${this.model.hostname}</text>
        <text x="120" y="56" fill="#8B9BB4" font-size="9" font-family="sans-serif">${this.model.formFactor} • ${this.model.powerWatts}W</text>

        <!-- Airflow Vent Grille -->
        <g stroke="#1E2A45" stroke-width="2">
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

  renderInterfaces() {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = '';

    this.model.interfaces.forEach((iface, idx) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="name">${iface.name || ''}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="ip">${iface.ip || ''}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="subnet">${iface.subnet || '255.255.255.0'}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="mac">${iface.mac || ''}</td>
        <td>
          <select class="control-select" data-idx="${idx}" data-field="speed">
            <option value="1 Gbps" ${iface.speed === '1 Gbps' ? 'selected' : ''}>1 Gbps</option>
            <option value="2.5 Gbps" ${iface.speed === '2.5 Gbps' ? 'selected' : ''}>2.5 Gbps</option>
            <option value="10 Gbps" ${iface.speed === '10 Gbps' ? 'selected' : ''}>10 Gbps</option>
            <option value="25 Gbps" ${iface.speed === '25 Gbps' ? 'selected' : ''}>25 Gbps</option>
            <option value="100 Gbps" ${iface.speed === '100 Gbps' ? 'selected' : ''}>100 Gbps</option>
          </select>
        </td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="role">${iface.role || 'General'}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="vlan">${iface.vlan || '1'}</td>
        <td style="text-align: center;">
          <button class="btn-delete" data-idx="${idx}" title="Remove Interface">✕</button>
        </td>
      `;

      this.tableBody.appendChild(tr);
    });

    this.tableBody.querySelectorAll('[contenteditable=true]').forEach(cell => {
      cell.addEventListener('blur', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = e.target.dataset.field;
        this.model.updateInterface(idx, field, e.target.innerText.trim());
        this.renderChassis();
        this.bridge.notifyChanged();
      });
    });

    this.tableBody.querySelectorAll('select.control-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = e.target.dataset.field;
        this.model.updateInterface(idx, field, e.target.value);
        this.renderChassis();
        this.bridge.notifyChanged();
      });
    });

    this.tableBody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.model.removeInterface(idx);
        this.render();
        this.bridge.notifyChanged();
      });
    });
  }

  renderServices() {
    if (!this.servicesContainer) return;
    this.servicesContainer.innerHTML = '';

    this.model.services.forEach((service, idx) => {
      const badge = document.createElement('span');
      badge.className = 'service-badge';
      badge.innerHTML = `
        <span>${service}</span>
        <button class="badge-remove" data-idx="${idx}">×</button>
      `;
      this.servicesContainer.appendChild(badge);
    });

    this.servicesContainer.querySelectorAll('.badge-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.model.removeService(idx);
        this.renderServices();
        this.bridge.notifyChanged();
      });
    });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new ComputerApp();
  });
}
