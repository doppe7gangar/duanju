// Applies the saved 白天 / 深夜 theme before first paint (loaded synchronously in <head>).
try { document.documentElement.dataset.theme = localStorage.getItem('guoju:theme') === 'light' ? 'light' : 'dark'; } catch (_) { document.documentElement.dataset.theme = 'dark'; }
