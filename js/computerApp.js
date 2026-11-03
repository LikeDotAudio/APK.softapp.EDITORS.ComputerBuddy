// Part of the APK.audio project — Anthony Kuzub
// MIT Licence.

export class ComputerNodeModel {
  constructor(hostname = 'SRV-AUD-01', os = 'Debian 12 Bookworm') {
    this.hostname = hostname;
    this.os = os;
    this.interfaces = [
      { name: 'eth0', ip: '10.10.20.15', mac: '00:1A:2B:3C:4D:5E', speed: '1 Gbps', role: 'Management' },
      { name: 'eth1', ip: '172.16.50.15', mac: '00:1A:2B:3C:4D:5F', speed: '10 Gbps', role: 'Dante Primary' }
    ];
    this.services = ['systemd-timesyncd (PTP)', 'dante-daemon', 'nmos-node', 'mqtt-client'];
  }

  addInterface(iface) {
    this.interfaces.push(iface);
  }

  removeInterface(name) {
    this.interfaces = this.interfaces.filter(i => i.name !== name);
  }
}
