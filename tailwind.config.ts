import type { Config } from 'tailwindcss';

export default {
  content: [
    './entrypoints/**/*.{html,ts,tsx,css}',
    './src/**/*.{html,ts,tsx,css}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0f172a',
          darker: '#0b0f19',
          card: '#1e293b',
          border: 'rgba(255, 255, 255, 0.12)',
          primary: '#38bdf8',
          accent: '#3b82f6',
          emerald: '#22c55e',
          danger: '#ef4444',
          warning: '#f59e0b',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
