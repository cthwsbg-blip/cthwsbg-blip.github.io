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

/* Shared "返回目录" bar for tool pages. Skipped on the homepage; opt out with <html data-no-back>. */
(function(){
  function run(){
    var p=location.pathname,root=document.documentElement;
    if(p==='/'||p==='/index.html'||root.hasAttribute('data-no-back')||document.querySelector('.uma-nav'))return;
    var nav=document.createElement('nav');nav.className='uma-nav';nav.setAttribute('aria-label','站点导航');
    nav.innerHTML='<a class="uma-back" href="/"><span class="uma-back-arrow" aria-hidden="true">←</span>返回目录</a><span class="uma-nav-site">赛马娘工具箱 · 614tools</span>';
    document.body.insertBefore(nav,document.body.firstChild);root.classList.add('uma-has-nav');
  }
  if(document.body)run();else document.addEventListener('DOMContentLoaded',run);
})();
