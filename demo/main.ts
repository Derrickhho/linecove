import { inject } from "@vercel/analytics";
import { attachMarker } from "../src/dom.ts";
import { attachLiveSelection } from "../src/index.ts";

// Initialize Vercel Web Analytics
inject({
  mode: import.meta.env.PROD ? 'production' : 'development',
});

const before = document.querySelector<HTMLElement>("#before");
const after = document.querySelector<HTMLElement>("#after");
const play = document.querySelector<HTMLElement>("#play");
const tabCode = document.querySelector<HTMLAnchorElement>("#tab-code");
const tabText = document.querySelector<HTMLAnchorElement>("#tab-text");
const stage = document.querySelector<HTMLElement>("#stage");
const code = document.querySelector<HTMLElement>("#code");
const poem = document.querySelector<HTMLElement>("#poem");
const radiusIconPath = document.querySelector<SVGPathElement>("#radius-icon-path");
const settings = document.querySelector<HTMLElement>("#settings");
const settingsToggle = document.querySelector<HTMLButtonElement>("#settings-toggle");
const radiusList = document.querySelector<HTMLElement>("#radius-list");
const radiusOptions = Array.from(document.querySelectorAll<HTMLElement>("#radius-list [data-radius]"));
const colorToggle = document.querySelector<HTMLButtonElement>("#color-toggle");
const colorSwatch = document.querySelector<HTMLElement>("#color-swatch");
const colorList = document.querySelector<HTMLElement>("#color-list");
const colorOptions = Array.from(document.querySelectorAll<HTMLElement>("#color-list [data-color]"));
const badgeFill = document.querySelector<SVGPathElement>("#badge-fill");
const tabIndicator = document.querySelector<HTMLElement>("#tab-indicator");

if (
  !before || !after || !play || !tabCode || !tabText ||
  !stage || !code || !poem || !radiusIconPath ||
  !settings || !settingsToggle || !radiusList ||
  !colorToggle || !colorSwatch || !colorList || !badgeFill || !tabIndicator
) {
  throw new Error("Demo markup is missing an expected element.");
}

for (const pane of [before, after]) {
  for (const source of [code, poem]) {
    const copy = source.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    pane.append(copy);
  }
}

const defaultHighlightColor = "rgba(35, 164, 255, 0.3)";
const highlightStyle = { radius: 6, paddingInline: 1, color: defaultHighlightColor };
const beforeMark = attachMarker(before, [], { radius: 0, paddingInline: 1, color: defaultHighlightColor });
const afterMark = attachMarker(after, [], highlightStyle);

for (const snippet of document.querySelectorAll<HTMLElement>(".snippet")) {
  const button = snippet.querySelector<HTMLButtonElement>(".copy");
  const code = snippet.querySelector("code");
  if (!button || !code) continue;
  let reset = 0;
  button.addEventListener("click", async () => {
    const text = code.innerText.replace(/[ \t]+$/gm, "").replace(/\n$/, "");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    button.dataset.copied = "true";
    button.dataset.state = "b";
    button.setAttribute("aria-label", "Copied");
    window.clearTimeout(reset);
    reset = window.setTimeout(() => {
      delete button.dataset.copied;
      button.dataset.state = "a";
      button.setAttribute("aria-label", "Copy code");
    }, 2000);
  });
}

const liveZones = [document.querySelector("main"), document.querySelector(".install"), document.querySelector(".usage")];
const lives = liveZones.flatMap((zone) => (zone instanceof HTMLElement ? [attachLiveSelection(zone, highlightStyle)] : []));

type Example = "code" | "poem";
let example: Example = "code";
let tabsPlaced = false;

function paneOf(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const pane = element?.closest("#before, #after");
  return pane instanceof HTMLElement ? pane : null;
}

function contentRoot(pane: HTMLElement): HTMLElement | null {
  const block = pane.querySelector(example === "code" ? ".example-code" : ".example-text");
  return block instanceof HTMLElement ? block : null;
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function offsetsOf(root: HTMLElement, range: Range): [number, number] | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = range.cloneRange();
  start.selectNodeContents(root);
  start.setEnd(range.startContainer, range.startOffset);
  const end = range.cloneRange();
  end.selectNodeContents(root);
  end.setEnd(range.endContainer, range.endOffset);
  const from = start.toString().length;
  const to = end.toString().length;
  return from <= to ? [from, to] : [to, from];
}

