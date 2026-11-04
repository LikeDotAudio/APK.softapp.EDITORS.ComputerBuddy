// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

export class ComputerNodeModel {
  constructor(hostname = 'SRV-AUD-01', os = 'Debian 12 Bookworm') {
    this.hostname = hostname;
    this.formFactor = '1U Rackmount';
    this.os = os;
    this.cpu = 'AMD EPYC 7302P 16-Core';
    this.ram = '64 GB ECC DDR4';
    this.gpu = 'None (Headless)';
    this.storage = '2x 1TB NVMe RAID-1';
    this.powerWatts = 250;
    this.interfaces = [
      { name: 'eth0', ip: '10.10.20.15', subnet: '255.255.255.0', mac: '00:1A:2B:3C:4D:5E', speed: '1 Gbps', role: 'Management', vlan: '10' },
      { name: 'eth1', ip: '172.16.50.15', subnet: '255.255.255.0', mac: '00:1A:2B:3C:4D:5F', speed: '10 Gbps', role: 'Dante Primary', vlan: '50' }
    ];
    this.services = ['systemd-timesyncd (PTP)', 'dante-daemon', 'nmos-node', 'mqtt-client'];
  }

  addInterface(iface = {}) {
    const defaultIdx = this.interfaces.length;
    const newIface = {
      name: iface.name || `eth${defaultIdx}`,
      ip: iface.ip || `192.168.1.${100 + defaultIdx}`,
      subnet: iface.subnet || '255.255.255.0',
      mac: iface.mac || `00:1A:2B:3C:4D:${(10 + defaultIdx).toString(16).toUpperCase()}`,
      speed: iface.speed || '1 Gbps',
      role: iface.role || 'General',
      vlan: iface.vlan || '1'
    };
    this.interfaces.push(newIface);
    return newIface;
  }

  removeInterface(nameOrIndex) {
    if (typeof nameOrIndex === 'number') {
      return this.interfaces.splice(nameOrIndex, 1)[0];
    }
    const idx = this.interfaces.findIndex(i => i.name === nameOrIndex);
    if (idx !== -1) {
      return this.interfaces.splice(idx, 1)[0];
    }
    return null;
  }

  updateInterface(index, field, value) {
    if (this.interfaces[index]) {
      this.interfaces[index][field] = value;
    }
  }

  addService(serviceName) {
    const name = String(serviceName).trim();
    if (name && !this.services.includes(name)) {
      this.services.push(name);
    }
  }

  removeService(index) {
    if (index >= 0 && index < this.services.length) {
      this.services.splice(index, 1);
    }
  }

  toBlock() {
    return {
      type: 'computer_node',
      id: `compute_${this.hostname.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      hostname: this.hostname,
      formFactor: this.formFactor,
      os: this.os,
      cpu: this.cpu,
      ram: this.ram,
      gpu: this.gpu,
      storage: this.storage,
      powerWatts: this.powerWatts,
      interfaces: JSON.parse(JSON.stringify(this.interfaces)),
      services: [...this.services]
    };
  }

  fromBlock(block = {}) {
    if (block.hostname) this.hostname = block.hostname;
    if (block.formFactor) this.formFactor = block.formFactor;
    if (block.os) this.os = block.os;
    if (block.cpu) this.cpu = block.cpu;
    if (block.ram) this.ram = block.ram;
    if (block.gpu) this.gpu = block.gpu;
    if (block.storage) this.storage = block.storage;
    if (block.powerWatts !== undefined) this.powerWatts = block.powerWatts;
    if (Array.isArray(block.interfaces)) {
      this.interfaces = JSON.parse(JSON.stringify(block.interfaces));
    }
    if (Array.isArray(block.services)) {
      this.services = [...block.services];
    }
  }
}
