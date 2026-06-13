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
        ink: "#0a0a13",
        panel: "#131a2f",
        edge: "#1e2745",
        accent: "#048b7b",
        accent2: "#6bf1cb",
        accent3: "#5fa6ed",
        glow: "#f3ac67",
        fifa: "#203053",
        lavender: "#cba2ca",
        highlight: "#6662a7",
        good: "#6bf1cb",
        warn: "#f3ac67",
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
