(()=> {
  const root=document.documentElement;
  if(document.querySelector('.studio-global-header')) return;
  const getChoice=()=>{try{return localStorage.getItem('studio-theme')||'system'}catch{return 'system'}};
  const setChoice=value=>{try{localStorage.setItem('studio-theme',value)}catch{}};
  const systemTheme=()=>window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
  const links=[['Newsroom','/live/'],['Create','/post/'],['Optimize','/seo/'],['Audit','/ai-audit/']];
  const path=location.pathname;
  const active=path.startsWith('/live')?'Newsroom':path.startsWith('/post')||path==='/graphics.html'?'Create':path.startsWith('/seo')?'Optimize':path.startsWith('/ai-audit')?'Audit':'';
  const header=document.createElement('header');
  header.className='studio-global-header';
  header.innerHTML='<a class="studio-global-brand" href="/" aria-label="Studio home"><img alt="Studio" src="/brand/studio-logo-light.svg"></a><button class="studio-menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">☰</button><nav class="studio-global-nav" aria-label="Primary navigation">'+links.map(([name,url])=>'<a href="'+url+'" '+(active===name?'aria-current="page"':'')+'>'+name+'</a>').join('')+'</nav><div class="studio-global-actions"><button class="studio-theme-toggle" type="button">Theme: System</button></div>';
  document.body.insertBefore(header,document.body.firstChild);
  const actions=header.querySelector('.studio-global-actions');
  const hiddenControls=document.createElement('div');
  hiddenControls.hidden=true;
  hiddenControls.id='studio-legacy-controls';
  document.body.appendChild(hiddenControls);
  const contextActions=document.createElement('div');
  contextActions.className='studio-context-actions';
  const themeButton=header.querySelector('.studio-theme-toggle');
  const apply=choice=>{
    const mode=choice==='system'?systemTheme():choice;
    root.dataset.studioTheme=mode;
    root.dataset.studioThemeChoice=choice;
    const logo=header.querySelector('.studio-global-brand img');
    logo.src=mode==='dark'?'/brand/studio-logo-dark.svg':'/brand/studio-logo-light.svg';
    themeButton.textContent='Theme: '+choice[0].toUpperCase()+choice.slice(1);
  };
  apply(getChoice());
  // Fold all legacy page mastheads into the shared Studio header.
  document.querySelectorAll('body > header:not(.studio-global-header), body > main header, body > div header, body header.top, body header.topbar').forEach(old=>{
    if(old===header||old.classList.contains('studio-global-header')) return;
    const settings=old.querySelector('#settingsMenu,.settings-menu');
    if(settings) actions.appendChild(settings);
    const actionGroups=old.querySelectorAll('.top-actions,.actions,.topright');
    actionGroups.forEach(group=>{
      [...group.children].forEach(node=>{
        if(node.matches('.backlink')) return;
        if(node===settings) return;
        contextActions.appendChild(node);
      });
    });
    const hiddenCreate=old.querySelector('#createBtn');
    if(hiddenCreate) hiddenControls.appendChild(hiddenCreate);
    old.querySelectorAll('#headerBrand').forEach(node=>node.remove());
    old.remove();
  });
  if(contextActions.children.length) actions.appendChild(contextActions);
  const settings=actions.querySelector('.settings-menu');
  if(settings){
    settings.classList.add('studio-settings-menu');
    settings.style.position='relative';
    settings.style.top='auto';
    settings.style.right='auto';
  }
  themeButton.addEventListener('click',()=>{
    const order=['system','light','dark'];
    const next=order[(order.indexOf(root.dataset.studioThemeChoice)+1)%order.length];
    setChoice(next);apply(next);
  });
  const menu=header.querySelector('.studio-menu-toggle');
  menu.addEventListener('click',()=>{
    const nav=header.querySelector('.studio-global-nav');
    const open=nav.classList.toggle('is-open');
    menu.setAttribute('aria-expanded',String(open));
    menu.textContent=open?'×':'☰';
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{
    if(getChoice()==='system') apply('system');
  });
})();