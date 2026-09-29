import { attachMarker } from "../src/dom.ts";
import { attachLiveSelection } from "../src/index.ts";

const before = document.querySelector<HTMLElement>("#before");
const after = document.querySelector<HTMLElement>("#after");
const play = document.querySelector<HTMLElement>("#play");
const tabCode = document.querySelector<HTMLAnchorElement>("#tab-code");
const tabText = document.querySelector<HTMLAnchorElement>("#tab-text");
const stage = document.querySelector<HTMLElement>("#stage");
const code = document.querySelector<HTMLElement>("#code");
const poem = document.querySelector<HTMLElement>("#poem");
const radiusValue = document.querySelector<HTMLElement>("#radius-value");
const settings = document.querySelector<HTMLElement>("#settings");
const settingsToggle = document.querySelector<HTMLButtonElement>("#settings-toggle");
const radiusList = document.querySelector<HTMLElement>("#radius-list");
const radiusOptions = Array.from(document.querySelectorAll<HTMLElement>("#radius-list [data-radius]"));
const tabIndicator = document.querySelector<HTMLElement>("#tab-indicator");

if (
  !before || !after || !play || !tabCode || !tabText ||
  !stage || !code || !poem || !radiusValue ||
  !settings || !settingsToggle || !radiusList || !tabIndicator
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

const highlightStyle = { radius: 6, paddingInline: 1 };
const beforeMark = attachMarker(before, [], { radius: 0, paddingInline: 1 });
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
    button.setAttribute("aria-label", "Copied");
    window.clearTimeout(reset);
    reset = window.setTimeout(() => {
      delete button.dataset.copied;
      button.setAttribute("aria-label", "Copy code");
    }, 2000);
  });
}

const liveZones = [document.querySelector("main"), document.querySelector(".tabs"), document.querySelector(".install"), document.querySelector(".usage"), document.querySelector("#radius-list")];
const lives = liveZones.flatMap((zone) => (zone instanceof HTMLElement ? [attachLiveSelection(zone, highlightStyle)] : []));

type Example = "code" | "poem";
let example: Example = "code";

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

function mirrorSelection(): void {
  const selection = document.getSelection();
  const beforeRoot = contentRoot(before!);
  const afterRoot = contentRoot(after!);
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !beforeRoot || !afterRoot) {
    beforeMark.setRanges([]);
    afterMark.setRanges([]);
    return;
  }
  const liveRange = selection.getRangeAt(0);
  const anchorRoot = contentRoot(paneOf(selection.anchorNode) ?? before!);
  const sourceRoot = anchorRoot && liveRange.intersectsNode(anchorRoot) ? anchorRoot : [beforeRoot, afterRoot].find((root) => liveRange.intersectsNode(root));
  const clipped = sourceRoot ? clipRangeToRoot(sourceRoot, liveRange) : null;
  if (!clipped || !sourceRoot) {
    beforeMark.setRanges([]);
    afterMark.setRanges([]);
    return;
  }
  const offsets = offsetsOf(sourceRoot, clipped);
  if (!offsets || offsets[0] === offsets[1]) {
    beforeMark.setRanges([]);
    afterMark.setRanges([]);
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

function selectSample(): void {
  const selection = document.getSelection();
  if (!selection) return;

  const block = example === "poem" ? poem! : code!;
  const sampleRange = document.createRange();
  sampleRange.selectNodeContents(block);
  selection.removeAllRanges();
  selection.addRange(sampleRange);
}

const menuEnter = ["animate-in", "fade-in-0", "zoom-in-95", "slide-in-from-top-2"];
const menuExit = ["animate-out", "fade-out-0", "zoom-out-95", "slide-out-to-top-2"];

function finishClose(event: AnimationEvent): void {
  if (event.target !== radiusList || event.animationName !== "exit") return;
  radiusList!.hidden = true;
  radiusList!.removeEventListener("animationend", finishClose);
}

function setMenuOpen(open: boolean): void {
  settingsToggle!.setAttribute("aria-expanded", String(open));
  radiusList!.removeEventListener("animationend", finishClose);
  if (open) {
    radiusList!.hidden = false;
    radiusList!.classList.remove(...menuExit);
    void radiusList!.offsetWidth;
    radiusList!.classList.add(...menuEnter);
    return;
  }
  if (radiusList!.hidden) return;
  radiusList!.classList.remove(...menuEnter);
  void radiusList!.offsetWidth;
  radiusList!.classList.add(...menuExit);
  radiusList!.addEventListener("animationend", finishClose);
}

function placeTabIndicator(): void {
  const tab = example === "code" ? tabCode! : tabText!;
  const list = tab.parentElement;
  if (!list) return;
  const listBox = list.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  tabIndicator!.style.width = `${tabBox.width}px`;
  tabIndicator!.style.transform = `translateX(${tabBox.left - listBox.left}px)`;
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
  placeTabIndicator();
  if (play!.hidden) {
    requestAnimationFrame(() => selectCompareSample());
    return;
  }
  requestAnimationFrame(() => {
    selectSample();
    for (const live of lives) live.refresh();
  });
}

function applyRadius(next: number): void {
  radiusValue!.textContent = `Radius: ${next}px`;
  afterMark.setStyle({ radius: next });
  for (const live of lives) live.setStyle({ radius: next });
  for (const option of radiusOptions) {
    option.setAttribute("aria-selected", String(Number(option.dataset.radius) === next));
  }
  setMenuOpen(false);
}

tabCode.addEventListener("click", (event) => {
  event.preventDefault();
  showExample("code");
});
tabText.addEventListener("click", (event) => {
  event.preventDefault();
  showExample("poem");
});
settingsToggle.addEventListener("click", () => {
  setMenuOpen(settingsToggle.getAttribute("aria-expanded") !== "true");
});
for (const option of radiusOptions) {
  option.addEventListener("click", () => {
    const next = Number(option.dataset.radius);
    if (Number.isFinite(next)) applyRadius(next);
  });
}
document.addEventListener("click", (event) => {
  if (!settings.contains(event.target as Node)) setMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenuOpen(false);
});
document.addEventListener("selectionchange", mirrorSelection);
window.addEventListener("resize", placeTabIndicator);

const params = new URLSearchParams(location.search);
showExample(params.get("example") === "poem" ? "poem" : "code");
