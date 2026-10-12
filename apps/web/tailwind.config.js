/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        bg: { 0: v('bg-0'), 1: v('bg-1'), 2: v('bg-2'), 3: v('bg-3'), 4: v('bg-4') },
        ink: { 1: v('ink-1'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        volt: { DEFAULT: v('volt'), ink: v('volt-ink') },
        danger: v('danger'),
        warn: v('warn'),
        online: v('online'),
        live: v('live'),
        line: 'rgb(255 255 255 / 0.07)',
        'line-strong': 'rgb(255 255 255 / 0.12)',
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Unbounded', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { sm: '6px', DEFAULT: '8px', md: '10px', lg: '12px', xl: '16px', '2xl': '20px' },
      boxShadow: {
        pop: '0 16px 40px -12px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.08)',
        glow: '0 0 0 1px rgb(198 244 50 / 0.45), 0 0 24px -6px rgb(198 244 50 / 0.45)',
        inset: 'inset 0 1px 0 rgb(255 255 255 / 0.05)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.23, 1, 0.32, 1)', drawer: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      height: { dvh: '100dvh' },
    },
  },
  plugins: [],
};
