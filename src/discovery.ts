import Bonjour from 'bonjour-service';
import type { Logger } from 'homebridge';

export interface DiscoveredDevice {
  host: string;
  port: number;
  name: string;
}

export type DiscoveryCallback = (device: DiscoveredDevice) => void;

type BonjourInstance = InstanceType<typeof Bonjour>;
type BonjourBrowser = ReturnType<BonjourInstance['find']>;
type BonjourService = Parameters<NonNullable<Parameters<BonjourInstance['find']>[1]>>[0];

export class ESPHomeDiscovery {
  private readonly bonjour: BonjourInstance;
  private browser: BonjourBrowser | null = null;

  constructor(private readonly log: Logger) {
    this.bonjour = new Bonjour();
  }

  start(onDevice: DiscoveryCallback): void {
    this.browser = this.bonjour.find(
      { type: 'esphomelib', protocol: 'tcp' },
      (service: BonjourService) => {
        const host = service.host || service.addresses?.[0] || '';
        const port = service.port || 6053;

        if (!host) {
          this.log.warn(`mDNS discovered ESPHome device "${service.name}" without a usable host; skipping.`);
          return;
        }

        this.log.info(`mDNS: discovered ESPHome device "${service.name}" at ${host}:${port}`);
        onDevice({ host, port, name: service.name });
      },
    );
    this.browser.start();
    this.log.debug('mDNS discovery started (_esphomelib._tcp)');
  }

  stop(): void {
    this.browser?.stop();
    this.bonjour.destroy();
    this.log.debug('mDNS discovery stopped');
  }
}
