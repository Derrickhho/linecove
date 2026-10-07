# linecove

Multi-line text highlights with outer corners and inward steps. The fill defaults to the system text selection color.

The browser selection stays in place, so copy and paste still work. Inside the attached element, the native highlight paint is hidden and this library draws the rounded shape instead.

## Install

```sh
npm install linecove
```

The package is ESM and includes TypeScript types. It has no runtime dependencies.

## Use

```ts
import { attachLiveSelection } from "linecove";

const article = document.querySelector("article");
if (!article) throw new Error("Missing article");

const highlight = attachLiveSelection(article, {
  radius: 6,
  paddingInline: 1,
});
```

`attachLiveSelection` watches the document selection and paints every range that touches `article`. Call `destroy()` when the element goes away.

```ts
highlight.setStyle({ radius: 8, color: "#cce4ff" });
highlight.refresh();
highlight.destroy();
```

## Options

| Option | Default | |
| --- | --- | --- |
| `radius` | `4` | Corner radius in px. `0` keeps square corners. |
| `color` | system selection | Fill. Defaults to the CSS system color `Highlight`, the color the browser uses for selected text. |
| `paddingInline` | `0` | Extra space on the left and right of each line, in px. |
| `maxGap` | tallest line | Lines whose vertical gap is larger than this stay separate. Paragraph gaps stay open. |
| `epsilon` | `0.5` | Edges closer than this are treated as flush. |

## How the shape is drawn

Each selected line becomes a box as tall as the element's computed line height. Lines that touch join into one outline:

- A corner rounds outward where a line sticks out past its neighbor.
- A corner rounds inward where a line is inset.
- Flush edges stay straight.
- Lines that do not touch, because of a large vertical gap or no horizontal overlap, stay separate shapes with ordinary outer corners.

The shape is painted underneath the text, on top of any background the element already has. `destroy()` removes it.

## Lower-level helpers

`lineBoxesToPath` turns line boxes into one SVG path string. `selectionOutlines` returns the sharp polygons before rounding. Both use the same join rules as the live highlight.

```ts
import { lineBoxesToPath } from "linecove";

const d = lineBoxesToPath(
  [
    { x: 0, y: 0, width: 120, height: 20 },
    { x: 16, y: 20, width: 80, height: 20 },
  ],
  { radius: 6 },
);
```

## Demo

The live demo is at [linecove.vercel.app](https://linecove.vercel.app).

```sh
npm install
npm run demo
```

Opens the demo locally at `http://localhost:5173`.

## Develop

```sh
npm test
npm run build
```

`npm test` typechecks and runs the geometry tests. `npm run build` emits `dist/`, which is the only directory published to npm.

## License

[MIT](LICENSE)
