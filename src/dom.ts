import { lineBoxesToPath, type LineBox, type PathOptions } from "./geometry.js";

export interface HighlightStyle extends PathOptions {
  /** Fill color. Defaults to the system text selection color, CSS `Highlight`. */
  color?: string;
  /** Extra space on the left and right of each line box, in px. Default 0. */
  paddingInline?: number;
}

export interface HighlightHandle {
  setStyle(style: HighlightStyle): void;
  refresh(): void;
  destroy(): void;
}

/**
 * Follow the pointer the way the editor selection does.
 * The browser selection stays in place so copy and paste still work;
 * only its paint is replaced inside `container`.
 */
export function attachLiveSelection(
  container: HTMLElement,
  style: HighlightStyle = {},
): HighlightHandle {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const styleEl = mountHighlightRoot(container);
  const layer = mountHighlightLayer(container);

  let radius = style.radius ?? 4;
  let maxGap = style.maxGap;
  let epsilon = style.epsilon ?? 0.5;
  let paddingInline = style.paddingInline ?? 0;
  let color = style.color;

  const paint = () => {
    const { width, height } = contentBox(container, layer.svg);
    paintLayer(
      layer,
      lineBoxesToPath(measureRanges(container, selectionRanges(container), paddingInline, layer.svg), {
        radius,
        maxGap,
        epsilon,
      }),
      color ?? systemHighlightColor(doc),
      width,
      height,
    );
  };

  const binding = bindFrame(view, paint);

  doc.addEventListener("selectionchange", binding.schedule);
  doc.addEventListener("scroll", binding.schedule, true);
  view?.addEventListener("resize", binding.schedule);
  const observer = new ResizeObserver(binding.schedule);
  observer.observe(container);

  return {
    setStyle(next) {
      if (next.radius !== undefined) radius = next.radius;
      if (next.color !== undefined) color = next.color;
      if (next.maxGap !== undefined) maxGap = next.maxGap;
      if (next.epsilon !== undefined) epsilon = next.epsilon;
      if (next.paddingInline !== undefined) paddingInline = next.paddingInline;
      binding.paintNow();
    },
    refresh: binding.paintNow,
    destroy() {
      binding.destroy();
      observer.disconnect();
      doc.removeEventListener("selectionchange", binding.schedule);
      doc.removeEventListener("scroll", binding.schedule, true);
      view?.removeEventListener("resize", binding.schedule);
      styleEl.remove();
      layer.restore();
      container.removeAttribute("data-rounded-highlight");
    },
  };
}

export interface MarkerHandle extends HighlightHandle {
  setRanges(ranges: Range[]): void;
}

/**
 * Paint a fixed passage. Used by the demo's before/after comparison.
 * Not part of the public API.
 */
export function attachMarker(
  container: HTMLElement,
  ranges: Range[],
  style: HighlightStyle = {},
): MarkerHandle {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const layer = mountHighlightLayer(container);

  let radius = style.radius ?? 4;
  let maxGap = style.maxGap;
  let epsilon = style.epsilon ?? 0.5;
  let paddingInline = style.paddingInline ?? 0;
  let color = style.color;
  let current = ranges.map((range) => range.cloneRange());

  const paint = () => {
    const { width, height } = contentBox(container, layer.svg);
    paintLayer(
      layer,
      lineBoxesToPath(measureRanges(container, current, paddingInline, layer.svg), {
        radius,
        maxGap,
        epsilon,
      }),
      color ?? systemHighlightColor(doc),
      width,
      height,
    );
  };

  const binding = bindFrame(view, paint);

  doc.addEventListener("scroll", binding.schedule, true);
  view?.addEventListener("resize", binding.schedule);
  const observer = new ResizeObserver(binding.schedule);
  observer.observe(container);
  binding.paintNow();

  return {
    setRanges(next) {
      current = next.map((range) => range.cloneRange());
      binding.paintNow();
    },
    setStyle(next) {
      if (next.radius !== undefined) radius = next.radius;
      if (next.color !== undefined) color = next.color;
      if (next.maxGap !== undefined) maxGap = next.maxGap;
      if (next.epsilon !== undefined) epsilon = next.epsilon;
      if (next.paddingInline !== undefined) paddingInline = next.paddingInline;
      binding.paintNow();
    },
    refresh: binding.paintNow,
    destroy() {
      binding.destroy();
      observer.disconnect();
      doc.removeEventListener("scroll", binding.schedule, true);
      view?.removeEventListener("resize", binding.schedule);
      layer.restore();
    },
  };
}

