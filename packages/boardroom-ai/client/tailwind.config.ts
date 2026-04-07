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
      },
    },
  },
  plugins: [],
} satisfies Config;
