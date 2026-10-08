(() => {
  'use strict';
  const catalog = window.RECOMMENDED_CATALOG;
  const $ = s => document.querySelector(s);
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusName = {ready:'完整家系',pool:'候選方案',incomplete:'家系待補完'};
  const styleName = {'逃':'逃・領頭','大逃':'大逃','先':'先・前列','差':'差・居中','追':'追・後追'};
  const initial = catalog.jobs.find(j => j.id === new URL(location.href).searchParams.get('job'));
  const state = {event:initial?.event || 'june',style:'全部',query:'',complete:false,selected:initial?.id || 'june-01'};
  const image = card => window.__AV[String(card.card_id)] || '';
  const cleanQuery = s => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
  function matches() {
    const q=cleanQuery(state.query);
    return catalog.jobs.filter(j => j.event===state.event && (state.style==='全部'||j.racer.style===state.style) && (!state.complete||j.status==='ready') && (!q||cleanQuery([j.racer.name,j.racer.ja,j.racer.costume_ja,j.racer.card_id,catalog.nameAliases[String(j.racer.character_id)]].join(' ')).includes(q)));
  }
  function node(card, job, allowConflict=true) {
    const conflict=allowConflict && card.card_id===job.racer.card_id;
    const alternate=allowConflict && card.character_id===job.racer.character_id && !conflict;
    const skill=card.inherit_skill_ja || catalog.skillNames[String(card.card_id)];
    const factors=card.factors;

    const badges=factors?`<div class="factor-stack"><span class="factor red">${escape(factors.red.name)} <b>★★★</b></span></div>`:'';
    return `<div class="node${conflict?' conflict':''}" data-card="${card.card_id}">${card.role?`<span class="role-label ${card.is_acceleration?'accel':''}">${escape(card.role)}</span>`:''}<img src="${image(card)}" alt="${escape(card.name)}"><b>${escape(card.name)}</b><div class="costume">${escape(card.costume_ja)}</div>${skill?`<span class="skill">繼承固有 · ${escape(skill)}</span>`:''}${badges}${alternate?'<span class="alternate-note">同角色異衣裝 · 僅放祖輩</span>':''}${conflict?'<span class="conflict-note">同衣裝已略過，不編入此作業</span>':''}${card.condition_note?`<details class="node-notes"><summary>發動條件</summary><p>${escape(card.condition_note)}</p></details>`:''}</div>`;
  }
  function goal(job){
    const f=job.factor_plan;
    return `<div class="goal-summary"><div><small>本人目標</small><b>草地 · ${f.distance} · ${styleName[job.racer.style]}</b></div><div class="aptitudes"><span>場地 <b>${f.turf_native} → ${f.turf_start}</b></span><span>${f.distance} <b>${f.distance_native} → ${f.distance_start}</b></span><span>${f.style} <b>${f.style_native} → ${f.style_start}</b></span></div><small>原始適性 → 按本圖紅因子規劃的育成開始適性</small></div>`;
  }
  function factorSummary(job){
    const f=job.factor_plan;
    return `<section class="factor-summary"><div class="section-head"><h3>紅因子配置</h3><small>理想星數，非實際持有值</small></div><div class="factor-totals">${Object.entries(f.red_totals).map(([n,s])=>`<span class="factor red">${n} 合計 ${s}★</span>`).join('')}</div><p>${escape(f.note)}</p><p>${escape(f.initial_note)}</p></section>`;
  }
  const baseStyle=s=>s==='大逃'?'逃':s;
  const poolCards=j=>(j.groups||[]).flatMap(g=>g.cards).concat(j.alternatives||[]);
  function alternativePool(job){
    const usage=new Map(),allStyles=new Set();
    for(const j of catalog.jobs.filter(j=>j.event===job.event)){
      const st=baseStyle(j.racer.style);allStyles.add(st);
      const cards=poolCards(j).concat((j.families||[]).flatMap(f=>[f.parent,...f.grandparents]));
      for(const c of cards){if(!usage.has(c.card_id))usage.set(c.card_id,new Set());usage.get(c.card_id).add(st);}
    }
    const entries=new Map();
    const add=(c,category)=>{
      if(c.card_id===job.racer.card_id)return;
      if(!entries.has(c.card_id))entries.set(c.card_id,{card:c,categories:[],order:entries.size});
      const e=entries.get(c.card_id);if(category&&!e.categories.includes(category))e.categories.push(category);
    };
    for(const g of job.groups||[])for(const c of g.cards)add(c,g.category);
    for(const c of job.alternatives||[])add(c,'備選');
    const sorted=[...entries.values()].map(e=>({...e,others:[...(usage.get(e.card.card_id)||[])].filter(s=>s!==baseStyle(job.racer.style))})).sort((a,b)=>a.others.length-b.others.length||a.order-b.order);
    const buckets=[['本跑法特色',e=>!e.others.length],['少數跑法共用',e=>e.others.length>0&&e.others.length<allStyles.size-1],['多跑法共用',e=>e.others.length>=allStyles.size-1]];
    return `<section class="alternative-pool"><div class="section-head"><h3>备选种马池</h3><small>優先展示跑法特色</small></div><p class="small muted">依本賽道已收錄推薦的跑法重合度排序；不代表技能的跑法限制。逃與大逃合併比較。</p>${buckets.map(([title,filter])=>{const rows=sorted.filter(filter);return rows.length?`<div class="pool-group"><h4>${title}</h4><div class="card-grid">${rows.map(e=>`<div class="pool-entry" data-overlap="${e.others.length}"><div class="pool-use">${e.categories.map(escape).join(' · ')}</div>${node(e.card,job)}<p class="pool-overlap">${e.others.length?'也見於：'+e.others.map(s=>styleName[s]).join('、'):'本賽道已收錄推薦中僅見於此跑法'}</p></div>`).join('')}</div></div>`:''}).join('')}</section>`;
  }
  function updateUrl(job) {
    const url=new URL(location.href);url.search='';url.hash='';if(job)url.searchParams.set('job',job.id);
    history.replaceState(null,'',url);
  }
  function render() {
    $('#events').innerHTML=catalog.events.map(ev=>`<button class="event-tab ${state.event===ev.key?'active':''}" data-event="${ev.key}" aria-pressed="${state.event===ev.key}"><b>${escape(ev.title.replace('2025 年 ',''))}</b><small>${escape(ev.track)}</small></button>`).join('');
    const available=new Set(catalog.jobs.filter(j=>j.event===state.event).map(j=>j.racer.style));
    const styles=['全部',...['大逃','逃','先','差','追'].filter(s=>available.has(s))];
    $('#styles').innerHTML=styles.map(s=>`<button data-style="${s}" class="${state.style===s?'active':''}" aria-pressed="${state.style===s}">${styleName[s]||s}</button>`).join('');
    const jobs=matches();if(!jobs.some(j=>j.id===state.selected))state.selected=jobs[0]?.id || null;
    $('#count').textContent=`${jobs.length} 份`;
    $('#jobs').innerHTML=jobs.length?jobs.map(j=>`<button class="job-button ${j.id===state.selected?'active':''}" data-job="${j.id}" aria-pressed="${j.id===state.selected}"><span class="order">${String(j.racer.order).padStart(2,'0')}</span><img src="${image(j.racer)}" alt=""><span class="job-text"><b>${escape(j.racer.name)}</b><small>${j.racer.tier} · ${styleName[j.racer.style]}</small><br><span class="tag ${j.status}">${statusName[j.status]}</span></span></button>`).join(''):'<div class="empty"><b>沒有符合條件的作業</b><p>這期可能尚未提供完整六枠家系。</p><button data-reset>清除篩選</button></div>';
    const job=jobs.find(j=>j.id===state.selected);updateUrl(job);renderDetail(job);
  }
  function renderDetail(job) {
    if(!job){$('#detail').innerHTML='<div class="empty"><span style="font-size:42px">📋</span><b>換個條件，繼續找作業</b><p>可關閉「只看完整家系」，或切換其他賽事。</p></div>';return;}
    const ev=catalog.events.find(e=>e.key===job.event),r=job.racer;
    let content='';
    if(job.families){
      content=`<div class="section-head"><h3>推薦血統圖</h3><small>兩親輩 · 四祖輩</small></div><div class="composition">${Object.entries(job.role_counts).filter(([,v])=>v).map(([k,v])=>`<span>${k} × ${v}</span>`).join('')}</div><div class="pedigree"><div class="self-node"><img src="${image(r)}" alt=""><div><small>育成戰馬 · ${styleName[r.style]}</small><b>${escape(r.name)}</b></div></div>${goal(job)}<div class="family-grid">${job.families.map((f,i)=>`<div class="family ${i?'pink':''}"><div class="family-label">親輩 ${i+1} · ${i?'粉框':'藍框'}家系</div>${node(f.parent,job)}<div class="grand-label">這位親輩的兩位祖輩</div><div class="grand-grid">${f.grandparents.map(c=>`<div class="grand-branch">${node(c,job)}</div>`).join('')}</div></div>`).join('')}</div></div>${factorSummary(job)}${alternativePool(job)}`;
    } else {
      content='<div class="explain">這期原圖列的是各跑法的種馬候選池，尚未指定固定六枠與親祖連線。以下保留原分類，供選取這份推薦方案查閱。</div><div class="section-head"><h3>推薦種馬候選</h3><small>按作者用途分類</small></div>'+job.groups.map(g=>`<div class="pool-group"><h4>${escape(g.category)}</h4><div class="card-grid">${g.cards.map(c=>node(c,job)).join('')}</div></div>`).join('');
    }
    $('#detail').innerHTML=`<div class="detail-top"><img class="main-portrait" src="${image(r)}" alt="${escape(r.name)}"><div><div class="detail-badges"><span class="tag ${job.status}">${statusName[job.status]}</span><span class="tier">${r.tier}</span><span class="tag">${styleName[r.style]}</span></div><h2>${escape(r.name)}</h2><p>${escape(r.ja)} ${escape(r.costume_ja)}</p><p>原圖第 ${r.order} 條 · 攻略來源 ${escape(catalog.author)}</p></div></div><div class="race-line">${escape(ev.title)}<br><span class="muted">${escape(ev.track)}</span></div><div class="actions"><button data-copy>🔗 複製這份作業連結</button><button data-print>列印 / 儲存 PDF</button><a href="${ev.source}" target="_blank" rel="noopener noreferrer">查看攻略原帖 ↗</a></div><div id="copy-fallback"></div>${content}`;
  }
  let timer;
  function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('#toast').hidden=true,2600);}
  document.addEventListener('click',async event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.event){state.event=b.dataset.event;state.style='全部';render();}
    else if(b.dataset.style){state.style=b.dataset.style;render();}
    else if(b.dataset.job){state.selected=b.dataset.job;render();if(matchMedia('(max-width:720px)').matches)$('#detail').scrollIntoView({behavior:'smooth',block:'start'});}
    else if(b.hasAttribute('data-reset')){state.style='全部';state.query='';state.complete=false;$('#search').value='';$('#complete').checked=false;render();}
    else if(b.hasAttribute('data-print'))window.print();
    else if(b.hasAttribute('data-copy')){
      try{await navigator.clipboard.writeText(location.href);toast('已複製這份推薦作業連結');}
      catch{const input=document.createElement('input');input.className='copy-fallback';input.readOnly=true;input.value=location.href;input.setAttribute('aria-label','作業連結，可手動複製');$('#copy-fallback').replaceChildren(input);input.select();toast('請複製下方已選取的連結');}
    }
  });
  $('#search').addEventListener('input',e=>{state.query=e.target.value;render();});
  $('#complete').addEventListener('change',e=>{state.complete=e.target.checked;render();});
  render();
})();