/** Coalesce selection changes to one paint per frame, on every browser. */
function bindFrame(
  view: Window | null,
  paint: () => void,
): { schedule: () => void; paintNow: () => void; destroy: () => void } {
  let frame = 0;
  let dead = false;
  const paintNow = () => {
    if (dead) return;
    if (view && frame) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
    paint();
  };
  return {
    schedule() {
      if (dead) return;
      if (!view) {
        paint();
        return;
      }
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        if (!dead) paint();
      });
    },
    paintNow,
    destroy() {
      dead = true;
      if (view && frame) view.cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

function mountHighlightRoot(container: HTMLElement): HTMLStyleElement {
  const doc = container.ownerDocument;
  const token = `rh-${Math.random().toString(36).slice(2, 8)}`;
  container.setAttribute("data-rounded-highlight", token);
  const root = `[data-rounded-highlight="${token}"]`;
  const styleEl = doc.createElement("style");
  styleEl.textContent =
    `${root}::selection,${root} *::selection,${root}::-webkit-selection,${root} *::-webkit-selection{background-color:transparent;color:inherit;}`;
  doc.head.append(styleEl);
  return styleEl;
}

interface HighlightLayer {
  svg: SVGSVGElement;
  path: SVGPathElement;
  restore: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * One SVG, updated by rewriting its path. Replacing a data-URL background
 * makes Safari decode a new image on every character and the drag stutters.
 * `isolation` keeps this z-index:-1 shape behind the glyphs, including when
 * the selection covers the whole container.
 */
function mountHighlightLayer(container: HTMLElement): HighlightLayer {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, "svg");
  const path = doc.createElementNS(SVG_NS, "path");
  svg.append(path);
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.linecoveHighlight = "";
  svg.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;user-select:none;-webkit-user-select:none;z-index:-1";

  const previous = {
    position: container.style.position,
    isolation: container.style.isolation,
  };
  const computed = getComputedStyle(container);
  if (computed.position === "static") container.style.position = "relative";
  if (computed.isolation !== "isolate") container.style.isolation = "isolate";
  container.prepend(svg);

  return {
    svg,
    path,
    restore() {
      svg.remove();
      container.style.position = previous.position;
      container.style.isolation = previous.isolation;
    },
  };
}

/** Size of the element without the highlight SVG. The SVG's default 300×150 box would otherwise become the scroll height. */
function contentBox(container: HTMLElement, svg: SVGSVGElement): { width: number; height: number } {
  const widthStyle = svg.style.width;
  const heightStyle = svg.style.height;
  svg.style.width = "0px";
  svg.style.height = "0px";
  const width = Math.max(container.scrollWidth, container.clientWidth);
  const height = Math.max(container.scrollHeight, container.clientHeight);
  svg.style.width = widthStyle;
  svg.style.height = heightStyle;
  return { width, height };
}

function paintLayer(layer: HighlightLayer, d: string, color: string, width: number, height: number) {
  layer.svg.style.width = "";
  layer.svg.style.height = "";
  const widthAttr = String(width);
  const heightAttr = String(height);
  const viewBox = `0 0 ${width} ${height}`;
  if (layer.svg.getAttribute("width") !== widthAttr) layer.svg.setAttribute("width", widthAttr);
  if (layer.svg.getAttribute("height") !== heightAttr) layer.svg.setAttribute("height", heightAttr);
  if (layer.svg.getAttribute("viewBox") !== viewBox) layer.svg.setAttribute("viewBox", viewBox);
  if (!d) {
    if (layer.path.getAttribute("d")) layer.path.removeAttribute("d");
    return;
  }
  if (layer.path.getAttribute("fill") !== color) layer.path.setAttribute("fill", color);
  if (layer.path.getAttribute("d") !== d) layer.path.setAttribute("d", d);
}

const highlightProbes = new WeakMap<Document, HTMLSpanElement>();

/** The CSS system color `Highlight`, resolved in this document so the SVG fill can use it. */
function systemHighlightColor(doc: Document): string {
  const view = doc.defaultView;
  const parent = doc.body ?? doc.documentElement;
  if (!view || !parent) return "Highlight";

  let probe = highlightProbes.get(doc);
  if (!probe?.isConnected) {
    probe = doc.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;background-color:Highlight";
    parent.append(probe);
    highlightProbes.set(doc, probe);
  }

  const color = view.getComputedStyle(probe).backgroundColor;
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return "Highlight";
  return color;
}

function selectionRanges(container: HTMLElement): Range[] {
  const selection = container.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];

  const ranges: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) continue;
    const anchor = range.commonAncestorContainer;
    if (container.contains(anchor) || range.intersectsNode(container)) ranges.push(range);
  }
  return ranges;
}

