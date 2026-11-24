// The part of the optional PDF engine API used here. Types are local so a core
// install can be checked without installing or distributing the PDF engine.
export type Matrix = [number, number, number, number, number, number];
export type Rect = [number, number, number, number];

type Point = [number, number];
export type Rotate = 0 | 90 | 180 | 270;

interface Font {
  getName(): string;
}

export interface Text {
  walk(callbacks: { showGlyph(font: Font, transform: Matrix): void }): void;
}

interface Device {
  close(): void;
}

type DeviceCallbacks = {
  beginLayer(): void;
  endLayer(): void;
  fillText(text: Text, transform: Matrix, space: unknown, color: number[], alpha: number): void;
  strokeText(text: Text, stroke: unknown, transform: Matrix, space: unknown, color: number[], alpha: number): void;
  clipText(): void;
  clipStrokeText(): void;
  ignoreText(): void;
  fillImage(): void;
  fillImageMask(): void;
};

interface StructuredText {
  walk(callbacks: {
    beginLine(bounds: Rect): void;
    onChar(char: string, origin: Point, font: Font, size: number): void;
  }): void;
  asText(): string;
}

export interface Page {
  getBounds(box?: 'MediaBox' | 'CropBox'): Rect;
  run(device: Device, transform: Matrix): void;
  toStructuredText(options: string): StructuredText;
}

export interface PDFObject {
  getInheritable(key: string): PDFObject;
  get(key: string | number): PDFObject;
  isArray(): boolean;
  isNull(): boolean;
  length: number;
  asNumber(): number;
  put(key: string, value: PDFObject): void;
  push(value: PDFObject): void;
}

export interface PDFPage extends Page {
  getObject(): PDFObject;
  getAnnotations(): readonly unknown[];
  getWidgets(): readonly unknown[];
  setPageBox(box: 'CropBox', bounds: Rect): void;
  createAnnotation(type: 'Text'): {
    setRect(rect: Rect): void;
    setContents(text: string): void;
    update(): void;
  };
}

interface Document {
  isPDF(): boolean;
  asPDF(): PDFDocument | null;
  countPages(): number;
  loadPage(index: number): Page;
}

interface PdfBuffer {
  asUint8Array(): Uint8Array;
}

export interface PDFDocument extends Document {
  loadPage(index: number): PDFPage;
  needsPassword(): boolean;
  graftPage(index: number, source: PDFDocument, page: number): void;
  saveToBuffer(options: string): PdfBuffer;
  addSimpleFont(font: Font, encoding: 'Latin'): PDFObject;
  addImage(image: object): PDFObject;
  addObject(value: Record<string, unknown>): PDFObject;
  getTrailer(): PDFObject;
  addPage(bounds: Rect, rotation: Rotate, resources: Record<string, unknown>, content: string): PDFObject;
  insertPage(index: number, page: PDFObject): void;
}

export interface MupdfModule {
  setLog(log: Record<string, never>): void;
  Matrix: { identity: Matrix; concat(a: Matrix, b: Matrix): Matrix };
  Document: { openDocument(bytes: Uint8Array, type: 'application/pdf'): Document };
  Device: new (callbacks: DeviceCallbacks) => Device;
  PDFDocument: new (bytes?: Uint8Array) => PDFDocument;
  Buffer: new () => PdfBuffer;
  DocumentWriter: new (buffer: PdfBuffer, format: 'pdf', options: string) => {
    beginPage(bounds: Rect): Device;
    endPage(): void;
    close(): void;
  };
  Font: new (name: string) => Font;
  ColorSpace: { DeviceRGB: object };
  Pixmap: new (colorSpace: object, bounds: Rect, alpha: boolean) => { clear(value: number): void };
  Image: new (pixmap: object) => object;
}
