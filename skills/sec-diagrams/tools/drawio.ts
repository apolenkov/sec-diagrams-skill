/**
 * Core read and point-edit layer for draw.io sheets.
 *
 * Parsing keeps the source ranges of every opening tag and attribute value, and writes splice
 * only the targeted attribute value, so attribute order, geometry and untouched pages stay
 * byte-identical. Compressed `<diagram>` payloads (deflate-raw + base64 + URI encoding) and
 * `object`/`UserObject` wrappers are supported; a compressed page is re-encoded only when edited.
 * Every input rejection is a `DrawioInputError` with code `SD-E01`; its message names files,
 * pages and cell ids only, never cell values.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { SaxesParser } from 'saxes';

import { blindMessage } from './e01-blind.ts';

/**
 * Every input rejection is a DrawioInputError; the blindener in e01-blind.ts keeps its message
 * to codes, cell ids, attribute names and known shapes, never an attribute value.
 */
export class DrawioInputError extends Error {
  readonly code = 'SD-E01';

  constructor(message: string, offset?: number) {
    const safe = blindMessage(message);
    super(offset === undefined ? safe : 'позиция ' + (offset + 1) + ': ' + safe);
  }
}

const MAX_BYTES = 32 * 1024 * 1024;
const WRAPPER_NAMES = new Set(['object', 'UserObject']);

interface TextSpan {
  start: number;
  end: number;
}

interface AttrSpan {
  valueStart: number;
  valueEnd: number;
}

interface XmlElement {
  name: string;
  attributes: Map<string, string>;
  valueSpans: Map<string, AttrSpan>;
  tagStart: number;
  tagEnd: number;
  selfClosing: boolean;
  innerStart: number;
  innerEnd: number;
  children: XmlElement[];
}

export interface Cell {
  id: string;
  pageIndex: number;
  pageName: string;
  /** Effective label: wrapper `label`, else wrapper `value`, else the `mxCell` value. */
  value: string;
  style: string;
  parent: string;
  source: string;
  target: string;
  edge: boolean;
  vertex: boolean;
  /** `visible="0"` hides the cell: in draw.io this is how a draft layer is kept. */
  visible: boolean;
  /** The wrapper's own attributes (Edit Data, tooltip, placeholders); empty for a plain cell. */
  attrs: Record<string, string>;
}

export interface CellTarget {
  cell: Cell;
  valueHost: XmlElement;
  valueAttr: string;
  styleHost: XmlElement;
}

export interface PageSource {
  /** Page XML: the whole file for an uncompressed page, the decoded payload otherwise. */
  text: string;
  targets: Map<string, CellTarget>;
  /** Range of the compressed payload inside the outer text; null when uncompressed. */
  inner: TextSpan | null;
}

export interface DrawioPage {
  index: number;
  name: string;
  compressed: boolean;
  /** Page size as the mxGraphModel attributes carry it; 0 when the sheet does not say. */
  width: number;
  height: number;
  cells: Cell[];
  source: PageSource;
}

export interface DrawioFile {
  text: string;
  pages: DrawioPage[];
}

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t' || char === '\n' || char === '\r';

/** Walks back from just after a start tag to its `<`, skipping `<` characters that cannot open it. */
function openTagStart(text: string, tagEnd: number, name: string): number {
  let index = text.lastIndexOf('<', tagEnd - 1);
  while (index >= 0) {
    const afterName = text[index + 1 + name.length];
    if (text.startsWith(name, index + 1) && (afterName === '>' || afterName === '/' || isSpace(afterName))) {
      return index;
    }
    index = text.lastIndexOf('<', index - 1);
  }
  throw new DrawioInputError(`cannot locate the start of tag "${name}"`);
}

function closeTagStart(text: string, tagEnd: number, name: string): number {
  const index = text.lastIndexOf('<', tagEnd - 1);
  if (index >= 0 && text.startsWith(`</${name}`, index)) return index;
  throw new DrawioInputError(`cannot locate the end tag of "${name}"`);
}

/** Finds the raw value range of every attribute by scanning the source substring of the tag. */
function scanAttributeSpans(text: string, tagStart: number, tagEnd: number): Map<string, AttrSpan> {
  const spans = new Map<string, AttrSpan>();
  let index = tagStart + 1;
  while (index < tagEnd && !isSpace(text[index]) && text[index] !== '>' && text[index] !== '/') index += 1;
  while (index < tagEnd) {
    while (isSpace(text[index])) index += 1;
    if (index >= tagEnd || text[index] === '>' || text[index] === '/') break;
    const nameStart = index;
    while (index < tagEnd && text[index] !== '=' && !isSpace(text[index])) index += 1;
    const name = text.slice(nameStart, index);
    while (isSpace(text[index])) index += 1;
    if (text[index] !== '=') break;
    index += 1;
    while (isSpace(text[index])) index += 1;
    const quote = text[index];
    if (quote !== '"' && quote !== "'") break;
    const valueStart = index + 1;
    const valueEnd = text.indexOf(quote, valueStart);
    if (valueEnd < 0 || valueEnd > tagEnd) break;
    spans.set(name, { valueStart, valueEnd });
    index = valueEnd + 1;
  }
  return spans;
}