function measureRanges(container: HTMLElement, ranges: Range[], paddingInline: number, ignore?: Element): LineBox[] {
  if (ranges.length === 0) return [];

  const origin = container.getBoundingClientRect();
  const computed = getComputedStyle(container);
  const offsetX = container.scrollLeft - origin.left - (Number.parseFloat(computed.borderLeftWidth) || 0) - paddingInline;
  const offsetY = container.scrollTop - origin.top - (Number.parseFloat(computed.borderTopWidth) || 0);
  const boxes: LineBox[] = [];
  const lineHeights = new Map<Element, number>();

  for (const range of ranges) {
    const texts = textNodesIn(range);
    if (texts.length === 0) continue;
    const parent = texts[0].parentElement;
    if (texts.every((text) => text.parentElement === parent)) {
      appendRects(boxes, range, lineHeightOf(parent, lineHeights), offsetX, offsetY, paddingInline, ignore);
      continue;
    }
    for (const text of texts) {
      const slice = clipRangeToText(range, text);
      if (!slice) continue;
      appendRects(boxes, slice, lineHeightOf(text.parentElement, lineHeights), offsetX, offsetY, paddingInline, ignore);
    }
  }

  return boxes;
}

function appendRects(
  boxes: LineBox[],
  range: Range,
  lineHeight: number,
  offsetX: number,
  offsetY: number,
  paddingInline: number,
  ignore?: Element,
): void {
  let skip: DOMRect | null = null;
  if (ignore) {
    try {
      if (range.intersectsNode(ignore)) skip = ignore.getBoundingClientRect();
    } catch {
      skip = null;
    }
  }
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      skip &&
      Math.abs(rect.left - skip.left) < 0.5 &&
      Math.abs(rect.top - skip.top) < 0.5 &&
      Math.abs(rect.width - skip.width) < 0.5 &&
      Math.abs(rect.height - skip.height) < 0.5
    ) continue;
    const height = Math.max(rect.height, lineHeight);
    const next = {
      x: rect.left + offsetX,
      y: rect.top - (height - rect.height) / 2 + offsetY,
      width: rect.width + paddingInline * 2,
      height,
    };
    // Safari can return one rect per character, with a subpixel crack between
    // them. Fuse those so the outline grows by the line, not by the glyph.
    const last = boxes[boxes.length - 1];
    if (
      last &&
      Math.abs(last.y - next.y) <= 1 &&
      Math.abs(last.height - next.height) <= 1 &&
      next.x <= last.x + last.width + 1 &&
      next.x + next.width >= last.x - 1
    ) {
      const right = Math.max(last.x + last.width, next.x + next.width);
      const top = Math.min(last.y, next.y);
      const bottom = Math.max(last.y + last.height, next.y + next.height);
      last.x = Math.min(last.x, next.x);
      last.y = top;
      last.width = right - last.x;
      last.height = bottom - top;
      continue;
    }
    boxes.push(next);
  }
}

/** Text nodes the range actually covers, in document order, stopping at the end. */
function textNodesIn(range: Range): Text[] {
  const { startContainer, endContainer } = range;
  if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
    return [startContainer as Text];
  }

  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument;
  if (!doc) return [];
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    node = startContainer;
    walker.currentNode = startContainer;
  } else {
    walker.currentNode = startContainer;
    node = walker.nextNode();
  }

  const nodes: Text[] = [];
  while (node && node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    if (range.intersectsNode(text)) nodes.push(text);
    else if (pastRange(range, text)) break;
    if (text === endContainer) break;
    node = walker.nextNode();
  }
  return nodes;
}

function pastRange(range: Range, node: Node): boolean {
  try {
    return range.comparePoint(node, 0) === 1;
  } catch {
    return true;
  }
}

/** The part of `range` that lies inside `text`. */
function clipRangeToText(range: Range, text: Text): Range | null {
  const doc = text.ownerDocument;
  if (!doc) return null;
  const slice = range.cloneRange();
  const nodeRange = doc.createRange();
  nodeRange.selectNodeContents(text);
  if (slice.compareBoundaryPoints(Range.END_TO_START, nodeRange) >= 0) return null;
  if (slice.compareBoundaryPoints(Range.START_TO_END, nodeRange) <= 0) return null;
  if (slice.compareBoundaryPoints(Range.START_TO_START, nodeRange) < 0) slice.setStart(text, 0);
  if (slice.compareBoundaryPoints(Range.END_TO_END, nodeRange) > 0) slice.setEnd(text, text.length);
  return slice.collapsed ? null : slice;
}

function lineHeightOf(element: Element | null, cache: Map<Element, number>): number {
  if (!element) return 0;
  const cached = cache.get(element);
  if (cached !== undefined) return cached;

  const style = getComputedStyle(element);
  const parsed = Number.parseFloat(style.lineHeight);
  const fontSize = Number.parseFloat(style.fontSize) || 0;
  const value = style.lineHeight === "normal" || !Number.isFinite(parsed) ? fontSize * 1.2 : parsed;
  cache.set(element, value);
  return value;
}
