(() => {
  'use strict';
  // Native design page v1 share format: [slot, outfit, red, stars, mark, memo].
  const factors = {'草地':1,'泥地':2,'短距離':3,'英里':4,'中距離':5,'長距離':6,'領頭':7,'前列':8,'居中':9,'後追':10};
  const styles = {'逃':'領頭','大逃':'領頭','先':'前列','差':'居中','追':'後追'};
  function factorId(name) {
    if (!factors[name]) throw new Error(`Unknown red factor: ${name}`);
    return factors[name];
  }
  window.RECOMMENDED_DESIGN_LINK = (job, event) => {
    const plan = job.factor_plan;
    const running = job.racer.style === '大逃' ? '大逃' : styles[job.racer.style];
    const memo = `${event.title}；${event.track}；${running}`;
    const slot = (index, card) => [index, card.card_id, factorId(card.factors.red.name), card.factors.red.stars, 0, ''];
    const slots = [[0, job.racer.card_id, 0, 0, 0, memo]];
    job.families.forEach((family, i) => {
      slots.push(slot(i + 1, family.parent));
      family.grandparents.forEach((card, j) => slots.push(slot(3 + i * 2 + j, card)));
    });
    const payload = {
      v:1, t:`${event.title}｜${job.racer.name.split('（')[0]}`.slice(0,40), d:1,
      s:slots.sort((a,b) => a[0]-b[0]), k:[],
      g:[factorId(plan.surface || '草地'), factorId(plan.distance), factorId(styles[job.racer.style])]
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return `../?_version=20261010-design-link-2#d=${encoded}`;
  };
})();
