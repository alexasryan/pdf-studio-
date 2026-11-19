// UI/UX Pro Max improvements: tool discovery, accessible feedback and keyboard use.
// This module never reads document bytes or changes PDF processing.
const aliases = {
  merge:'соединить склеить собрать объединение merge combine',
  compress:'уменьшить размер вес сжатие compress reduce',
  sign:'подпись подписывать расписаться signature sign',
  edit:'редактор изменить правки редактирование edit editor',
  split:'разделение разбить split',
  organize:'сортировка переставить упорядочить reorder organize',
  images:'фото фотографии картинка картинки jpg jpeg png webp image photo',
  jpg:'картинки фотографии jpeg images', png:'картинки фотографии images',
  word:'doc docx ворд word', docx:'doc ворд word',
  ocr:'распознавание скан сканы ocr recognition',
  protect:'шифрование защита password encrypt', unlock:'расшифровать пароль password decrypt',
  view:'просмотр открыть читать reader view',
  rotate:'поворот повернуть rotation', resize:'формат a4 а4 масштаб scale size',
  extract:'вытащить сохранить страницы extract', remove:'убрать удалить страницы delete',
};
export function matchesTool([key,title,description],query) {
  const normalize=value=>value.toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[→−–—]/g,' ');
  const words=normalize(query).trim().split(/\s+/).filter(Boolean);
  const haystack=normalize([title,description,aliases[key]||''].join(' '));
  return words.every(word=>haystack.includes(word));
}
export function initExperience({tools,icons,openTool,resetSearch}) {
  const $=id=>document.getElementById(id);
  const toolMap=new Map(tools.map(tool=>[tool[0],tool]));
  const recentKey='pdf-studio-recent-tools';
  let recent=[];
  try {
    const value=JSON.parse(localStorage.getItem(recentKey)||'[]');
    if(Array.isArray(value))recent=[...new Set(value.filter(key=>typeof key==='string'&&toolMap.has(key)))].slice(0,4);
  } catch {}
  function toolButton(key,compact=false) {
    const [,title,description,,icon,color]=toolMap.get(key);
    const button=document.createElement('button');button.type='button';button.className=compact?'recent-tool':'quick-tool';button.dataset.tool=key;
    const badge=document.createElement('span');badge.className='tool-icon '+color;badge.setAttribute('aria-hidden','true');badge.innerHTML=icons[icon]||'';
    const label=document.createElement('span');label.className='shortcut-copy';
    const name=document.createElement('strong');name.textContent=title;label.append(name);
    if(!compact){const desc=document.createElement('span');desc.textContent=description;label.append(desc);}
    button.append(badge,label);button.onclick=()=>{if(!$('workspace').open)openTool(key);};return button;
  }
  function renderRecent(){
    const existing=new Map([...$('recent-tools').children].map(button=>[button.dataset.tool,button]));
    $('recent-tools').replaceChildren(...recent.map(key=>existing.get(key)||toolButton(key,true)));
    $('recent-section').hidden=!recent.length;
  }
  function saveRecent(){try{localStorage.setItem(recentKey,JSON.stringify(recent));}catch{}}
  ['edit','merge','compress','sign','images','word'].forEach(key=>$('quick-tools').append(toolButton(key)));
  renderRecent();
  $('clear-recent').onclick=()=>{recent=[];try{localStorage.removeItem(recentKey);}catch{}renderRecent();$('search').focus();};
  $('clear-search').onclick=()=>{resetSearch();$('search').focus();};
  $('workspace-add').onclick=()=>{if(!$('file-input').disabled)$('file-input').click();};
  const search=$('search');
  function searchState(){
    $('clear-search').hidden=!search.value;
    $('search-shortcut').hidden=Boolean(search.value);
  }
  search.addEventListener('input',searchState);searchState();
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.altKey||$('workspace').open)return;
    const editing=event.target.closest?.('input,textarea,select,[contenteditable="true"]');
    const shortcut=(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k';
    if(shortcut||(!editing&&!event.metaKey&&!event.ctrlKey&&event.key==='/')){
      event.preventDefault();search.focus();search.select();
    } else if(event.key==='Escape'&&event.target===search&&search.value){
      event.preventDefault();resetSearch();searchState();search.focus();
    }
  });
  const tablist=document.querySelector('.document-tabs');
  function updateTabs(){
    const tabs=[...tablist.querySelectorAll('[role="tab"]')];
    for(const tab of tabs)tab.tabIndex=tab.getAttribute('aria-selected')==='true'&&!tab.disabled?0:-1;
    const active=tabs.find(tab=>tab.getAttribute('aria-selected')==='true');
    if(active)$('document-content').setAttribute('aria-labelledby',active.id);
  }
  tablist.addEventListener('keydown',event=>{
    if(!event.target.matches('[role="tab"]')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...tablist.querySelectorAll('[role="tab"]:not(:disabled)')];if(!tabs.length)return;
    event.preventDefault();let index=tabs.indexOf(event.target);
    index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[index].click();tabs[index].focus();
  });
  new MutationObserver(updateTabs).observe(tablist,{subtree:true,attributes:true,attributeFilter:['aria-selected','disabled']});updateTabs();
  function themeLabel(){
    const dark=document.documentElement.dataset.theme==='dark';
    const label=dark?'Включить светлую тему':'Включить тёмную тему';
    $('theme').title=label;$('theme').setAttribute('aria-label',label);
  }
  new MutationObserver(themeLabel).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});themeLabel();
  return {
    remember(key){
      if(!toolMap.has(key))return;
      recent=[key,...recent.filter(item=>item!==key)].slice(0,4);saveRecent();renderRecent();
    },
    catalog(){searchState();},
    sync({busy,preparing,hasFiles,toolId,canRun}){
      $('run').setAttribute('aria-busy',String(busy));
      $('run').setAttribute('aria-label',busy?'Обрабатываем документ':$('run').textContent);
      $('workspace-main').dataset.loading=String(preparing);
      $('document-content').setAttribute('aria-busy',String(preparing));
      $('workspace-loading').hidden=!preparing;
      const ready=$('status').classList.contains('downloads');
      $('workspace-progress').textContent=busy?'Обработка на устройстве…':preparing?'Открываем документ…':ready?'Готово — скачайте результат':!hasFiles?'Добавьте файлы, чтобы начать':toolId==='view'?'Документ открыт для просмотра':toolId==='merge'&&!canRun?'Добавьте ещё один PDF для объединения':canRun?'Внесите правки и сохраните результат':'Проверьте документ и настройки';
      if(busy)$('run').title='Документ обрабатывается';
      else if(!hasFiles)$('run').title='Сначала добавьте документ';
      else if(toolId==='merge'&&!canRun)$('run').title='Для объединения нужно не менее двух PDF';
      else $('run').removeAttribute('title');
    },
  };
}
