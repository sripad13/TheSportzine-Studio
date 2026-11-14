(()=> {
  const init=()=>{
    const root=document.documentElement;
    if(!document.body) return;
    const links=[['Newsroom','/live/'],['Create','/post/'],['Optimize','/seo/'],['Audit','/ai-audit/']];
    const routeForLocation=()=>{
      const hash=location.hash.replace(/^#\\/?/,'');
      if(location.pathname==='/workspace/'&&hash) return ({live:'Newsroom',post:'Create',seo:'Optimize',audit:'Audit'})[hash]||'Newsroom';
      const path=location.pathname;
      return path.startsWith('/live')?'Newsroom':path.startsWith('/post')?'Create':path.startsWith('/seo')?'Optimize':path.startsWith('/ai-audit')?'Audit':'';
    };
    const active=routeForLocation();
    const header=document.querySelector('.studio-global-header')||document.createElement('header');
    if(!header.isConnected){
      header.className='studio-global-header';
      header.innerHTML='<a class="studio-global-brand" href="/" aria-label="Studio home"><img class="studio-brand-mark" alt="" src="/brand/studio-mark-light.svg"><span class="studio-brand-word">Studio</span></a><button class="studio-menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">☰</button><nav class="studio-global-nav" aria-label="Primary navigation">'+links.map(([name,url])=>'<a href="'+url+'" '+(active===name?'aria-current="page"':'')+'>'+name+'</a>').join('')+'</nav><div class="studio-global-actions"><button class="studio-theme-toggle" type="button" aria-label="Change colour theme">Theme: System</button></div>';
      document.body.insertBefore(header,document.body.firstChild);
    }
    const nav=header.querySelector('.studio-global-nav');
    if(!nav) return;
    const navLinks=[...nav.querySelectorAll('a')];
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
    const themeButton=header.querySelector('.studio-theme-toggle');
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
      if(themeButton){
        themeButton.textContent='Theme: '+safeChoice[0].toUpperCase()+safeChoice.slice(1);
        themeButton.setAttribute('aria-label','Colour theme: '+safeChoice+'. Activate to change theme.');
      }
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
    themeButton?.addEventListener('click',()=>{
      const order=['system','light','dark'];
      const current=getChoice();
      const next=order[(order.indexOf(current)+1)%order.length];
      setChoice(next);
      apply(next);
    });
    const menu=header.querySelector('.studio-menu-toggle');
    menu?.addEventListener('click',()=>{
      const open=nav.classList.toggle('is-open');
      menu.setAttribute('aria-expanded',String(open));
      menu.textContent=open?'×':'☰';
    });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(getChoice()==='system') apply('system')});
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();