import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge needs to know our token-named scales so that, for example,
 * `rounded-xl` passed by a caller correctly replaces a primitive's
 * `rounded-control` instead of leaving both classes to fight in the cascade.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'container', 'capsule'],
      shadow: ['hairline', 'highlight'],
      ease: ['out', 'in-out', 'sheet'],
    },
    classGroups: {
      duration: [{ duration: ['instant', 'fast', 'normal', 'slow', 'sheet'] }],
      z: [{ z: ['dropdown', 'sticky', 'modal-backdrop', 'modal', 'command-palette', 'toast'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
