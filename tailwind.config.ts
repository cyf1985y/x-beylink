import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arena: "#0b1026",
        "arena-card": "#141a36",
        "arena-line": "#232b52",
        cyanx: "#38e0ff",
        violetx: "#7c5cff",
        gold: "#f5c542",
        silver: "#c0c8d8",
        bronze: "#cd8a4e",
      },
      boxShadow: {
        glow: "0 0 24px rgba(56, 224, 255, 0.25)",
      },
    },
  },
  plugins: [],
};
export default config;
