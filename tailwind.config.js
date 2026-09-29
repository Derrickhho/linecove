import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./demo/index.html", "./demo/**/*.ts"],
  corePlugins: {
    preflight: false,
  },
  plugins: [tailwindcssAnimate],
};