function parseXml(text: string, context: string): XmlElement[] {
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag) => {
    const tagEnd = parser.position;
    const tagStart = openTagStart(text, tagEnd, tag.name);
    const element: XmlElement = {
      name: tag.name,
      attributes: new Map(Object.entries(tag.attributes)),
      valueSpans: scanAttributeSpans(text, tagStart, tagEnd),
      tagStart,
      tagEnd,
      selfClosing: tag.isSelfClosing,
      innerStart: tagEnd,
      innerEnd: tagEnd,
      children: [],
    };
    (stack.at(-1)?.children ?? roots).push(element);
    if (!tag.isSelfClosing) stack.push(element);
  });
  parser.on('closetag', (tag) => {
    if (tag.isSelfClosing) return;
    const element = stack.pop();
    if (element === undefined || element.name !== tag.name) {
      throw new DrawioInputError(`${context}: tag "${tag.name}" is not closed correctly`);
    }
    element.innerEnd = closeTagStart(text, parser.position, tag.name);
  });
  try {
    parser.write(text).close();
  } catch (error) {
    if (error instanceof DrawioInputError) throw error;
    throw new DrawioInputError(`${context}: ${parser.line}:${parser.column}: malformed XML.`);
  }
  if (stack.length > 0) throw new DrawioInputError(`${context}: unclosed tag "${stack.at(-1)?.name ?? ''}"`);
  return roots;
}

export function decodeDiagramPayload(payload: string, context: string): string {
  try {
    return decodeURIComponent(inflateRawSync(Buffer.from(payload.trim(), 'base64')).toString('utf8'));
  } catch {
    throw new DrawioInputError(`${context}: compressed payload is unreadable`);
  }
}

export function encodeDiagramPayload(xml: string): string {
  return deflateRawSync(Buffer.from(encodeURIComponent(xml), 'utf8')).toString('base64');
}

interface CellFields {
  id: string;
  value: string;
  style: string;
  parent: string;
  source: string;
  target: string;
  edge: string;
  vertex: string;
  visible: string;
}

const attr = (element: XmlElement, name: string): string => element.attributes.get(name) ?? '';

function toCell(fields: CellFields, attrs: Record<string, string>, pageIndex: number, pageName: string): Cell {
  return {
    ...fields,
    attrs,
    edge: fields.edge === '1',
    vertex: fields.vertex === '1',
    visible: fields.visible !== '0',
    pageIndex,
    pageName,
  };
}

function mxCellTarget(element: XmlElement, pageIndex: number, pageName: string): CellTarget {
  const id = attr(element, 'id');
  const cell = toCell(
    {
      id,
      value: attr(element, 'value'),
      style: attr(element, 'style'),
      parent: attr(element, 'parent'),
      source: attr(element, 'source'),
      target: attr(element, 'target'),
      edge: attr(element, 'edge'),
      vertex: attr(element, 'vertex'),
      visible: attr(element, 'visible'),
    },
    {},
    pageIndex,
    pageName,
  );
  return { cell, valueHost: element, valueAttr: 'value', styleHost: element };
}

/**
 * Registers a wrapper under its id; a different inner `mxCell` id becomes an alias to the same
 * target. The effective label is read as the wrapper `label`, else the wrapper `value`, else the
 * inner `mxCell` value; the write target is the wrapper itself (its `label` when it has none),
 * so `text set` never buries the text in the inner cell.
 */
