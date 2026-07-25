import type { Config } from "tailwindcss";

// Dark-mode-first design tokens. The chart is the focus; the palette stays
// deep and neutral so the green/red trade signals and PnL zones pop.
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#08090c", // page background (behind dot grid)
          elevated: "#0f1116", // sheets, panels
          overlay: "#151821",
        },
        grid: "#1a1d26", // dot-grid dots
        up: {
          DEFAULT: "#16c784", // long / profit green
          soft: "rgba(22, 199, 132, 0.12)",
        },
        down: {
          DEFAULT: "#ea3943", // short / loss red
          soft: "rgba(234, 57, 67, 0.12)",
        },
        text: {
          DEFAULT: "#e8eaed",
          muted: "#8b90a0",
        },
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        snap: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
