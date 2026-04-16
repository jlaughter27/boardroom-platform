// BoardRoom AI brand mark. Three variants:
//   - icon:     just the hexagonal C network glyph (scales from 16px to 128px)
//   - wordmark: icon + "BoardRoom AI" typography (use in headers / login)
//   - full:     hero PNG with texture (use on marketing / login hero panel)
//
// The icon variant is a pure SVG that inherits currentColor, so it picks up
// sidebar active states, hover styles, etc. The other variants use the PNGs
// in public/logo/ and will fall back to CSS-only rendering if the assets
// fail to load.

import type { CSSProperties } from 'react';
import { cn } from '../../lib/cn';

export interface LogoProps {
  variant?: 'icon' | 'wordmark' | 'full';
  /** Icon size in pixels. Ignored for wordmark/full. */
  size?: number;
  /** Override the icon color (CSS color). Defaults to `hsl(var(--primary))`. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function Logo({
  variant = 'icon',
  size = 32,
  color,
  className,
  style,
}: LogoProps): JSX.Element {
  if (variant === 'icon') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('shrink-0', className)}
        style={color ? { color, ...style } : style}
        aria-label="BoardRoom AI"
        role="img"
      >
        {/* Hexagon */}
        <path d="M32 4 L56 18 V46 L32 60 L8 46 V18 Z" strokeWidth={3} />
        {/* C arc */}
        <path d="M41 22 A13 13 0 1 0 41 42" strokeWidth={3} />
        {/* Connecting lines */}
        <line x1={22} y1={22} x2={31} y2={17} strokeWidth={2} />
        <line x1={31} y1={17} x2={41} y2={22} strokeWidth={2} />
        <line x1={22} y1={42} x2={31} y2={47} strokeWidth={2} />
        <line x1={31} y1={47} x2={41} y2={42} strokeWidth={2} />
        {/* Filled nodes */}
        <circle cx={22} cy={22} r={2.8} fill="currentColor" stroke="none" />
        <circle cx={31} cy={17} r={2.8} fill="currentColor" stroke="none" />
        <circle cx={41} cy={22} r={2.8} fill="currentColor" stroke="none" />
        <circle cx={22} cy={42} r={2.8} fill="currentColor" stroke="none" />
        <circle cx={31} cy={47} r={2.8} fill="currentColor" stroke="none" />
        <circle cx={41} cy={42} r={2.8} fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (variant === 'wordmark') {
    return (
      <div
        className={cn('flex items-center gap-2.5', className)}
        style={style}
      >
        <Logo variant="icon" size={size} color={color} />
        <span
          className="text-xl font-display font-semibold tracking-tight"
          style={color ? { color } : undefined}
        >
          BoardRoom AI
        </span>
      </div>
    );
  }

  // Full hero — PNG with the atmospheric texture
  return (
    <picture className={cn('block', className)} style={style}>
      <source srcSet="/logo/wordmark-dark.png" media="(prefers-color-scheme: dark)" />
      <img
        src="/logo/wordmark-light.png"
        alt="BoardRoom AI"
        className="w-full h-auto"
        loading="eager"
        decoding="async"
      />
    </picture>
  );
}
