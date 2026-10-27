(() => {
  'use strict';
  const catalog = window.RECOMMENDED_CATALOG;
  const $ = s => document.querySelector(s);
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const styleName = {'逃':'領頭','大逃':'大逃','先':'前列','差':'居中','追':'後追'};
  const initial = catalog.jobs.find(j => j.id === new URL(location.href).searchParams.get('job'));
  const state = {event:initial?.event || 'june',style:'全部',query:'',selected:initial?.id || 'june-01'};
  const image = card => window.__AV[String(card.card_id)] || '';
  const cleanQuery = s => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
  function matches() {
    const q=cleanQuery(state.query);
    return catalog.jobs.filter(j => j.event===state.event && (state.style==='全部'||j.racer.style===state.style) && (!q||cleanQuery([j.racer.name,j.racer.ja,j.racer.costume_ja,...(j.racer.search_names||[]),j.racer.card_id,catalog.nameAliases[String(j.racer.character_id)]].join(' ')).includes(q)));
  }
  function node(card, job, allowConflict=true) {
    const conflict=allowConflict && card.card_id===job.racer.card_id;
    const alternate=allowConflict && card.character_id===job.racer.character_id && !conflict;
    const skill=card.inherit_skill_ja || catalog.skillNames[String(card.card_id)];
    const factors=card.factors;

    const badges=factors?`<div class="factor-stack"><span class="factor red">${escape(factors.red.name)} <b>★★★</b></span></div>`:'';
    return `<div class="node${conflict?' conflict':''}" data-card="${card.card_id}">${['bwiki-loh','note-loh'].includes(job.data_source) && card.statistics?`<span class="role-label">使用率 ${(100*card.statistics.costume_count/card.statistics.costume_sample).toFixed(1)}%</span>`:card.role?`<span class="role-label ${card.is_acceleration?'accel':''}">${escape(card.role)}</span>`:''}<img src="${image(card)}" alt="${escape(card.name)}"><b>${escape(card.name)}</b><div class="costume">${escape(card.costume_name || card.costume_ja)}</div>${skill?`<span class="skill">繼承固有 · ${escape(skill)}</span>`:''}${badges}${alternate?'<span class="alternate-note">同角色異衣裝 · 僅放祖輩</span>':''}${conflict?'<span class="conflict-note">同衣裝已略過，不編入此作業</span>':''}</div>`;
  }
  function goal(job){
    const f=job.factor_plan;
    return `<div class="goal-summary"><div><small>本人目標</small><b>${f.surface || '草地'} · ${f.distance} · ${styleName[job.racer.style]}</b></div><div class="aptitudes"><span>場地 <b>${f.surface_native || f.turf_native} → ${f.surface_start || f.turf_start}</b></span><span>${f.distance} <b>${f.distance_native} → ${f.distance_start}</b></span><span>${f.style} <b>${f.style_native} → ${f.style_start}</b></span></div><small>原始適性 → 按本圖紅因子規劃的育成開始適性</small></div>`;
  }
  function factorSummary(job){
    const f=job.factor_plan;
    return `<section class="factor-summary"><div class="section-head"><h3>紅因子配置</h3><small>理想星數，非實際持有值</small></div><div class="factor-totals">${Object.entries(f.red_totals).map(([n,s])=>`<span class="factor red">${n} 合計 ${s}★</span>`).join('')}</div><p>${escape(f.note)}</p><p>${escape(f.initial_note)}</p></section>`;
  }
  function alternativePool(job){
    const buckets=new Map([['加速',new Map()],['中期速度',new Map()],['末期速度',new Map()]]);
    const selected=new Set([job.racer.card_id,...(job.families||[]).flatMap(f=>[f.parent.card_id,...f.grandparents.map(c=>c.card_id)])]);
    if(['bwiki-loh','note-loh'].includes(job.data_source)){
      const cards=(job.groups||[]).flatMap(g=>g.cards).filter(c=>!selected.has(c.card_id)).slice(0,6);
      return `<section class="alternative-pool"><div class="section-head"><h3>备选种马池</h3><small>同衣裝／跑法使用率排序，同率參考同跑法統計</small></div><div class="card-grid">${cards.map(c=>`<div class="pool-entry">${node(c,job)}</div>`).join('')}</div></section>`;
    }
    const add=(card,category)=>{
      if(!selected.has(card.card_id))buckets.get(category).set(card.card_id,card);
    };
    for(const group of job.groups||[]){
      const category=group.category.includes('加速')?'加速':group.category.includes('中期')?'中期速度':'末期速度';
      for(const card of group.cards)add(card,category);
    }
    // The original Sapporo families list alternatives without category labels.
    const middle=new Set([102303,102602,110201,107702,105501,108802]);
    for(const card of job.alternatives||[])add(card,card.card_id===106801?'加速':middle.has(card.card_id)?'中期速度':'末期速度');
    if(catalog.events.find(e=>e.key===job.event)?.title.includes('LOH')){
      let remaining=6;
      for(const [category,cards] of buckets){
        const shown=[...cards].slice(0,remaining);
        buckets.set(category,new Map(shown));remaining-=shown.length;
      }
    }
    return `<section class="alternative-pool"><div class="section-head"><h3>备选种马池</h3></div>${[...buckets].map(([title,cards])=>cards.size?`<div class="pool-group"><h4>${title}</h4><div class="card-grid">${[...cards.values()].map(card=>`<div class="pool-entry">${node(card,job)}</div>`).join('')}</div></div>`:'').join('')}</section>`;
  }
  function updateUrl(job) {
    const url=new URL(location.href);url.search='';url.hash='';if(job)url.searchParams.set('job',job.id);
    history.replaceState(null,'',url);
  }
  function renderTeams() {
    const teams=window.RECOMMENDED_TEAMS[state.event] || [];
    $('#team-count').textContent=`${teams.length} 套陣容`;
    $('#teams').innerHTML=teams.map(team=>`<article class="team-card" aria-label="方案 ${team.label}"><h3>${team.label}</h3><div class="team-members">${team.members.map(card=>`<div class="team-member" tabindex="0" title="${escape(card.name)}（${escape(card.costume)}） · ${styleName[card.style]}${card.role?' · '+escape(card.role):''}"><img src="${image(card)}" alt="${escape(card.name)}（${escape(card.costume)}） · ${styleName[card.style]}${card.role?' · '+escape(card.role):''}"></div>`).join('')}</div></article>`).join('');
  }
  function render() {
    renderTeams();
    $('#events').innerHTML=catalog.events.map(ev=>`<div class="event-option ${state.event===ev.key?'active':''}"><button class="event-tab" data-event="${ev.key}" aria-pressed="${state.event===ev.key}"><span class="event-date">${escape(ev.title.split(/\s*[|｜]\s*/)[0])}</span><b>${escape(ev.title.split(/\s*[|｜]\s*/).slice(1).join(' | ') || ev.title)}</b><small>${escape(ev.track)}</small></button><a class="event-source" href="${escape(ev.source)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(ev.title)} 攻略原帖">${['bwiki-loh','note-loh'].includes(ev.data_source)?'統計原頁':'攻略原帖'} ↗</a>${ev.guide_source?`<a class="event-source" href="${escape(ev.guide_source)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(ev.title)} 攻略原帖">攻略原帖 ↗</a>`:''}</div>`).join('');
    const eventStrip=$('#events');
    if(eventStrip.dataset.selected!==state.event){
      const active=eventStrip.querySelector('.event-option.active');
      if(active)eventStrip.scrollLeft=active.offsetLeft-eventStrip.firstElementChild.offsetLeft;
      eventStrip.dataset.selected=state.event;
    }
    requestAnimationFrame(updateRaceNavigation);
    const activeEvent=catalog.events.find(e=>e.key===state.event);
    $('.list-caption').textContent=['bwiki-loh','note-loh'].includes(activeEvent.data_source)?'按統計採用數排列 · 同衣裝不同跑法分列':'按原圖順序排列 · 同衣裝不同跑法分列';
    const available=new Set(catalog.jobs.filter(j=>j.event===state.event).map(j=>j.racer.style));
    const styles=['全部',...['大逃','逃','先','差','追'].filter(s=>available.has(s))];
    $('#styles').innerHTML=styles.map(s=>`<button data-style="${s}" class="${state.style===s?'active':''}" aria-pressed="${state.style===s}">${styleName[s]||s}</button>`).join('');
    const jobs=matches();if(!jobs.some(j=>j.id===state.selected))state.selected=jobs[0]?.id || null;
    $('#count').textContent=`${jobs.length} 份`;
    $('#jobs').innerHTML=jobs.length?jobs.map(j=>`<button class="job-button ${j.id===state.selected?'active':''}" data-job="${j.id}" aria-pressed="${j.id===state.selected}"><span class="order">${String(j.racer.order).padStart(2,'0')}</span><img src="${image(j.racer)}" alt=""><span class="job-text"><b>${escape(j.racer.name)}</b><small>${j.statistics?'':escape(j.racer.tier)+' · '}${styleName[j.racer.style]}</small></span></button>`).join(''):'<div class="empty"><b>沒有符合條件的作業</b><p>請調整跑法或搜尋條件。</p><button data-reset>清除篩選</button></div>';
    const job=jobs.find(j=>j.id===state.selected);updateUrl(job);renderDetail(job);
  }
  function renderDetail(job) {
    if(!job){$('#detail').innerHTML='<div class="empty"><span style="font-size:42px">📋</span><b>換個條件，繼續找作業</b><p>可調整搜尋條件，或切換其他賽事。</p></div>';return;}
    const ev=catalog.events.find(e=>e.key===job.event),r=job.racer;
    let content='';
    if(job.families){
      content=`<div class="section-head"><h3>推薦血統圖</h3><small>兩親輩 · 四祖輩</small></div><div class="composition">${['bwiki-loh','note-loh'].includes(job.data_source)?'':Object.entries(job.role_counts).filter(([,v])=>v).map(([k,v])=>`<span>${k} × ${v}</span>`).join('')}</div><div class="pedigree"><div class="self-node"><img src="${image(r)}" alt=""><div><small>育成戰馬 · ${styleName[r.style]}</small><b>${escape(r.name)}</b></div></div>${goal(job)}<div class="family-grid">${job.families.map((f,i)=>`<div class="family ${i?'pink':''}"><div class="family-label">親輩 ${i+1} · ${i?'粉框':'藍框'}家系</div>${node(f.parent,job)}<div class="grand-label">這位親輩的兩位祖輩</div><div class="grand-grid">${f.grandparents.map(c=>`<div class="grand-branch">${node(c,job)}</div>`).join('')}</div></div>`).join('')}</div></div>${factorSummary(job)}${alternativePool(job)}`;
    } else {
      content='<div class="explain">這期原圖列的是各跑法的種馬候選池，尚未指定固定六枠與親祖連線。以下保留原分類，供選取這份推薦方案查閱。</div><div class="section-head"><h3>推薦種馬候選</h3><small>按作者用途分類</small></div>'+job.groups.map(g=>`<div class="pool-group"><h4>${escape(g.category)}</h4><div class="card-grid">${g.cards.map(c=>node(c,job)).join('')}</div></div>`).join('');
    }
    const designLink=job.families?`<a class="design-link" data-open-design href="${escape(window.RECOMMENDED_DESIGN_LINK(job,ev))}">前往種馬設計圖 <span aria-hidden="true">→</span></a>`:'';
    $('#detail').innerHTML=`<div class="detail-top"><img class="main-portrait" src="${image(r)}" alt="${escape(r.name)}"><div><div class="detail-badges">${job.statistics?'':`<span class="tier">${escape(r.tier)}</span>`}<span class="tag">${styleName[r.style]}</span></div><h2>${escape(r.name)}</h2><p>${escape(r.ja)} ${escape(r.costume_ja)}</p><p>${job.statistics?`統計第 ${r.order} 位`:`原圖第 ${r.order} 條`} · ${escape(ev.author || catalog.author)}</p></div></div><div class="race-line"><div>${escape(ev.title)}<br><span class="muted">${escape(ev.track)}</span></div>${designLink}</div>${content}`;
  }
  function updateRaceNavigation(){
    const el=$('#events');
    document.querySelector('[data-race-scroll="-1"]').disabled=el.scrollLeft<=2;
    document.querySelector('[data-race-scroll="1"]').disabled=el.scrollLeft+el.clientWidth>=el.scrollWidth-2;
  }
  $('#events').addEventListener('scroll',updateRaceNavigation,{passive:true});
  window.addEventListener('resize',updateRaceNavigation);
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-open-design]')){
      // The original editor keeps its server selection separately from share data.
      try{localStorage.setItem('uma-design:v1:jobsServer','繁中服');}catch(_){}
      return;
    }
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.raceScroll){const strip=$('#events');strip.scrollBy({left:Number(b.dataset.raceScroll)*(strip.firstElementChild.offsetWidth+10),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
    else if(b.dataset.event){state.event=b.dataset.event;state.style='全部';render();}
    else if(b.dataset.style){state.style=b.dataset.style;render();}
    else if(b.dataset.job){state.selected=b.dataset.job;render();if(matchMedia('(max-width:720px)').matches)$('#detail').scrollIntoView({behavior:'smooth',block:'start'});}
    else if(b.hasAttribute('data-reset')){state.style='全部';state.query='';$('#search').value='';render();}

  });
  $('#search').addEventListener('input',e=>{state.query=e.target.value;render();});
  render();
})();
