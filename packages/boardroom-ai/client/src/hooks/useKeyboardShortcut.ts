import { useEffect } from 'react';

export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  options: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const metaMatch = options.meta ? e.metaKey : true;
      const ctrlMatch = options.ctrl ? e.ctrlKey : true;
      const shiftMatch = options.shift ? e.shiftKey : !e.shiftKey;

      if (e.key.toLowerCase() === key.toLowerCase() && metaMatch && ctrlMatch && shiftMatch) {
        e.preventDefault();
        callback();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [key, callback, options.meta, options.ctrl, options.shift]);
}
