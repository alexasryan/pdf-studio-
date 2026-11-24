/** PDF Studio presentation only.
 * Adapted from Design Bookmark Motion Studies: shared/motion.js and tokens.css,
 * magnetic-button, tab-pill and file-drop. https://designbookmark.com/motion
 * No document operations, file handlers, application state or theme storage are changed.
 */
(() => {
  if(document.documentElement.dataset.performance==='lite')return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const presets = {soft:[260,24],pop:[520,16],fade:[420,32],magnet:[170,13],drop:[380,16],lead:[620,40],trail:[170,19]};
  const animations = new Set();
  const running = new WeakMap();
  // Same mass-1 spring integration and four substeps as the reference engine.
  // Sample once into WAAPI keyframes: no permanent requestAnimationFrame loop.
  function curve(preset) {
    const [k,c] = presets[preset];
    let x=0,v=0; const points=[0];
    for(let f=0;f<150;f++) {
      for(let sub=0;sub<4;sub++){v+=(-k*(x-1)-c*v)/240;x+=v/240;}
      points.push(x);
      if(f>12&&Math.abs(x-1)<.001&&Math.abs(v)<.01)break;
    }
    points[points.length-1]=1;return points;
  }
  const curves=Object.fromEntries(Object.keys(presets).map(key=>[key,curve(key)]));
  function spring(el,key,preset,frame) {
    if(!el||reduce.matches)return;
    let map=running.get(el);if(!map){map=new Map();running.set(el,map);}
    map.get(key)?.cancel();
    const points=curves[preset];
    const animation=el.animate(points.map(frame),{duration:(points.length-1)*1000/60,fill:'none',easing:'linear'});
    map.set(key,animation);animations.add(animation);
    const clear=()=>{animations.delete(animation);if(map.get(key)===animation)map.delete(key);};
    animation.onfinish=clear;animation.oncancel=clear;
  }
  const observedCards=new Set();
  const reveal=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){
      reveal.unobserve(entry.target);observedCards.delete(entry.target);
      spring(entry.target,'enter','soft',p=>({opacity:Math.min(1,Math.max(0,p)),translate:`0 ${(1-p)*18}px`}));
    }
  },{threshold:.08});
  function cards(){
    for(const el of observedCards)if(!el.isConnected){reveal.unobserve(el);observedCards.delete(el);}
    document.querySelectorAll('#grid .card:not([data-motion])').forEach(el=>{el.dataset.motion='';observedCards.add(el);reveal.observe(el);});
  }
  const grid=document.getElementById('grid');
  new MutationObserver(cards).observe(grid,{childList:true});cards();
  document.querySelectorAll('.hero-copy,.art,#home-drop,.catalog-head').forEach(el=>reveal.observe(el));

  // Decorative paper stack responds to a real pointer, then springs home.
  const hero=document.querySelector('.hero');const papers=[...document.querySelectorAll('.paper,.floating')];
  function paperMove(x,y){
    const positions=papers.map(el=>getComputedStyle(el).translate.split(' ').map(parseFloat));
    papers.forEach((el,i)=>{
    const old=positions[i];
    const sx=Number.isFinite(old[0])?old[0]:0,sy=Number.isFinite(old[1])?old[1]:0;
    const tx=x*(i+1)*1.1,ty=y*(i+1)*.8;
    el.style.translate=`${tx}px ${ty}px`;
    spring(el,'parallax','soft',p=>({translate:`${sx+(tx-sx)*p}px ${sy+(ty-sy)*p}px`}));
  });}
  let paperFrame=0,pointer=null;
  function schedulePapers(){
    if(paperFrame)return;
    paperFrame=requestAnimationFrame(()=>{
      paperFrame=0;if(reduce.matches)return;
      if(!pointer){paperMove(0,0);return;}
      const r=hero.getBoundingClientRect();
      paperMove((pointer.x-r.left)/r.width*2-1,(pointer.y-r.top)/r.height*2-1);
    });
  }
  hero.addEventListener('pointermove',e=>{if(fine.matches&&!reduce.matches){pointer={x:e.clientX,y:e.clientY};schedulePapers();}});
  hero.addEventListener('pointerleave',()=>{pointer=null;schedulePapers();});

  // Additive listeners preserve all existing application click/drag handlers.
  document.addEventListener('pointerdown',e=>{
    const el=e.target.closest('button:not(:disabled)');if(!el)return;
    spring(el,'press','pop',p=>({scale:String(.965+.035*p)}));
  });
  document.addEventListener('pointerover',e=>{
    if(!fine.matches||reduce.matches)return;
    const card=e.target.closest('#grid .card');
    if(card&&!card.contains(e.relatedTarget))spring(card.querySelector('.tool-icon'),'icon','pop',p=>({scale:String(.86+.14*p)}));
  });
  const choose=document.getElementById('choose');
  choose.addEventListener('pointermove',e=>{
    if(!fine.matches||reduce.matches)return;
    const r=choose.getBoundingClientRect();const x=(e.clientX-r.left-r.width/2)*.08,y=(e.clientY-r.top-r.height/2)*.12;
    choose.style.translate=`${x}px ${y}px`;
  });
  choose.addEventListener('pointerleave',()=>{
    const [x=0,y=0]=getComputedStyle(choose).translate.split(' ').map(parseFloat);
    choose.style.translate='0px 0px';
    spring(choose,'magnet','magnet',p=>({translate:`${(x||0)*(1-p)}px ${(y||0)*(1-p)}px`}));
  });
  const drop=document.getElementById('home-drop');
  new MutationObserver(()=>{
    const icon=drop.querySelector('.upload-icon');const active=drop.classList.contains('dragging');
    icon.style.translate=active?'0px -5px':'0px 0px';
    spring(icon,'drop','drop',p=>({translate:`0 ${active?-5*p:-5*(1-p)}px`}));
  }).observe(drop,{attributes:true,attributeFilter:['class']});

  // A separate decorative pill follows the existing aria-pressed state.
  // Kept last so the app's button indices and filter handlers remain identical.
  const filters=document.getElementById('filters');
  const pill=document.createElement('span');pill.className='filter-highlight';pill.setAttribute('aria-hidden','true');
  let previous=null;
  function positionPill(){
    const selected=filters.querySelector('button[aria-pressed="true"]');if(!selected)return;
    if(!pill.isConnected){filters.append(pill);filters.classList.add('motion-ready');}
    const to={x:selected.offsetLeft,y:selected.offsetTop,w:selected.offsetWidth,h:selected.offsetHeight};
    if(previous&&Object.keys(to).every(key=>to[key]===previous[key]))return;
    let from=previous;
    if(from&&pill.isConnected){
      const current=pill.getBoundingClientRect(),container=filters.getBoundingClientRect();
      if(current.width>0)from={x:current.left-container.left,y:current.top-container.top,w:current.width,h:current.height};
    }
    previous=to;
    Object.assign(pill.style,{left:to.x+'px',top:to.y+'px',width:to.w+'px',height:to.h+'px',transformOrigin:'0 0'});
    if(from){
      const right=to.x>=from.x;
      // Separate spring curves for leading/trailing edges create the original stretch.
      const a=curves[right?'trail':'lead'],b=curves[right?'lead':'trail'];
      const n=Math.max(a.length,b.length);
      running.get(pill)?.get('pill')?.cancel();
      const frames=Array.from({length:n},(_,i)=>{
        const l=from.x+(to.x-from.x)*(a[Math.min(i,a.length-1)]);
        const r=from.x+from.w+(to.x+to.w-from.x-from.w)*(b[Math.min(i,b.length-1)]);
        const p=curves.soft[Math.min(i,curves.soft.length-1)];
        return {transform:`translate(${l-to.x}px,${from.y+(to.y-from.y)*p-to.y}px) scale(${Math.max(0,r-l)/Math.max(1,to.w)},${(from.h+(to.h-from.h)*p)/Math.max(1,to.h)})`};
      });
      if(!reduce.matches){const animation=pill.animate(frames,{duration:(n-1)*1000/60});animations.add(animation);let map=running.get(pill);if(!map){map=new Map();running.set(pill,map);}map.set('pill',animation);animation.onfinish=animation.oncancel=()=>animations.delete(animation);}
    }
  }
  new MutationObserver(positionPill).observe(filters,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed']});
  new ResizeObserver(positionPill).observe(filters);positionPill();
  const dialog=document.getElementById('workspace');
  new MutationObserver(()=>{if(dialog.open)spring(dialog,'open','soft',p=>({opacity:Math.min(1,Math.max(0,p)),translate:`0 ${(1-p)*22}px`,scale:String(.975+.025*p)}));}).observe(dialog,{attributes:true,attributeFilter:['open']});
  const status=document.getElementById('status');
  new MutationObserver(()=>{if(status.classList.contains('downloads'))spring(status,'done','pop',p=>({translate:`0 ${(1-p)*8}px`,opacity:Math.min(1,Math.max(0,p))}));}).observe(status,{childList:true});
  reduce.addEventListener('change',()=>{if(reduce.matches){for(const animation of animations)animation.cancel();papers.forEach(el=>el.style.removeProperty('translate'));choose.style.removeProperty('translate');}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const animation of animations)animation.cancel();}});
})();
