/* Renders the author badge(s) from /assets/author.json. Markup already contains fallback values. */
(function(){
  var SIZE='@128w_128h_1c.webp';
  function faceSrc(u){u=String(u||'').replace(/^http:\/\//,'https://').replace(/^\/\//,'https://');return /^https:\/\/[a-z0-9.-]*hdslb\.com\//.test(u)?u.split('@')[0]+SIZE:''}
  function apply(d){
    if(!d||typeof d!=='object')return;
    var nodes=document.querySelectorAll('[data-bili-badge]');
    for(var i=0;i<nodes.length;i++){
      var a=nodes[i],img=a.querySelector('img'),name=a.querySelector('[data-bili-name]'),src=faceSrc(d.face);
      if(typeof d.url==='string'&&/^https:\/\/space\.bilibili\.com\//.test(d.url))a.href=d.url;
      if(typeof d.name==='string'&&d.name){if(name)name.textContent=d.name;a.setAttribute('aria-label','有问题联系 '+d.name+' 的 B 站主页');if(img)img.alt=d.name}
      if(img&&src&&img.getAttribute('src')!==src)img.src=src;
    }
  }
  function run(){try{fetch('/assets/author.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null}).then(apply).catch(function(){})}catch(e){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();

/* Shared "返回目录" button for tool pages: placed in the header row right after the title.
   Skipped on the homepage; opt out with <html data-no-back>. Falls back to a thin top bar if no header title is found. */
(function(){
  var slot=null,row=null;
  function link(){var a=document.createElement('a');a.className='uma-back';a.href='/';a.innerHTML='<span class="uma-back-arrow" aria-hidden="true">←</span>返回目录';return a}
  var EXTRA=38;
  function hit(a,b,m){return a.left<b.right+m&&a.right+m>b.left&&a.top<b.bottom&&a.bottom>b.top}
  function layout(){
    if(!slot||!row||slot.className.indexOf('uma-back-slot')<0)return;
    var anchor=slot.previousElementSibling,h1=row.querySelector('h1');
    row.classList.remove('uma-back-stacked');row.style.paddingBottom='';slot.style.left='';slot.style.bottom='';
    // baseline without the button, then with it inline
    slot.style.display='none';var aH=anchor?anchor.getBoundingClientRect().height:0,rH=row.getBoundingClientRect().height;slot.style.display='';
    var s=slot.getBoundingClientRect(),bad=(anchor&&anchor.getBoundingClientRect().height>aH+1)||row.getBoundingClientRect().height>rH+1||row.scrollWidth>row.clientWidth+1;
    var badges=document.querySelectorAll('[data-bili-badge],header button');for(var i=0;i<badges.length&&!bad;i++){if(!slot.contains(badges[i])&&hit(s,badges[i].getBoundingClientRect(),10))bad=true}
    if(!bad)return;
    row.classList.add('uma-back-stacked');
    var rr=row.getBoundingClientRect(),pb=parseFloat(getComputedStyle(row).paddingBottom)||0;
    row.style.paddingBottom=(pb+EXTRA)+'px';slot.style.bottom=Math.max(8,pb-4)+'px';
    slot.style.left=Math.round((h1?h1.getBoundingClientRect().left:rr.left)-rr.left)+'px';
  }
  var raf=0;function indent(){if(raf)return;raf=requestAnimationFrame(function(){raf=0;layout()})}
  function place(allowFallback){
    var p=location.pathname,root=document.documentElement;
    if(p==='/'||p==='/index.html'||root.hasAttribute('data-no-back'))return;
    if(slot&&document.contains(slot)&&!(slot.className==='uma-nav'&&document.querySelector('header h1')))return;
    if(slot&&slot.className==='uma-nav'){slot.remove();root.classList.remove('uma-has-nav');slot=null}
    var h1=document.querySelector('header h1');row=null;
    if(h1){for(var e=h1.parentElement;e&&e.tagName!=='HEADER'.toUpperCase()&&e!==document.body;e=e.parentElement){if(getComputedStyle(e).display.indexOf('flex')>=0){row=e;break}}if(!row){var hd=h1.closest('header');if(hd&&getComputedStyle(hd).display.indexOf('flex')>=0)row=hd}}
    if(row){
      var anchor=h1;while(anchor.parentElement!==row)anchor=anchor.parentElement;
      slot=document.createElement('span');slot.className='uma-back-slot';slot.appendChild(link());
      row.insertBefore(slot,anchor.nextSibling);row.classList.add('uma-back-row');layout();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(indent);
    }else if(allowFallback&&!document.querySelector('.uma-nav')){
      var nav=document.createElement('nav');nav.className='uma-nav';nav.setAttribute('aria-label','站点导航');nav.appendChild(link());
      document.body.insertBefore(nav,document.body.firstChild);root.classList.add('uma-has-nav');slot=nav;
    }
  }
  function run(){place(false);window.addEventListener('load',function(){setTimeout(function(){place(true)},1500)});window.addEventListener('resize',indent);
    // React-rendered headers (e.g. /skill/) may render after this script or remount; re-place if needed.
    try{new MutationObserver(function(){if(!slot||!document.contains(slot))place()}).observe(document.body,{childList:true,subtree:true})}catch(e){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