function wrapperTargets(wrapper: XmlElement, pageIndex: number, pageName: string): Array<[string, CellTarget]> {
  const id = attr(wrapper, 'id');
  const inner = wrapper.children.find((child) => child.name === 'mxCell');
  const styleSource = inner ?? wrapper;
  let valueHost: XmlElement;
  let valueAttr: string;
  let readValue: string;
  if (wrapper.attributes.has('label')) {
    valueHost = wrapper;
    valueAttr = 'label';
    readValue = wrapper.attributes.get('label') ?? '';
  } else if (wrapper.attributes.has('value')) {
    valueHost = wrapper;
    valueAttr = 'value';
    readValue = wrapper.attributes.get('value') ?? '';
  } else if (inner === undefined) {
    valueHost = wrapper;
    valueAttr = 'value';
    readValue = '';
  } else {
    // A bare wrapper shows the inner mxCell value, but draw.io adds new text to it as a label
    // on the wrapper: a value written into the inner cell replaces the object on the next
    // save and drops the wrapper's properties (link, tooltip, custom fields).
    valueHost = wrapper;
    valueAttr = 'label';
    readValue = inner.attributes.get('value') ?? '';
  }
  const cell = toCell(
    {
      id,
      value: readValue,
      style: attr(styleSource, 'style'),
      parent: attr(styleSource, 'parent'),
      source: attr(styleSource, 'source'),
      target: attr(styleSource, 'target'),
      edge: attr(styleSource, 'edge'),
      vertex: attr(styleSource, 'vertex'),
      visible: attr(styleSource, 'visible'),
    },
    Object.fromEntries(wrapper.attributes),
    pageIndex,
    pageName,
  );
  const target: CellTarget = { cell, valueHost, valueAttr, styleHost: styleSource };
  const innerId = inner?.attributes.get('id');
  return innerId !== undefined && innerId !== id
    ? [
        [id, target],
        [innerId, target],
      ]
    : [[id, target]];
}

function collectTargets(elements: XmlElement[], pageIndex: number, pageName: string): Map<string, CellTarget> {
  const targets = new Map<string, CellTarget>();
  const register = (id: string, target: CellTarget): void => {
    if (targets.has(id)) throw new DrawioInputError(`page "${pageName}": cell id "${id}" is repeated`, target.styleHost.tagStart);
    targets.set(id, target);
  };
  const walk = (list: XmlElement[]): void => {
    for (const element of list) {
      if (element.name === 'mxCell') {
        if (element.attributes.has('id')) register(attr(element, 'id'), mxCellTarget(element, pageIndex, pageName));
      } else if (WRAPPER_NAMES.has(element.name)) {
        if (element.attributes.has('id')) {
          for (const [id, target] of wrapperTargets(element, pageIndex, pageName)) register(id, target);
        }
      } else {
        walk(element.children);
      }
    }
  };
  walk(elements);
  return targets;
}

function checkReferences(page: DrawioPage): void {
  for (const cell of page.cells) {
    for (const [name, reference] of [
      ['parent', cell.parent],
      ['source', cell.source],
      ['target', cell.target],
    ] as const) {
      if (reference !== '' && !page.source.targets.has(reference)) {
        // The message names the cell and the attribute, never the referenced value: a dangling
        // reference is free text and may hold an address.
        throw new DrawioInputError(
          `page "${page.name}": cell "${cell.id}" attribute "${name}" references a cell that is not on the page`,
          page.source.targets.get(cell.id)?.styleHost.tagStart,
        );
      }
    }
  }
}

function pageFromText(
  text: string,
  index: number,
  name: string,
  compressed: boolean,
  inner: TextSpan | null,
  elements: XmlElement[],
): DrawioPage {
  const targets = collectTargets(elements, index, name);
  const cells = [...new Set([...targets.values()].map((target) => target.cell))];
  // draw.io writes the page size as pageWidth and pageHeight; a hand-written sheet may name the
  // plain width and height instead, and those stay the fallback.
  const size = (attribute: string, fallback: string): number =>
    Number(elements[0]?.attributes.get(attribute) ?? elements[0]?.attributes.get(fallback) ?? '0') || 0;
  return {
    index,
    name,
    compressed,
    width: size('pageWidth', 'width'),
    height: size('pageHeight', 'height'),
    cells,
    source: { text, targets, inner },
  };
}

function parseDiagramPage(fileText: string, diagram: XmlElement, index: number): DrawioPage {
  const name = diagram.attributes.get('name') ?? '';
  const model = diagram.children.find((child) => child.name === 'mxGraphModel');
  if (model !== undefined) return pageFromText(fileText, index, name, false, null, [model]);
  const payload = fileText.slice(diagram.innerStart, diagram.innerEnd);
  if (payload.trim() === '') return pageFromText(fileText, index, name, false, null, []);
  const context = `page "${name}"`;
  const inner = decodeDiagramPayload(payload, context);
  return pageFromText(
    inner,
    index,
    name,
    true,
    { start: diagram.innerStart, end: diagram.innerEnd },
    parseXml(inner, context),
  );
}

