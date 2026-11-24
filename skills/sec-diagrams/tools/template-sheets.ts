/** Example system for collecting, storing and checking telemetry. Geometry is in page pixels. */
import { BLUE, DENY, GREEN, PURPLE, type EdgeSpec, type NodeSpec, type SheetSpec } from './template-cells.ts';

const devices = { id: 'zone-devices', label: 'Датчики', x: 40, y: 90, w: 395, h: 600 };
const ingest = { id: 'zone-ingest', label: 'Прием телеметрии', x: 575, y: 90, w: 465, h: 600 };
const storage = { id: 'zone-storage', label: 'Хранение измерений', x: 1170, y: 90, w: 444, h: 600 };
const ingressFirewall = { id: 'fw-ingress', label: 'МЭ-1', x: 475, y: 90, w: 60, h: 600 };
const storageFirewall = { id: 'fw-storage', label: 'МЭ-2', x: 1075, y: 90, w: 60, h: 600 };

const sensor: NodeSpec = { id: 'sensor', label: 'Датчик', zone: devices.id, x: 25, y: 95, isNew: false };
const bridge: NodeSpec = { id: 'bridge', label: 'Шлюз датчиков', zone: devices.id, x: 12, y: 280, icon: 'server', isNew: false };
const collector: NodeSpec = { id: 'collector', label: 'Сборщик', zone: ingest.id, x: 58, y: 95, icon: 'server', isNew: true };
const broker: NodeSpec = { id: 'broker', label: 'Брокер сообщений', zone: ingest.id, x: 58, y: 280, icon: 'server', isNew: true };
const clock: NodeSpec = { id: 'clock', label: 'Сервер времени', zone: ingest.id, x: 58, y: 470, icon: 'server', isNew: false };
const archive: NodeSpec = { id: 'archive', label: 'База измерений', zone: storage.id, x: 205, y: 95, icon: 'server', isNew: true };
const observer: NodeSpec = { id: 'observer', label: 'Монитор', zone: storage.id, x: 20, y: 280, icon: 'server', isNew: false };
const replica: NodeSpec = { id: 'replica', label: 'Реплика', zone: storage.id, x: 205, y: 480, icon: 'server', isNew: true };

const readings: EdgeSpec = {
  n: 1, color: BLUE, from: sensor.id, to: collector.id, protocol: 'HTTPS (443/TCP)',
  purpose: 'передача показаний', exit: [1, 0.5], entry: [0, 0.5],
};
const events: EdgeSpec = {
  n: 2, color: BLUE, from: bridge.id, to: broker.id, protocol: 'MQTT (8883/TCP) via TLS',
  purpose: 'передача событий датчиков', exit: [1, 0.5], entry: [0, 0.5],
};
const batch: EdgeSpec = {
  n: 3, color: PURPLE, from: broker.id, to: collector.id, protocol: 'HTTPS (8443/TCP)',
  purpose: 'передача пакета событий', exit: [0.65, 0], entry: [0.65, 1],
};
const time: EdgeSpec = {
  n: 4, color: PURPLE, from: broker.id, to: clock.id, protocol: 'NTP (123/UDP)',
  purpose: 'синхронизация времени брокера', exit: [0.65, 1], entry: [0.65, 0],
};
const write: EdgeSpec = {
  n: 1, color: GREEN, from: collector.id, to: archive.id, protocol: 'SQL (5432/TCP) via TLS',
  purpose: 'запись измерений', exit: [1, 0.5], entry: [0, 0.5],
};
const metrics: EdgeSpec = {
  n: 2, color: BLUE, from: observer.id, to: broker.id, protocol: 'HTTPS (443/TCP)',
  purpose: 'чтение метрик брокера', exit: [0, 0.5], entry: [1, 0.5],
};
const replication: EdgeSpec = {
  n: 3, color: PURPLE, from: archive.id, to: replica.id, protocol: 'SQL (5432/TCP) via TLS',
  purpose: 'репликация измерений', points: [[1580, 225], [1580, 610]], exit: [1, 0.5], entry: [1, 0.5],
};
const blocked: EdgeSpec = {
  color: DENY, from: bridge.id, to: ingest.id, points: [[139.5, 498]], exit: [0.5, 1], entry: [0, 0.68],
};

export const SHEET_L1: SheetSpec = {
  pageName: 'Общая схема', title: 'L1: Общая схема',
  zones: [devices, ingest, storage], firewalls: [ingressFirewall, storageFirewall],
  nodes: [sensor, collector, archive],
  edges: [readings, { ...write, n: 2 }],
};

export const SHEET_L2: SheetSpec = {
  pageName: 'Зоны и узлы', title: 'L2: Зоны и узлы',
  zones: [devices, ingest, storage], firewalls: [ingressFirewall, storageFirewall],
  nodes: [sensor, bridge, collector, broker, archive, observer],
  edges: [readings, events, { ...write, n: 3 }, { ...metrics, n: 4 }],
};

export const SHEET_L3_1: SheetSpec = {
  pageName: 'Прием телеметрии', title: 'L3, лист 1 из 2: Прием телеметрии',
  zones: [
    { ...ingest, x: 740, y: 112, w: 788, h: 578 },
    { ...devices, x: 96, y: 112, w: 488, h: 578 },
  ],
  firewalls: [{ ...ingressFirewall, x: 624, y: 112, w: 76, h: 578 }],
  nodes: [
    { ...bridge, x: 76, y: 148 },
    { ...sensor, x: 150, y: 350 },
    { ...broker, x: 355, y: 148 },
    { ...collector, x: 355, y: 350 },
    { ...clock, x: 592, y: 496 },
  ],
  edges: [
    { ...readings, exit: [1, 0.45], entry: [0, 0.45] },
    { ...events, exit: [1, 0.65], entry: [0, 0.65] },
    { ...batch, exit: [0.58, 1], entry: [0.58, 0] },
    { ...time, exit: [1, 0.5], entry: [0, 0.5],
      points: [[1303, 300], [1303, 648]] },
    { ...blocked, points: [[208.75, 578]], exit: [0.21, 1], entry: [0, 466 / 578] },
  ],
};

export const SHEET_L3_2: SheetSpec = {
  pageName: 'Хранение измерений', title: 'L3, лист 2 из 2: Хранение измерений',
  zones: [ingest, storage], firewalls: [storageFirewall],
  nodes: [collector, broker, archive, observer, replica], edges: [write, metrics, replication],
};

export const SHEETS = [SHEET_L1, SHEET_L2, SHEET_L3_1, SHEET_L3_2];
