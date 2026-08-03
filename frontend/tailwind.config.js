/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Speed Skating Sask brand green (from logo)
        brand: {
          50:  "#eef7f1",
          100: "#d0ecd8",
          200: "#a3d9b2",
          300: "#6abf85",
          400: "#3aa35d",
          500: "#228744",
          600: "#1c6e36",
          700: "#1c5e2a",
          800: "#164d22",
          900: "#0f3518",
        },
      },
    },
  },
  plugins: [],
}

