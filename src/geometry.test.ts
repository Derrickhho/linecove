import assert from "node:assert/strict";
import test from "node:test";
import { lineBoxesToPath, selectionOutlines, type Point } from "./geometry.js";

test("a single line is a four-corner rounded rectangle", () => {
  const path = lineBoxesToPath([{ x: 0, y: 0, width: 100, height: 20 }], { radius: 4 });
  assert.equal(arcCount(path), 4);
  assert.equal(path.startsWith("M "), true);
  assert.equal(path.endsWith("Z"), true);
});

test("flush edges fuse into one rectangle", () => {
  const outlines = selectionOutlines([
    { x: 0, y: 0, width: 80, height: 10 },
    { x: 0, y: 10, width: 80, height: 10 },
  ]);
  assert.equal(outlines.length, 1);
  assert.equal(outlines[0].length, 4);
  assert.equal(concaveCount(outlines[0]), 0);
  assert.equal(arcCount(lineBoxesToPath([
    { x: 0, y: 0, width: 80, height: 10 },
    { x: 0, y: 10, width: 80, height: 10 },
  ])), 4);
});

test("an indented line adds one inward step", () => {
  const lines = [
    { x: 0, y: 0, width: 100, height: 10 },
    { x: 40, y: 10, width: 60, height: 10 },
  ];
  const [outline] = selectionOutlines(lines);
  assert.equal(outline.length, 6);
  assert.equal(concaveCount(outline), 1);
  assert.equal(arcCount(lineBoxesToPath(lines, { radius: 4 })), 6);
});

test("a line that is shorter on both sides has two inward steps", () => {
  const [outline] = selectionOutlines([
    { x: 0, y: 0, width: 100, height: 10 },
    { x: 20, y: 10, width: 40, height: 10 },
  ]);
  assert.equal(concaveCount(outline), 2);
});

test("a gap on one line stays two shapes", () => {
  const path = lineBoxesToPath([
    { x: 0, y: 0, width: 20, height: 10 },
    { x: 50, y: 0, width: 20, height: 10 },
  ]);
  assert.equal(path.match(/M /g)?.length, 2);
  assert.equal(arcCount(path), 8);
  assert.equal(path.includes(" 0 0 0 "), false);
});

test("lines that do not touch keep outer corners", () => {
  const path = lineBoxesToPath(
    [
      { x: 0, y: 0, width: 120, height: 16 },
      { x: 0, y: 40, width: 24, height: 16 },
    ],
    { radius: 4, maxGap: 8 },
  );
  assert.equal(path.match(/M /g)?.length, 2);
  assert.equal(arcCount(path), 8);
  assert.equal(path.includes(" 0 0 0 "), false);
});

test("lines that miss each other horizontally stay separate", () => {
  const path = lineBoxesToPath([
    { x: 40, y: 0, width: 80, height: 20 },
    { x: 0, y: 24, width: 12, height: 20 },
  ]);
  assert.equal(path.match(/M /g)?.length, 2);
  assert.equal(arcCount(path), 8);
  assert.equal(path.includes(" 0 0 0 "), false);
});

test("inner steps curve back into the highlight", () => {
  const path = lineBoxesToPath(
    [
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 40, y: 20, width: 60, height: 20 },
    ],
    { radius: 4 },
  );
  assert.match(path, / 0 0 0 /);
  assert.match(path, / 0 0 1 /);
});

test("a rectangle only rounds its outer corners", () => {
  const path = lineBoxesToPath([{ x: 10, y: 10, width: 80, height: 20 }], { radius: 4 });
  assert.equal(path.includes(" 0 0 0 "), false);
});

test("radius 0 keeps the sharp outline", () => {
  const path = lineBoxesToPath(
    [
      { x: 0, y: 0, width: 100, height: 10 },
      { x: 40, y: 10, width: 60, height: 10 },
    ],
    { radius: 0 },
  );
  assert.equal(arcCount(path), 0);
  assert.match(path, /Z$/);
});

function arcCount(path: string): number {
  return path.match(/A /g)?.length ?? 0;
}

function concaveCount(points: Point[]): number {
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i + points.length - 1) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const cross =
      (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    if (cross < 0) count += 1;
  }
  return count;
}
