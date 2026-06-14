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
        bg: "#07090e",
        surface: "#0d1117",
        edge: "rgba(255,255,255,0.07)",
        accent: "#34d399", // emerald — brand / earned authority
        secondary: "#6b93f5", // slate-blue — Chainlink verification
        fail: "#fb7185", // rose — denied / breached
        muted: "rgba(244,246,250,0.62)",
        faint: "rgba(244,246,250,0.4)",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      maxWidth: {
        narrative: "60rem",
      },
    },
  },
  plugins: [],
};

export default config;
