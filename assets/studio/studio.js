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
  const nav=header.querySelector('.studio-global-nav');
  const indicator=document.createElement('span');
  indicator.className='studio-nav-indicator';
  indicator.setAttribute('aria-hidden','true');
  nav.prepend(indicator);
  const moveIndicator=target=>{
    if(!target) return;
    const navRect=nav.getBoundingClientRect();
    const itemRect=target.getBoundingClientRect();
    indicator.style.width=itemRect.width+'px';
    indicator.style.transform='translate3d('+(itemRect.left-navRect.left-nav.clientLeft)+'px,0,0)';
    indicator.style.opacity='1';
  };
  const activeLink=nav.querySelector('a[aria-current="page"]');
  const linksInNav=[...nav.querySelectorAll('a')];
  linksInNav.forEach(link=>{
    link.addEventListener('pointerenter',()=>moveIndicator(link));
    link.addEventListener('focus',()=>moveIndicator(link));
    link.addEventListener('click',()=>moveIndicator(link));
  });
  nav.addEventListener('pointerleave',()=>moveIndicator(activeLink));
  nav.addEventListener('focusout',event=>{
    if(!nav.contains(event.relatedTarget)) moveIndicator(activeLink);
  });
  const positionIndicator=()=>moveIndicator(nav.querySelector('a:hover, a:focus-visible')||activeLink);
  requestAnimationFrame(positionIndicator);
  window.addEventListener('resize',positionIndicator,{passive:true});
  const actions=header.querySelector('.studio-global-actions');
  const contextActions=document.createElement('div');
  contextActions.className='studio-context-actions';
  const pageControls=document.getElementById('studio-page-controls');
  if(pageControls){
    const settings=pageControls.querySelector('#settingsMenu,.settings-menu');
    if(settings) actions.appendChild(settings);
    [...pageControls.children].forEach(group=>{
      if(group===settings) return;
      if(group.matches('a,button')) contextActions.appendChild(group);
      else [...group.children].forEach(node=>contextActions.appendChild(node));
    });
    pageControls.remove();
  }
  const themeButton=header.querySelector('.studio-theme-toggle');
  const apply=choice=>{
    const mode=choice==='system'?systemTheme():choice;
    root.dataset.studioTheme=mode;
    root.dataset.studioThemeChoice=choice;
    const logo=header.querySelector('.studio-global-brand img');
    logo.src=mode==='dark'?'/brand/studio-logo-dark.svg':'/brand/studio-logo-light.svg';
    const favicon=document.querySelector('link[rel~="icon"]');
    if(favicon) favicon.href=mode==='dark'?'/brand/studio-mark-dark.svg':'/brand/studio-mark-light.svg';
    themeButton.textContent='Theme: '+choice[0].toUpperCase()+choice.slice(1);
  };
  apply(getChoice());
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