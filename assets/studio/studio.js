/* Shared Studio shell: one header for every page, built from the single LINKS list below. */

/* Loading indicator. Defined as soon as this script runs, so page scripts can use it straight away. */
window.StudioWave = {
  markup(label = 'Loading data', compact = false) {
    const safe = String(label).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return '<span class="studio-wave' + (compact ? ' studio-wave--compact' : '') + '" role="status" aria-label="' + safe + '"><span></span><span></span><span></span><span></span><span></span></span>';
  },
  show(target, label = 'Loading data', compact = false) {
    const node = typeof target === 'string' ? document.querySelector(target) : target;
    if (node) node.innerHTML = this.markup(label, compact);
  }
};

(() => {
  const LINKS = [['Newsroom', '/newsroom/'], ['Share', '/share/'], ['Create', '/create/'], ['Optimize', '/optimize/'], ['Audit', '/audit/']];
  const THEMES = ['system', 'light', 'dark'];
  const root = document.documentElement;

  const getChoice = () => { try { const v = localStorage.getItem('studio-theme'); return THEMES.includes(v) ? v : 'system'; } catch { return 'system'; } };
  const setChoice = value => { try { localStorage.setItem('studio-theme', value); } catch {} };
  const systemTheme = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  function applyTheme(choice) {
    const mode = choice === 'system' ? systemTheme() : choice;
    const mark = mode === 'dark' ? '/brand/studio-mark-dark.svg' : '/brand/studio-mark-light.svg';
    root.setAttribute('data-studio-theme', mode);
    root.setAttribute('data-studio-theme-choice', choice);
    document.querySelector('.studio-global-brand img')?.setAttribute('src', mark);
    document.querySelector('link[rel~="icon"]')?.setAttribute('href', mark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0B0B0D' : '#F5F6F2');
    const button = document.querySelector('.studio-theme-toggle');
    if (button) {
      button.textContent = choice[0].toUpperCase() + choice.slice(1);
      button.setAttribute('aria-label', 'Colour theme: ' + choice + '. Change theme');
    }
  }

  function init() {
    // The demo page keeps its own in-page header; every other page gets the shared one.
    let header = document.querySelector('.studio-global-header');
    if (!header) {
      const path = location.pathname;
      header = document.createElement('header');
      header.className = 'studio-global-header';
      header.innerHTML = '<a class="studio-global-brand" href="/" aria-label="Studio home"><img class="studio-brand-mark" alt="" src="/brand/studio-mark-light.svg"><span class="studio-brand-word">Studio</span></a>'
        + '<nav class="studio-global-nav" aria-label="Primary navigation">'
        + LINKS.map(([name, url]) => '<a href="' + url + '"' + (path.startsWith(url.slice(0, -1)) ? ' aria-current="page"' : '') + '>' + name + '</a>').join('')
        + '</nav><div class="studio-global-actions"></div>';
      document.body.insertBefore(header, document.body.firstChild);
    }
    const actions = header.querySelector('.studio-global-actions');

    // Page-specific controls (#studio-page-controls) move into the header: the settings menu next to the theme button, the rest in their own group.
    const pageControls = document.getElementById('studio-page-controls');
    if (pageControls && actions) {
      const settings = pageControls.querySelector('.settings-menu');
      const context = document.createElement('div');
      context.className = 'studio-context-actions';
      [...pageControls.children].forEach(group => {
        if (group === settings) return;
        if (group.matches('a,button')) context.appendChild(group);
        else [...group.children].forEach(node => context.appendChild(node));
      });
      if (context.children.length) actions.appendChild(context);
      if (settings) { settings.classList.add('studio-settings-menu'); actions.appendChild(settings); }
      pageControls.remove();
    }

    if (actions) {
      const theme = document.createElement('button');
      theme.type = 'button';
      theme.className = 'studio-theme-toggle';
      theme.addEventListener('click', () => {
        const next = THEMES[(THEMES.indexOf(getChoice()) + 1) % THEMES.length];
        setChoice(next);
        applyTheme(next);
      });
      actions.appendChild(theme);
    }
    applyTheme(getChoice());
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getChoice() === 'system') applyTheme('system'); });
  }

  applyTheme(getChoice());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
