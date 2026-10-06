/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  'var(--brand-50, #f0f7ff)',
          100: 'var(--brand-100, #e0effe)',
          200: 'var(--brand-200, #bae0fd)',
          300: 'var(--brand-300, #7cc8fb)',
          400: 'var(--brand-400, #36aaf6)',
          500: 'var(--brand-500, #0c8ee7)',
          600: 'var(--brand-600, #006fc5)',
          700: 'var(--brand-700, #0058a0)',
          800: 'var(--brand-800, #004b84)',
          900: 'var(--brand-900, #003f6e)',
          950: 'var(--brand-950, #00284a)',
        },
        surface: '#f8fafc',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