function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  const nodes = textNodes(root);
  let seen = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  for (const text of nodes) {
    const next = seen + text.length;
    if (!startNode && start <= next) {
      startNode = text;
      startOffset = start - seen;
    }
    if (startNode && end <= next) {
      range.setStart(startNode, startOffset);
      range.setEnd(text, Math.max(0, end - seen));
      return range;
    }
    seen = next;
  }
  const last = nodes.at(-1);
  if (!startNode || !last) return null;
  range.setStart(startNode, startOffset);
  range.setEnd(last, last.length);
  return range;
}

function clipRangeToRoot(root: HTMLElement, range: Range): Range | null {
  if (!range.intersectsNode(root)) return null;
  const nodes = textNodes(root);
  const first = nodes[0];
  const last = nodes.at(-1);
  if (!first || !last) return null;
  const clipped = range.cloneRange();
  if (!root.contains(range.startContainer)) clipped.setStart(first, 0);
  if (!root.contains(range.endContainer)) clipped.setEnd(last, last.length);
  return clipped.collapsed ? null : clipped;
}

function selectionInSettings(): boolean {
  const node = document.getSelection()?.anchorNode;
  return !!node && settings!.contains(node);
}

function selectionInCompare(): boolean {
  const node = document.getSelection()?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el && !!el.closest("#before, #after");
}

function clearCompareHighlight(): void {
  beforeMark.setRanges([]);
  afterMark.setRanges([]);
}

function mirrorSelection(): void {
  if (selectionInSettings()) return;
  const selection = document.getSelection();
  const beforeRoot = contentRoot(before!);
  const afterRoot = contentRoot(after!);
  if (!beforeRoot || !afterRoot) return;

  // Normal behavior inside the panes: a collapsed click clears the
  // highlight. Selecting elsewhere on the page leaves the compare
  // highlight alone so it stays independent of live page selection.
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    if (selectionInCompare()) clearCompareHighlight();
    return;
  }

  const liveRange = selection.getRangeAt(0);
  const anchorRoot = contentRoot(paneOf(selection.anchorNode) ?? before!);
  const sourceRoot = anchorRoot && liveRange.intersectsNode(anchorRoot) ? anchorRoot : [beforeRoot, afterRoot].find((root) => liveRange.intersectsNode(root));
  const clipped = sourceRoot ? clipRangeToRoot(sourceRoot, liveRange) : null;
  if (!clipped || !sourceRoot) return;
  const offsets = offsetsOf(sourceRoot, clipped);
  if (!offsets || offsets[0] === offsets[1]) {
    if (selectionInCompare()) clearCompareHighlight();
    return;
  }
  const left = rangeFromOffsets(beforeRoot, offsets[0], offsets[1]);
  const right = rangeFromOffsets(afterRoot, offsets[0], offsets[1]);
  beforeMark.setRanges(left ? [left] : []);
  afterMark.setRanges(right ? [right] : []);
}

function selectCompareSample(): void {
  const selection = document.getSelection();
  const root = contentRoot(before!);
  if (!selection || !root) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  selection.removeAllRanges();
  selection.addRange(range);
  mirrorSelection();
}

function paintCompareSample(durationMs = 280): void {
  const selection = document.getSelection();
  const beforeRoot = contentRoot(before!);
  const afterRoot = contentRoot(after!);
  if (!selection || !beforeRoot || !afterRoot) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || durationMs <= 0) {
    selectCompareSample();
    return;
  }

  const full = beforeRoot.textContent?.length ?? 0;
  if (full === 0) {
    selectCompareSample();
    return;
  }

  const start = performance.now();
  const easeOut = (t: number): number => 1 - (1 - t) ** 3;

  const frame = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    const end = Math.max(1, Math.round(full * easeOut(t)));
    const live = rangeFromOffsets(beforeRoot, 0, end);
    if (live) {
      selection.removeAllRanges();
      selection.addRange(live);
    }
    const left = rangeFromOffsets(beforeRoot, 0, end);
    const right = rangeFromOffsets(afterRoot, 0, end);
    beforeMark.setRanges(left ? [left] : []);
    afterMark.setRanges(right ? [right] : []);
    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }
    selectCompareSample();
  };

  requestAnimationFrame(frame);
}

function selectSample(): void {
  const selection = document.getSelection();
  if (!selection) return;

  const block = example === "poem" ? poem! : code!;
  const sampleRange = document.createRange();
  sampleRange.selectNodeContents(block);
  selection.removeAllRanges();
  selection.addRange(sampleRange);
}

