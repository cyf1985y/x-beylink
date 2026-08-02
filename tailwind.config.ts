import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arena: "#0b1026",
        "arena-deep": "#04060e",
        "arena-card": "#141a36",
        "arena-line": "#232b52",
        cyanx: "#38e0ff",
        violetx: "#7c5cff",
        bluex: "#5b8dff",
        gold: "#f5c542",
        silver: "#c0c8d8",
        bronze: "#cd8a4e",
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', "system-ui", "sans-serif"],
        num: ["Rajdhani", '"Noto Sans TC"', "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(56, 224, 255, 0.25)",
        "glow-strong":
          "0 0 40px rgba(56, 224, 255, 0.35), 0 0 12px rgba(124, 92, 255, 0.35)",
        "glow-gold": "0 0 24px rgba(245, 197, 66, 0.35)",
        "glow-win": "0 0 16px rgba(56, 224, 255, 0.5)",
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(135deg, #38e0ff 0%, #5b8dff 45%, #7c5cff 100%)",
        "card-sheen":
          "linear-gradient(160deg, rgba(56,224,255,0.08) 0%, rgba(20,26,54,0) 40%)",
        stripes:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.18) 0 6px, transparent 6px 12px)",
      },
      keyframes: {
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 18px rgba(56,224,255,0.25)" },
          "50%": { boxShadow: "0 0 34px rgba(56,224,255,0.55)" },
        },
        floaty: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        spinSlow: {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        slideStripes: {
          from: { backgroundPosition: "0 0" },
          to: { backgroundPosition: "34px 0" },
        },
      },
      animation: {
        "glow-pulse": "glowPulse 2.4s ease-in-out infinite",
        floaty: "floaty 3.5s ease-in-out infinite",
        "spin-slow": "spinSlow 14s linear infinite",
        stripes: "slideStripes 1.2s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
