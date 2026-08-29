import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#08111f",
        gold: "#d4b16a",
        sea: "#14304f",
        dusk: "#0d1626",
        mist: "#d4d0c8"
      },
      backgroundImage: {
        "hero-radial":
          "radial-gradient(circle at 50% 8%, rgba(212, 177, 106, 0.12), transparent 42%), radial-gradient(circle at 50% 46%, #2a4363 0%, #1c2f4c 44%, #13233a 70%, #0d1626 100%)"
      },
      fontFamily: {
        display: ["Georgia", "serif"],
        serifDisplay: ["var(--font-instrument-serif)", "Georgia", "serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "Menlo", "monospace"],
        body: ["ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glow: "0 0 80px rgba(212, 177, 106, 0.15)"
      }
    }
  },
  plugins: []
};

export default config;