const dropdownCloseMs = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur"),
) || 150;
const dropdownTimers = new WeakMap<HTMLElement, number>();

function setDropdownOpen(menu: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
  toggle.setAttribute("aria-expanded", String(open));
  window.clearTimeout(dropdownTimers.get(menu) ?? 0);
  if (open) {
    menu.hidden = false;
    menu.classList.remove("is-closing");
    void menu.offsetWidth;
    menu.classList.add("is-open");
    return;
  }
  if (!menu.classList.contains("is-open") && menu.hidden) return;
  menu.classList.remove("is-open");
  menu.classList.add("is-closing");
  dropdownTimers.set(
    menu,
    window.setTimeout(() => {
      menu.classList.remove("is-closing");
      menu.hidden = true;
    }, dropdownCloseMs),
  );
}

function closeAllMenus(): void {
  setDropdownOpen(radiusList!, settingsToggle!, false);
  setDropdownOpen(colorList!, colorToggle!, false);
}

function placeTabIndicator(animate: boolean): void {
  const tab = example === "code" ? tabCode! : tabText!;
  const pill = tabIndicator!;
  if (!animate) {
    const prev = pill.style.transition;
    pill.style.transition = "none";
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;
    void pill.offsetWidth;
    pill.style.transition = prev;
    return;
  }
  pill.style.transform = `translateX(${tab.offsetLeft}px)`;
  pill.style.width = `${tab.offsetWidth}px`;
}

function showExample(next: Example): void {
  example = next;
  const showingCode = next === "code";
  for (const block of document.querySelectorAll<HTMLElement>(".example-code")) {
    block.hidden = false;
    block.classList.toggle("is-inactive", !showingCode);
  }
  for (const block of document.querySelectorAll<HTMLElement>(".example-text")) {
    block.hidden = false;
    block.classList.toggle("is-inactive", showingCode);
  }
  tabCode!.setAttribute("aria-selected", String(showingCode));
  tabText!.setAttribute("aria-selected", String(!showingCode));
  placeTabIndicator(tabsPlaced);
  tabsPlaced = true;
  if (play!.hidden) {
    if (revealReady) requestAnimationFrame(() => selectCompareSample());
    return;
  }
  requestAnimationFrame(() => {
    selectSample();
    for (const live of lives) live.refresh();
  });
}

function radiusIconPathD(radius: number): string {
  // Map demo radii (2–16) onto the icon corner so each step is easy to read.
  const r = Math.max(0, Math.min(10, (radius / 16) * 10));
  if (r < 0.35) return "M14 2H2V14";
  const x = (2 + r).toFixed(2);
  const y = (2 + r).toFixed(2);
  const arc = r.toFixed(2);
  return `M14 2H${x}A${arc} ${arc} 0 0 0 2 ${y}V14`;
}

function setRadiusIcon(next: number): void {
  radiusIconPath!.setAttribute("d", radiusIconPathD(next));
  settingsToggle!.setAttribute("aria-label", `Radius: ${next}px`);
}

function savedSelection(): Range[] {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  return Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
}

function restoreSelection(ranges: Range[]): void {
  const selection = document.getSelection();
  if (!selection || ranges.length === 0) return;
  const unchanged =
    selection.rangeCount === ranges.length &&
    ranges.every((range, index) => {
      const current = selection.getRangeAt(index);
      return (
        current.startContainer === range.startContainer &&
        current.startOffset === range.startOffset &&
        current.endContainer === range.endContainer &&
        current.endOffset === range.endOffset
      );
    });
  if (unchanged) return;
  selection.removeAllRanges();
  for (const range of ranges) {
    if (range.startContainer.isConnected && range.endContainer.isConnected) selection.addRange(range);
  }
}

let preservedSelection: Range[] = [];

function applyRadius(next: number): void {
  setRadiusIcon(next);
  afterMark.setStyle({ radius: next });
  for (const live of lives) live.setStyle({ radius: next });
  for (const option of radiusOptions) {
    option.setAttribute("aria-selected", String(Number(option.dataset.radius) === next));
  }
  closeAllMenus();
}

function applyColor(next: string, label: string, swatch: string): void {
  colorSwatch!.style.background = swatch;
  badgeFill!.setAttribute("fill", next);
  colorToggle!.setAttribute("aria-label", `Highlight color: ${label}`);
  beforeMark.setStyle({ color: next });
  afterMark.setStyle({ color: next });
  for (const live of lives) live.setStyle({ color: next });
  for (const option of colorOptions) {
    option.setAttribute("aria-selected", String(option.dataset.color === next));
  }
  closeAllMenus();
}

