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
        mist: "#d4d0c8"
      },
      backgroundImage: {
        "hero-radial":
          "radial-gradient(circle at top, rgba(212, 177, 106, 0.15), transparent 35%), radial-gradient(circle at bottom, rgba(20, 48, 79, 0.65), rgba(8, 17, 31, 1))"
      },
      fontFamily: {
        display: ["Georgia", "serif"],
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
