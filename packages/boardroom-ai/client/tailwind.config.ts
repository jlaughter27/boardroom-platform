import type { Config } from 'tailwindcss';
import path from 'path';
import { fileURLToPath } from 'url';

// Anchor content paths to this config file so Tailwind finds the source
// files regardless of the CWD vite was launched from. Without this,
// `./src/**/*` is resolved from whatever pnpm's CWD is (usually the
// package root, not client/) and Tailwind fails with "No utility
// classes were detected".
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  darkMode: 'class',
  content: [
    path.resolve(__dirname, 'src/**/*.{ts,tsx}'),
    path.resolve(__dirname, 'index.html'),
  ],
  theme: {
    extend: {
      colors: {
        // ── New shadcn-compatible token system ──
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        card: {
          DEFAULT: 'var(--color-card)',
          foreground: 'var(--color-card-foreground)',
        },
        muted: {
          DEFAULT: 'var(--color-muted)',
          foreground: 'var(--color-muted-foreground)',
        },
        primary: {
          DEFAULT: 'var(--color-primary)',
          foreground: 'var(--color-primary-foreground)',
          text: 'var(--color-primary-text)',
          warm: 'var(--color-primary-warm)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          foreground: 'var(--color-accent-foreground)',
        },
        border: 'var(--color-border)',
        ring: 'var(--color-ring)',
        destructive: {
          DEFAULT: 'var(--color-destructive)',
          foreground: 'var(--color-destructive-foreground)',
        },

        // Sidebar — intentionally dark regardless of theme. See
        // client/src/styles/tokens.css for the rationale.
        sidebar: {
          DEFAULT: 'var(--color-sidebar-bg)',
          border: 'var(--color-sidebar-border)',
          foreground: 'var(--color-sidebar-foreground)',
          'foreground-muted': 'var(--color-sidebar-foreground-muted)',
        },

        // ── Semantic colors ──
        success: { DEFAULT: 'var(--color-success)', muted: 'var(--color-success-muted)' },
        warning: { DEFAULT: 'var(--color-warning)', muted: 'var(--color-warning-muted)' },
        danger: { DEFAULT: 'var(--color-danger)', muted: 'var(--color-danger-muted)' },
        info: { DEFAULT: 'var(--color-info)', muted: 'var(--color-info-muted)' },

        // ── Persona colors (hardcoded — Phase 5 will add CSS var indirection) ──
        persona: {
          optimist: '#22c55e',
          critic: '#ef4444',
          alternate: '#a855f7',
          technician: '#3b82f6',
          questionnaire: '#eab308',
          doer: '#f97316',
          ceo: '#06b6d4',
        },

        // ── Status colors (hardcoded, work for both modes) ──
        status: {
          active: '#22c55e',
          pending: '#eab308',
          done: '#3b82f6',
          overdue: '#ef4444',
          draft: '#6b7280',
          archived: '#4b5563',
        },
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
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      animation: {
        'pulse-live': 'pulse-live 1.5s ease-in-out infinite',
        'fade-in': 'fade-in 300ms ease-out',
      },
      keyframes: {
        'pulse-live': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