tabCode.addEventListener("click", (event) => {
  event.preventDefault();
  showExample("code");
});
tabText.addEventListener("click", (event) => {
  event.preventDefault();
  showExample("poem");
});
settings.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  preservedSelection = savedSelection();
  event.preventDefault();
});
settings.addEventListener("mouseup", () => {
  restoreSelection(preservedSelection);
});
settingsToggle.addEventListener("click", () => {
  const open = settingsToggle.getAttribute("aria-expanded") !== "true";
  setDropdownOpen(colorList!, colorToggle!, false);
  setDropdownOpen(radiusList!, settingsToggle!, open);
});
colorToggle.addEventListener("click", () => {
  const open = colorToggle.getAttribute("aria-expanded") !== "true";
  setDropdownOpen(radiusList!, settingsToggle!, false);
  setDropdownOpen(colorList!, colorToggle!, open);
});
for (const option of radiusOptions) {
  option.addEventListener("click", () => {
    const next = Number(option.dataset.radius);
    if (Number.isFinite(next)) applyRadius(next);
  });
}
for (const option of colorOptions) {
  option.addEventListener("click", () => {
    const next = option.dataset.color;
    const label = option.dataset.label ?? "Color";
    const swatch = option.querySelector<HTMLElement>(".color-swatch")?.style.background || next;
    if (next) applyColor(next, label, swatch);
  });
}
document.addEventListener("click", (event) => {
  if (!settings.contains(event.target as Node)) closeAllMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllMenus();
});
document.addEventListener("selectionchange", mirrorSelection);
window.addEventListener("resize", () => placeTabIndicator(false));

function bindScrollEdges(): void {
  const root = document.documentElement;
  let overscrollTimer = 0;

  const update = (): void => {
    const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
    const y = window.scrollY;
    root.classList.toggle("scroll-edge-top", y > 4);
    root.classList.toggle("scroll-edge-bottom", y < maxScroll - 4);
  };

  const flashOverscroll = (edge: "top" | "bottom"): void => {
    root.classList.toggle("overscroll-top", edge === "top");
    root.classList.toggle("overscroll-bottom", edge === "bottom");
    window.clearTimeout(overscrollTimer);
    overscrollTimer = window.setTimeout(() => {
      root.classList.remove("overscroll-top", "overscroll-bottom");
    }, 280);
  };

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  window.addEventListener(
    "wheel",
    (event) => {
      const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
      const y = window.scrollY;
      if (y <= 0 && event.deltaY < 0) flashOverscroll("top");
      if (y >= maxScroll && event.deltaY > 0) flashOverscroll("bottom");
    },
    { passive: true },
  );

  let touchY = 0;
  window.addEventListener("touchstart", (event) => {
    touchY = event.touches[0]?.clientY ?? 0;
  }, { passive: true });
  window.addEventListener(
    "touchmove",
    (event) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      const delta = y - touchY;
      touchY = y;
      const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
      const scrollY = window.scrollY;
      if (scrollY <= 0 && delta > 0) flashOverscroll("top");
      if (scrollY >= maxScroll && delta < 0) flashOverscroll("bottom");
    },
    { passive: true },
  );

  update();
}

bindScrollEdges();

let revealReady = false;

function revealCompare(): void {
  if (revealReady) return;
  revealReady = true;
  if (!play!.hidden) return;
  paintCompareSample(280);
}

function playEnter(): void {
  const main = document.querySelector<HTMLElement>("main.t-enter");
  if (!main) {
    revealCompare();
    return;
  }
  const items = main.querySelectorAll<HTMLElement>(".t-enter-item");
  items.forEach((item, index) => item.style.setProperty("--enter-index", String(index)));
  const panel = main.querySelector<HTMLElement>(".panel.t-enter-item");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (panel && !reduce) {
    const styles = getComputedStyle(document.documentElement);
    const stagger = parseFloat(styles.getPropertyValue("--enter-stagger")) || 72;
    const panelIndex = Number(panel.style.getPropertyValue("--enter-index") || 0);
    // Start painting once the panel has begun to show, not after it finishes.
    const wait = panelIndex * stagger + 120;
    window.setTimeout(revealCompare, wait);
  } else {
    revealCompare();
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => main.classList.add("is-shown"));
  });
}

const params = new URLSearchParams(location.search);
showExample(params.get("example") === "poem" ? "poem" : "code");
playEnter();