/** Reads an `<mxfile>` with uncompressed or compressed `<diagram>` pages, or a bare `<mxGraphModel>`. */
export function parseDrawio(text: string): DrawioFile {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new DrawioInputError('input is larger than 32 MiB');
  const dtd = text.search(/<!DOCTYPE|<!ENTITY/iu);
  if (dtd >= 0) throw new DrawioInputError('DTD declarations are forbidden', dtd);
  const roots = parseXml(text, 'file');
  const root = roots.length === 1 ? roots[0] : undefined;
  if (root === undefined) throw new DrawioInputError('expected exactly one root element', 0);
  let pages: DrawioPage[];
  if (root.name === 'mxfile') {
    const diagrams = root.children.filter((child) => child.name === 'diagram');
    if (diagrams.length === 0) throw new DrawioInputError('mxfile has no diagram pages', root.tagStart);
    pages = diagrams.map((diagram, index) => parseDiagramPage(text, diagram, index));
  } else if (root.name === 'mxGraphModel') {
    pages = [pageFromText(text, 0, '', false, null, roots)];
  } else {
    throw new DrawioInputError(`unsupported root element "${root.name}"`, root.tagStart);
  }
  for (const page of pages) checkReferences(page);
  return { text, pages };
}

/**
 * Escapes for the delimiter the attribute is written with: a value spliced between single quotes
 * must carry &apos; for every apostrophe, a value between double quotes - &quot;. Escaping the
 * other quote as well would be valid XML but rewrites bytes of the page nobody asked to touch.
 */
function escapeAttributeValue(value: string, quote: string): string {
  const escaped = value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const quoted = quote === "'" ? escaped.replaceAll("'", '&apos;') : escaped.replaceAll('"', '&quot;');
  return quoted.replaceAll('\n', '&#xa;');
}

/** Replaces the raw value of `attrName`, or adds the attribute at the end of the start tag. */
function spliceAttributeValue(text: string, element: XmlElement, attrName: string, escaped: string): string {
  const span = element.valueSpans.get(attrName);
  if (span !== undefined) return text.slice(0, span.valueStart) + escaped + text.slice(span.valueEnd);
  const insertAt = element.selfClosing ? element.tagEnd - 2 : element.tagEnd - 1;
  return `${text.slice(0, insertAt)} ${attrName}="${escaped}"${text.slice(insertAt)}`;
}

export function setCellValue(file: DrawioFile, pageIndex: number, cellId: string, value: string): string {
  return editCellAttribute(file, pageIndex, cellId, 'value', value);
}

export function setCellStyle(file: DrawioFile, pageIndex: number, cellId: string, style: string): string {
  return editCellAttribute(file, pageIndex, cellId, 'style', style);
}

function editCellAttribute(
  file: DrawioFile,
  pageIndex: number,
  cellId: string,
  kind: 'value' | 'style',
  value: string,
): string {
  const page = file.pages[pageIndex];
  const target = page?.source.targets.get(cellId);
  if (page === undefined || target === undefined) throw new RangeError(`cell "${cellId}" is not on page ${pageIndex}`);
  const host = kind === 'value' ? target.valueHost : target.styleHost;
  const attrName = kind === 'value' ? target.valueAttr : 'style';
  const span = host.valueSpans.get(attrName);
  const quote = span !== undefined && page.source.text[span.valueStart - 1] === "'" ? "'" : '"';
  const patched = spliceAttributeValue(page.source.text, host, attrName, escapeAttributeValue(value, quote));
  const inner = page.source.inner;
  if (inner === null) return patched;
  return file.text.slice(0, inner.start) + encodeDiagramPayload(patched) + file.text.slice(inner.end);
}

export interface StylePair {
  key: string;
  value: string;
}

const segmentKey = (segment: string): string => {
  const equal = segment.indexOf('=');
  return equal > 0 ? segment.slice(0, equal).trim() : '';
};

export function parseStyle(style: string): StylePair[] {
  const pairs: StylePair[] = [];
  for (const segment of style.split(';')) {
    const key = segmentKey(segment);
    if (key !== '') pairs.push({ key, value: segment.slice(segment.indexOf('=') + 1).trim() });
  }
  return pairs;
}

export function styleValue(style: string, key: string): string | undefined {
  return parseStyle(style).find((pair) => pair.key === key)?.value;
}

/** Changes the value of `key` in place, or appends the pair at the end; the other keys keep their order. */
export function setStyleKey(style: string, key: string, value: string): string {
  const replacement = `${key}=${value}`;
  const segments = style.split(';');
  if (segments.some((segment) => segmentKey(segment) === key)) {
    return segments.map((segment) => (segmentKey(segment) === key ? replacement : segment)).join(';');
  }
  if (style === '') return `${replacement};`;
  return style.endsWith(';') ? `${style}${replacement};` : `${style};${replacement}`;
}
