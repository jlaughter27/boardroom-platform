import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        persona: {
          optimist: '#22c55e',
          critic: '#ef4444',
          alternate: '#a855f7',
          technician: '#3b82f6',
          questionnaire: '#eab308',
          doer: '#f97316',
          ceo: '#06b6d4',
        },
        status: {
          active: '#22c55e',
          pending: '#eab308',
          done: '#3b82f6',
          overdue: '#ef4444',
          draft: '#6b7280',
          archived: '#4b5563',
        },
        bg: {
          base: 'var(--color-bg-base)',
          surface: 'var(--color-bg-surface)',
          elevated: 'var(--color-bg-elevated)',
          hover: 'var(--color-bg-hover)',
          active: 'var(--color-bg-active)',
        },
        line: {
          subtle: 'var(--color-border-subtle)',
          DEFAULT: 'var(--color-border-default)',
          strong: 'var(--color-border-strong)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--color-accent-primary)',
          hover: 'var(--color-accent-primary-hover)',
          muted: 'var(--color-accent-primary-muted)',
          secondary: 'var(--color-accent-secondary)',
        },
        success: { DEFAULT: 'var(--color-success)', muted: 'var(--color-success-muted)' },
        warning: { DEFAULT: 'var(--color-warning)', muted: 'var(--color-warning-muted)' },
        danger: { DEFAULT: 'var(--color-danger)', muted: 'var(--color-danger-muted)' },
        info: { DEFAULT: 'var(--color-info)', muted: 'var(--color-info-muted)' },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
        display: ['var(--font-display)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        glow: 'var(--shadow-glow)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
    },
  },
  plugins: [],
} satisfies Config;
