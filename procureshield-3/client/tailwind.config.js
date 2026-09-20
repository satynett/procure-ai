/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#0a1628",
          900: "#0f1f38",
          800: "#152a49",
          700: "#1c3860",
          600: "#254a7a",
        },
        brand: {
          50: "#eef4ff",
          100: "#dbe7fe",
          200: "#bdd4fe",
          300: "#8fb8fd",
          400: "#5a92fa",
          500: "#356af0",
          600: "#234ce0",
          700: "#1c3cc4",
          800: "#1c339e",
          900: "#1c307d",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(16, 24, 40, 0.06), 0 1px 3px 0 rgba(16, 24, 40, 0.08)",
      },
    },
  },
  plugins: [],
};
