// Pre-paint theme bootstrap. Lives in its own file because the production
// server ships helmet's default CSP (script-src 'self'), which blocks inline
// scripts — the 2026-10-20 browser e2e caught the inline version being
// refused, which meant a flash of the wrong theme on every production load.
    (function(){
      var t = localStorage.getItem('theme');
      if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches))
        document.documentElement.classList.add('dark');
    })();
