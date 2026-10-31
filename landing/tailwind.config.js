/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07070a",
          900: "#0d0d11",
          850: "#121217",
          800: "#18181f",
          700: "#22222b",
          600: "#33333d",
          500: "#6a6a76",
          400: "#9a9aa6",
          300: "#c4c4cd",
          200: "#e2e2e8",
          100: "#f6f6f8",
        },
        blast: "#ff6a3d",
        ok: "#4ade80",
        warn: "#fbbf24",
        bad: "#f87171",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "Consolas", "monospace"],
      },
      maxWidth: { page: "1200px" },
    },
  },
  plugins: [],
};
