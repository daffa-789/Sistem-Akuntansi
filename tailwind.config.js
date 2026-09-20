/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: { brand: { 50: '#eefbf3', 100: '#d7f6e3', 500: '#168b55', 600: '#0e7145', 700: '#0b5a39' } },
      boxShadow: { card: '0 12px 35px rgba(15, 23, 42, .07)' }
    }
  },
  plugins: []
}
