import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0f",
        panel: "#13131c",
        edge: "#23232f",
        accent: "#7c5cff",
        accent2: "#22d3ee",
        good: "#34d399",
        warn: "#fbbf24",
        bad: "#f87171",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
