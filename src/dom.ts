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
  const background = rememberBackground(container);

  let radius = style.radius ?? 4;
  let maxGap = style.maxGap;
  let epsilon = style.epsilon ?? 0.5;
  let paddingInline = style.paddingInline ?? 0;
  let color = style.color;
  let frame = 0;

  const paint = () => {
    const width = Math.max(container.scrollWidth, container.clientWidth);
    const height = Math.max(container.scrollHeight, container.clientHeight);
    paintBackground(
      container,
      background,
      lineBoxesToPath(measureRanges(container, selectionRanges(container), paddingInline), {
        radius,
        maxGap,
        epsilon,
      }),
      color ?? systemHighlightColor(doc),
      width,
      height,
    );
  };

  const schedule = () => {
    if (!view) {
      paint();
      return;
    }
    if (frame) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };

  const paintNow = () => {
    if (view && frame) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
    paint();
  };

  doc.addEventListener("selectionchange", schedule);
  doc.addEventListener("scroll", schedule, true);
  view?.addEventListener("resize", schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(container);

  return {
    setStyle(next) {
      if (next.radius !== undefined) radius = next.radius;
      if (next.color !== undefined) color = next.color;
      if (next.maxGap !== undefined) maxGap = next.maxGap;
      if (next.epsilon !== undefined) epsilon = next.epsilon;
      if (next.paddingInline !== undefined) paddingInline = next.paddingInline;
      paintNow();
    },
    refresh: paintNow,
    destroy() {
      if (view && frame) view.cancelAnimationFrame(frame);
      observer.disconnect();
      doc.removeEventListener("selectionchange", schedule);
      doc.removeEventListener("scroll", schedule, true);
      view?.removeEventListener("resize", schedule);
      styleEl.remove();
      restoreBackground(container, background.inline);
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
  const background = rememberBackground(container);

  let radius = style.radius ?? 4;
  let maxGap = style.maxGap;
  let epsilon = style.epsilon ?? 0.5;
  let paddingInline = style.paddingInline ?? 0;
  let color = style.color;
  let frame = 0;
  let current = ranges.map((range) => range.cloneRange());

  const paint = () => {
    const width = Math.max(container.scrollWidth, container.clientWidth);
    const height = Math.max(container.scrollHeight, container.clientHeight);
    paintBackground(
      container,
      background,
      lineBoxesToPath(measureRanges(container, current, paddingInline), {
        radius,
        maxGap,
        epsilon,
      }),
      color ?? systemHighlightColor(doc),
      width,
      height,
    );
  };

  const schedule = () => {
    if (!view) {
      paint();
      return;
    }
    if (frame) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };

  const paintNow = () => {
    if (view && frame) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
    paint();
  };

  doc.addEventListener("scroll", schedule, true);
  view?.addEventListener("resize", schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(container);
  paintNow();

  return {
    setRanges(next) {
      current = next.map((range) => range.cloneRange());
      paintNow();
    },
    setStyle(next) {
      if (next.radius !== undefined) radius = next.radius;
      if (next.color !== undefined) color = next.color;
      if (next.maxGap !== undefined) maxGap = next.maxGap;
      if (next.epsilon !== undefined) epsilon = next.epsilon;
      if (next.paddingInline !== undefined) paddingInline = next.paddingInline;
      paintNow();
    },
    refresh: paintNow,
    destroy() {
      if (view && frame) view.cancelAnimationFrame(frame);
      observer.disconnect();
      doc.removeEventListener("scroll", schedule, true);
      view?.removeEventListener("resize", schedule);
      restoreBackground(container, background.inline);
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
    `${root}::selection,${root} *::selection{background:transparent;color:inherit;}`;
  doc.head.append(styleEl);
  return styleEl;
}

interface BackgroundSnapshot {
  image: string;
  repeat: string;
  position: string;
  size: string;
}

function rememberBackground(container: HTMLElement): { inline: BackgroundSnapshot; painted: BackgroundSnapshot } {
  const computed = getComputedStyle(container);
  return {
    inline: {
      image: container.style.backgroundImage,
      repeat: container.style.backgroundRepeat,
      position: container.style.backgroundPosition,
      size: container.style.backgroundSize,
    },
    painted: {
      image: computed.backgroundImage,
      repeat: computed.backgroundRepeat,
      position: computed.backgroundPosition,
      size: computed.backgroundSize,
    },
  };
}

function paintBackground(
  container: HTMLElement,
  snapshot: { inline: BackgroundSnapshot; painted: BackgroundSnapshot },
  d: string,
  color: string,
  width: number,
  height: number,
) {
  if (!d) {
    restoreBackground(container, snapshot.inline);
    return;
  }
  // The highlight is the element's own background. A negative z-index overlay
  // is painted over the glyphs when a selection spans the whole container.
  const xml =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<path fill="${escapeAttr(color)}" d="${escapeAttr(d)}"/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(xml)}")`;
  const prior = snapshot.painted;
  if (prior.image && prior.image !== "none") {
    container.style.backgroundImage = `${url}, ${prior.image}`;
    container.style.backgroundRepeat = `no-repeat, ${prior.repeat}`;
    container.style.backgroundPosition = `0px 0px, ${prior.position}`;
    container.style.backgroundSize = `auto, ${prior.size}`;
  } else {
    container.style.backgroundImage = url;
    container.style.backgroundRepeat = "no-repeat";
    container.style.backgroundPosition = "0px 0px";
    container.style.backgroundSize = "auto";
  }
}

function restoreBackground(container: HTMLElement, inline: BackgroundSnapshot) {
  container.style.backgroundImage = inline.image;
  container.style.backgroundRepeat = inline.repeat;
  container.style.backgroundPosition = inline.position;
  container.style.backgroundSize = inline.size;
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

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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

function measureRanges(container: HTMLElement, ranges: Range[], paddingInline: number): LineBox[] {
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
      appendRects(boxes, range, lineHeightOf(parent, lineHeights), offsetX, offsetY, paddingInline);
      continue;
    }
    for (const text of texts) {
      const slice = clipRangeToText(range, text);
      if (!slice) continue;
      appendRects(boxes, slice, lineHeightOf(text.parentElement, lineHeights), offsetX, offsetY, paddingInline);
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
): void {
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (rect.width <= 0 || rect.height <= 0) continue;
    const height = Math.max(rect.height, lineHeight);
    boxes.push({
      x: rect.left + offsetX,
      y: rect.top - (height - rect.height) / 2 + offsetY,
      width: rect.width + paddingInline * 2,
      height,
    });
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
