(()=>{
 const nav=document.querySelector('.studio-global-nav');
 const content=document.getElementById('workspace-content');
 if(!nav||!content)return;
 const workspaces={
  live:{label:'Newsroom',title:'Newsroom',description:'Your editorial monitoring workspace.',cards:[['Live stories','Live monitoring','A single place for the stories and developments you follow.'],['Sources','Source management','Review and organise the feeds that inform your coverage.'],['Signals','Emerging topics','Spot the stories that may need editorial attention.']]},
  post:{label:'Create',title:'Create',description:'Your content production workspace.',cards:[['Writing','Article editor','Draft and shape stories in your existing editorial workflow.'],['Graphics','Visual production','Prepare visual assets for your publishing channels.'],['Publishing','Distribution','Review content before it reaches your connected channels.']]},
  seo:{label:'Optimize',title:'Optimize',description:'Your search and answer visibility workspace.',cards:[['SEO','Search optimisation','Review on-page signals and content structure.'],['AEO','Answer optimisation','Make key information easier to understand and extract.'],['GEO','Generative visibility','Strengthen source clarity, entities and attribution.']]},
  audit:{label:'Audit',title:'Audit',description:'Your website diagnostics workspace.',cards:[['Crawler access','Technical visibility','Understand how crawlers can access public pages.'],['AEO readiness','Answer engine checks','Review the signals that support clear answers.'],['GEO signals','Generative search checks','Inspect source and entity signals across your site.']]}
 };
 const links=[...nav.querySelectorAll('a')];
 const routeByPath={'/live/':'live','/post/':'post','/seo/':'seo','/ai-audit/':'audit'};
 links.forEach(link=>{const key=routeByPath[new URL(link.href).pathname];if(key)link.dataset.workspace=key;link.href='#/'+(key||'live')});
 let active='live';
 function render(key){
  const page=workspaces[key]||workspaces.live;active=workspaces[key]?key:'live';
  document.getElementById('workspace-title').textContent=page.title;
  document.getElementById('workspace-description').textContent=page.description;
  content.innerHTML='<div class="workspace-grid">'+page.cards.map(card=>'<article class="workspace-card"><small>'+card[0]+'</small><strong>'+card[1]+'</strong><p>'+card[2]+'</p></article>').join('')+'</div><div class="workspace-note">You are viewing a shell prototype. The header stays mounted while this workspace region is replaced. The next phase will move the real page functionality into independently mountable modules.</div>';
  links.forEach(link=>{const selected=link.dataset.workspace===active;if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
  window.dispatchEvent(new Event('studio:navigation-change'));
  const navEl=document.querySelector('.studio-global-nav'),toggle=document.querySelector('.studio-menu-toggle');
  navEl.classList.remove('is-open');toggle?.setAttribute('aria-expanded','false');if(toggle)toggle.textContent='☰';
 }
 links.forEach(link=>{
  link.addEventListener('click',event=>{event.preventDefault();const key=link.dataset.workspace||'live';if(location.hash!=='#/'+key)location.hash='/'+key;else render(key)});
 });
 window.addEventListener('hashchange',()=>render(location.hash.replace(/^#\/?/,'')||'live'));
 
 render(location.hash.replace(/^#\/?/,'')||'live');
})();