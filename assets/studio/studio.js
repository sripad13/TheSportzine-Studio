(()=> {
  const init=()=>{
    const root=document.documentElement;
    if(!document.body) return;
    const links=[['Newsroom','/newsroom/'],['Share','/share/'],['Create','/create/'],['Optimize','/optimize/'],['Analyze','/analyze/'],['Audit','/audit/']];
    const routeForLocation=()=>{
      const hash=location.hash.replace(/^#\/?/,'');
      if(location.pathname==='/workspace/'&&hash) return ({live:'Newsroom',post:'Create',seo:'Optimize',audit:'Audit'})[hash]||'Newsroom';
      const path=location.pathname;
      return path.startsWith('/newsroom')?'Newsroom':path.startsWith('/share')?'Share':path.startsWith('/create')?'Create':path.startsWith('/optimize')?'Optimize':path.startsWith('/analyze')?'Analyze':path.startsWith('/audit')?'Audit':'';
    };
    const active=routeForLocation();
    const header=document.querySelector('.studio-global-header')||document.createElement('header');
    if(!header.isConnected){
      header.className='studio-global-header';
      header.innerHTML='<a class="studio-global-brand" href="/" aria-label="Studio home"><img class="studio-brand-mark" alt="" src="/brand/studio-mark-light.svg"><span class="studio-brand-word">Studio</span></a><button class="studio-menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">☰</button><nav class="studio-global-nav" aria-label="Primary navigation">'+links.map(([name,url])=>'<a href="'+url+'" '+(active===name?'aria-current="page"':'')+'>'+name+'</a>').join('')+'</nav><div class="studio-global-actions"><button class="studio-theme-toggle" type="button" aria-label="Change colour theme">Theme: System</button></div>';
      document.body.insertBefore(header,document.body.firstChild);
    }
    header.querySelector('.studio-menu-toggle')?.remove();
    header.querySelector('.studio-theme-toggle')?.remove();
    const nav=header.querySelector('.studio-global-nav');
    if(!nav) return;
    const navLinks=[...nav.querySelectorAll('a')];
    if(!navLinks.some(link=>link.textContent.trim()==='Analyze')){
      const analyzeLink=document.createElement('a');
      analyzeLink.href='/analyze/';
      analyzeLink.textContent='Analyze';
      const auditLink=navLinks.find(link=>link.textContent.trim()==='Audit');
      nav.insertBefore(analyzeLink,auditLink||null);
      navLinks.push(analyzeLink);
    }
    const syncActive=()=>{
      const current=routeForLocation();
      navLinks.forEach(link=>{
        if(link.textContent.trim()===current) link.setAttribute('aria-current','page');
        else link.removeAttribute('aria-current');
      });
    };
    syncActive();
    window.addEventListener('hashchange',syncActive);
    const actions=header.querySelector('.studio-global-actions');
    const contextActions=document.createElement('div');
    contextActions.className='studio-context-actions';
    const pageControls=document.getElementById('studio-page-controls');
    if(pageControls){
      const settings=pageControls.querySelector('#settingsMenu,.settings-menu');
      if(settings) actions?.appendChild(settings);
      [...pageControls.children].forEach(group=>{
        if(group===settings) return;
        if(group.matches('a,button')) contextActions.appendChild(group);
        else [...group.children].forEach(node=>contextActions.appendChild(node));
      });
      pageControls.remove();
    }
    const getChoice=()=>{try{return localStorage.getItem('studio-theme')||'system'}catch{return 'system'}};
    const setChoice=value=>{try{localStorage.setItem('studio-theme',value)}catch{}};
    const systemTheme=()=>window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
    const apply=choice=>{
      const safeChoice=['system','light','dark'].includes(choice)?choice:'system';
      const mode=safeChoice==='system'?systemTheme():safeChoice;
      root.setAttribute('data-studio-theme',mode);
      root.setAttribute('data-studio-theme-choice',safeChoice);
      const logo=header.querySelector('.studio-global-brand img');
      if(logo) logo.src=mode==='dark'?'/brand/studio-mark-dark.svg':'/brand/studio-mark-light.svg';
      const favicon=document.querySelector('link[rel~="icon"]');
      if(favicon) favicon.href=mode==='dark'?'/brand/studio-mark-dark.svg':'/brand/studio-mark-light.svg';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content',mode==='dark'?'#0B0B0D':'#F5F6F2');
    };
    apply(getChoice());
    if(contextActions.children.length) actions?.appendChild(contextActions);
    const settings=actions?.querySelector('.settings-menu');
    if(settings){
      settings.classList.add('studio-settings-menu');
      settings.style.position='relative';
      settings.style.top='auto';
      settings.style.right='auto';
    }
    // Mobile footer: theme switch plus settings. Header actions are hidden on phones, so these live at the bottom instead.
    const footer=document.createElement('footer');
    footer.className='studio-mobile-footer';
    footer.setAttribute('aria-label','Settings and theme');
    footer.innerHTML='<div class="studio-footer-row"><button class="studio-footer-theme" type="button"></button><div class="studio-footer-settings"></div></div>';
    document.body.appendChild(footer);
    const themeButton=footer.querySelector('.studio-footer-theme');
    const syncThemeButton=()=>{const mode=root.getAttribute('data-studio-theme')==='dark'?'dark':'light';const next=mode==='dark'?'light':'dark';themeButton.textContent=mode==='dark'?'Dark':'Light';themeButton.setAttribute('aria-label','Switch to '+next+' theme')};
    themeButton.addEventListener('click',()=>{const next=root.getAttribute('data-studio-theme')==='dark'?'light':'dark';setChoice(next);apply(next);syncThemeButton()});
    syncThemeButton();
    const mobileQuery=window.matchMedia?window.matchMedia('(max-width: 760px)'):null;
    const placeSettings=()=>{
      if(!settings) return;
      const target=mobileQuery&&mobileQuery.matches?footer.querySelector('.studio-footer-settings'):actions;
      if(target&&settings.parentElement!==target) target.appendChild(settings);
    };
    placeSettings();
    mobileQuery?.addEventListener?.('change',placeSettings);
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(getChoice()==='system') apply('system')});
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();