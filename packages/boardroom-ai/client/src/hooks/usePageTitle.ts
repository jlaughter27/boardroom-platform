import { useEffect } from 'react';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — BoardRoom AI`;
    return () => { document.title = 'BoardRoom AI'; };
  }, [title]);
}
