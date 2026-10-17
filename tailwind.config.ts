import type { Config } from 'tailwindcss';

/**
 * Palette source of truth lives in `src/styles/tailwind.css` (`@theme`), which
 * Tailwind v4 reads directly. This config is kept in sync for tooling that
 * still resolves `tailwind.config.ts`.
 */
export default {
  content: [
    './entrypoints/**/*.{html,ts,tsx,css}',
    './src/**/*.{html,ts,tsx,css}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0a0d16',
          surface: '#11141f',
          'surface-2': '#161a27',
          elevated: '#1b2030',
          text: '#e8eaf3',
          muted: '#99a1b8',
          faint: '#7c849e',
          blue: '#5b8def',
          violet: '#a78bfa',
          mint: '#5eead4',
          accent: '#3f63da',
          'accent-hover': '#3557c6',
          'accent-soft': '#a9c1f8',
          ring: '#7ca5f7',
          danger: '#e0576b',
          'danger-soft': '#f2a0aa',
          warning: '#e5a94a',
          'warning-soft': '#f0c680',
          success: '#34d399',
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
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
