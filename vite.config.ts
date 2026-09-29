import githubLight from "@shikijs/themes/github-light-default";
import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import { rehypePrettyCode } from "rehype-pretty-code";
import { defineConfig, type Plugin } from "vite";

const BLACK = "#1a1a1a";
const GRAY = "#737373";

function toMono(color: string): string {
  const hex = color.slice(1, 7);
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return saturation < 0.15 && lightness < 0.35 ? BLACK : GRAY;
}

function monoTheme() {
  const theme = structuredClone(githubLight);
  theme.name = "linecove-mono";
  theme.displayName = "Linecove Mono";
  theme.colors["editor.foreground"] = BLACK;
  for (const token of theme.tokenColors) {
    if (!token.settings) continue;
    if (token.settings.foreground) token.settings.foreground = toMono(token.settings.foreground);
    delete token.settings.background;
  }
  return theme;
}

function prettyCode(): Plugin {
  return {
    name: "rehype-pretty-code",
    async transformIndexHtml(html) {
      const file = await unified()
        .use(rehypeParse)
        .use(rehypePrettyCode, {
          theme: monoTheme(),
          keepBackground: false,
        })
        .use(rehypeStringify)
        .process(html);
      return String(file);
    },
  };
}

export default defineConfig({
  root: "demo",
  plugins: [prettyCode()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
