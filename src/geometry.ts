export interface Point {
  x: number;
  y: number;
}

/** One visual line of a highlight, in the same coordinate space as the overlay. */
export interface LineBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PathOptions {
  /** Corner radius in px. Use 0 for square corners. Default 4. */
  radius?: number;
  /**
   * Edges closer than this are treated as flush, so those lines fuse
   * instead of growing a tiny step. Default 0.5.
   */
  epsilon?: number;
  /**
   * Join line boxes whose vertical gap is at most this many pixels.
   * Default is the tallest box, which closes normal line-height gaps
   * and leaves paragraph-sized gaps separate.
   */
  maxGap?: number;
}

const DEFAULT_RADIUS = 4;
const DEFAULT_EPSILON = 0.5;

/**
 * Build one filled SVG path for a set of line boxes.
 *
 * Lines fuse into one outline only when they touch. A corner rounds outward
 * when that line sticks out past its neighbor, and inward when the line is
 * inset. Flush edges stay straight. Separate lines keep ordinary outer corners.
 */
export function lineBoxesToPath(boxes: LineBox[], options: PathOptions = {}): string {
  const radius = options.radius ?? DEFAULT_RADIUS;
  return prepareOutlines(boxes, options)
    .map((outline) => roundedPolygonPath(outline, radius))
    .filter((path) => path.length > 0)
    .join(" ");
}

/** Sharp clockwise outlines, one per joined run of lines, before corner rounding. */
export function selectionOutlines(boxes: LineBox[], options: PathOptions = {}): Point[][] {
  return prepareOutlines(boxes, options);
}

function prepareOutlines(boxes: LineBox[], options: PathOptions): Point[][] {
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;
  const usable = boxes.filter((box) => box.width > epsilon && box.height > epsilon);
  if (usable.length === 0) return [];

  const maxGap = options.maxGap ?? Math.max(...usable.map((box) => box.height));
  const rows = clusterRows(usable).map((row) => mergeSegments(row, epsilon));
  const outlines: Point[][] = [];
  for (const stack of buildStacks(rows, epsilon, maxGap)) {
    const outline = stackOutline(closeGaps(stack, maxGap), epsilon);
    if (outline.length >= 3) outlines.push(outline);
  }
  return outlines;
}

function clusterRows(boxes: LineBox[]): LineBox[][] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: LineBox[][] = [];

  for (const box of sorted) {
    let row: LineBox[] | undefined;
    // Rows are in top-to-bottom order. Once a row sits fully above this box,
    // every row above that one does too.
    for (let i = rows.length - 1; i >= 0; i--) {
      const sample = rows[i][0];
      const sampleBottom = sample.y + sample.height;
      if (sampleBottom <= box.y) break;
      const overlap = Math.min(sampleBottom, box.y + box.height) - Math.max(sample.y, box.y);
      if (overlap > Math.min(sample.height, box.height) * 0.5) {
        row = rows[i];
        break;
      }
    }
    if (row) row.push(box);
    else rows.push([box]);
  }

  return rows;
}

function mergeSegments(row: LineBox[], epsilon: number): LineBox[] {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const segments: LineBox[] = [];

  for (const box of sorted) {
    const last = segments[segments.length - 1];
    if (last && box.x <= last.x + last.width + epsilon) {
      const right = Math.max(last.x + last.width, box.x + box.width);
      const top = Math.min(last.y, box.y);
      const bottom = Math.max(last.y + last.height, box.y + box.height);
      last.x = Math.min(last.x, box.x);
      last.width = right - last.x;
      last.y = top;
      last.height = bottom - top;
    } else {
      segments.push({ ...box });
    }
  }

  return segments;
}

function buildStacks(rows: LineBox[][], epsilon: number, maxGap: number): LineBox[][] {
  const stacks: LineBox[][] = [];
  let previous: { box: LineBox; stack: number }[] = [];

  for (const segments of rows) {
    const current: { box: LineBox; stack: number }[] = [];
    const used = new Set<number>();

    for (const box of segments) {
      let match = -1;
      let bestOverlap = 0;
      for (let i = 0; i < previous.length; i++) {
        if (used.has(i)) continue;
        const above = previous[i].box;
        const gap = box.y - (above.y + above.height);
        if (gap > maxGap) continue;
        const overlap = intervalOverlap(
          above.x,
          above.x + above.width,
          box.x,
          box.x + box.width,
        );
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          match = i;
        }
      }

      if (match >= 0 && bestOverlap > epsilon) {
        used.add(match);
        const stack = previous[match].stack;
        stacks[stack].push(box);
        current.push({ box, stack });
      } else {
        const stack = stacks.length;
        stacks.push([box]);
        current.push({ box, stack });
      }
    }

    previous = current;
  }

  return stacks;
}

function intervalOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function closeGaps(stack: LineBox[], maxGap: number): LineBox[] {
  const out = stack.map((box) => ({ ...box })).sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < out.length - 1; i++) {
    const bottom = out[i].y + out[i].height;
    const next = out[i + 1];
    const nextBottom = next.y + next.height;
    const gap = next.y - bottom;
    if (gap === 0 || gap > maxGap) continue;

    const mid = (bottom + next.y) / 2;
    if (mid <= out[i].y + 0.5 || mid >= nextBottom - 0.5) continue;
    out[i].height = mid - out[i].y;
    next.y = mid;
    next.height = nextBottom - mid;
  }

  return out;
}

/**
 * Clockwise outline of a vertical stack whose edges already meet.
 * A step is two vertices; a flush edge is one continuous side.
 */
function stackOutline(lines: LineBox[], epsilon: number): Point[] {
  const rightOf = (line: LineBox) => line.x + line.width;
  const bottomOf = (line: LineBox) => line.y + line.height;
  const points: Point[] = [];
  const last = lines[lines.length - 1];

  points.push({ x: lines[0].x, y: lines[0].y });
  points.push({ x: rightOf(lines[0]), y: lines[0].y });

  for (let i = 0; i < lines.length - 1; i++) {
    const y = bottomOf(lines[i]);
    const current = rightOf(lines[i]);
    const next = rightOf(lines[i + 1]);
    if (Math.abs(current - next) > epsilon) {
      points.push({ x: current, y });
      points.push({ x: next, y });
    }
  }

  points.push({ x: rightOf(last), y: bottomOf(last) });
  points.push({ x: last.x, y: bottomOf(last) });

  for (let i = lines.length - 1; i > 0; i--) {
    const y = lines[i].y;
    const current = lines[i].x;
    const previous = lines[i - 1].x;
    if (Math.abs(current - previous) > epsilon) {
      points.push({ x: current, y });
      points.push({ x: previous, y });
    }
  }

  return dedupeConsecutive(points);
}

function roundedPolygonPath(points: Point[], radius: number): string {
  if (points.length < 3) return "";

  const pieces: { start: Point; end: Point; radius: number; sweep: number }[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i + points.length - 1) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const inLength = dist(prev, curr);
    const outLength = dist(curr, next);
    if (inLength < 1e-6 || outLength < 1e-6) continue;

    const inward = scale(sub(curr, prev), 1 / inLength);
    const outward = scale(sub(next, curr), 1 / outLength);
    const cross = inward.x * outward.y - inward.y * outward.x;
    const fillet = Math.abs(cross) < 1e-4 || radius <= 0
      ? 0
      : Math.min(radius, inLength / 2, outLength / 2);

    if (fillet <= 0.01) {
      pieces.push({ start: curr, end: curr, radius: 0, sweep: 1 });
    } else {
      pieces.push({
        start: { x: curr.x - inward.x * fillet, y: curr.y - inward.y * fillet },
        end: { x: curr.x + outward.x * fillet, y: curr.y + outward.y * fillet },
        radius: fillet,
        // Outer corners cut the highlight. An inner step, where two lines
        // touch, curves back into the shape.
        sweep: cross < 0 ? 0 : 1,
      });
    }
  }

  if (pieces.length < 3) return "";

  const commands = [`M ${fmt(pieces[0].start.x)} ${fmt(pieces[0].start.y)}`];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (piece.radius > 0) {
      if (i > 0) commands.push(`L ${fmt(piece.start.x)} ${fmt(piece.start.y)}`);
      commands.push(
        `A ${fmt(piece.radius)} ${fmt(piece.radius)} 0 0 ${piece.sweep} ${fmt(piece.end.x)} ${fmt(piece.end.y)}`,
      );
    } else if (i > 0) {
      commands.push(`L ${fmt(piece.start.x)} ${fmt(piece.start.y)}`);
    }
  }
  commands.push("Z");
  return commands.join(" ");
}

function dedupeConsecutive(points: Point[], epsilon = 0.01): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, point) > epsilon) out.push(point);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= epsilon) out.pop();
  return out;
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fmt(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
