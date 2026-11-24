import {getProfile,initPerformanceControl} from './device-profile.js';
import {initExperience,matchesTool} from './experience.js';
import {createSourcePreview,sourceKind} from './source-preview.js';
import {createPages,transformPages,pageResult,pageTools} from './pages.js';
import {categories,tools,formats,many,visual,schemas,hints,pdfOnly} from './tools.js';
import {formData,load,operate} from './pdf.js';
import {createViewer} from './viewer.js';

const $=id=>document.getElementById(id);
const dialog=$('workspace');
const input=$('file-input');
const controls=$('options');
const stage=$('stage');
const run=$('run');
const status=$('status');
const icons=await fetch('./icons.json').then(response=>response.json()).catch(()=>({}));
const drawIcon=(element,name)=>{element.innerHTML=icons[name]||'';};
document.querySelectorAll('[data-icon]').forEach(el=>drawIcon(el,el.dataset.icon));
const toolMap=new Map(tools.map(tool=>[tool[0],tool]));
let filter=-1, id, files=[], viewer, prepared, generation=0, busy=false, preparing=false, download;
const fields=new Map();
initPerformanceControl();
let activeFile=null, pageManager=null, sourcePreview=null, workspaceMode='document';
const pageStates=new Map(), visualCache=new Map();
let adjustmentTimer;
function refreshAdjustments(){clearTimeout(adjustmentTimer);adjustmentTimer=setTimeout(()=>pageManager?.refreshPreview?.(),getProfile().previewDebounce);}
function workspaceView(mode=workspaceMode) {
  workspaceMode=mode;
  const hasDocument=Boolean(activeFile&&(sourceKind(activeFile)||/\.pdf$/i.test(activeFile.name)));
  $('workspace-empty').hidden=Boolean(files.length);
  $('active-document').textContent=activeFile?.name||'';
  $('document-tab').disabled=!hasDocument||preparing;
  $('pages-tab').disabled=!pageManager||preparing;
  $('document-tab').setAttribute('aria-selected',String(mode==='document'));
  $('pages-tab').setAttribute('aria-selected',String(mode==='pages'));
  if(mode==='pages') {
    stage.hidden=true;$('page-manager').hidden=!pageManager;pageManager?.showGrid();
  } else if(sourcePreview) {
    stage.hidden=false;$('page-manager').hidden=true;
  } else if(visual.has(id)&&viewer) {
    stage.hidden=false;$('page-manager').hidden=true;
  } else {
    stage.hidden=id!=='form'||!prepared;
    $('page-manager').hidden=!pageManager;
    if(pageManager) void pageManager.showDocument();
  }
}
$('document-tab').onclick=()=>workspaceView('document');
$('pages-tab').onclick=()=>workspaceView('pages');
$('toggle-settings').onclick=()=>{const sidebar=$('workspace-sidebar');sidebar.hidden=!sidebar.hidden;$('toggle-settings').setAttribute('aria-expanded',String(!sidebar.hidden));};
async function switchTool(next) {
  if(next===id||busy||preparing)return;
  const entries=[...files];busy=true;sync();report('Сохраняем правки перед переключением…');
  try {
    const updated=[];
    for(const file of entries) {
      let entry=file;
      const cached=visualCache.get(file);
      if(file===activeFile&&['form','metadata'].includes(id)) {const result=await operate(id,[file],settings(),report,viewer,prepared);entry=new File([result.blob],file.name,{type:'application/pdf'});}
      if(cached&&id!=='view') {try{const result=await cached.viewer.export(id,report);entry=new File([result.blob],file.name,{type:'application/pdf'});}finally{if(file!==activeFile)cached.viewer.suspend?.();}}
      if(pageStates.has(file))entry=await transformPages(entry,pageStates.get(file));
      updated.push(entry);
    }
    busy=false;show(next,updated,Math.max(0,entries.indexOf(activeFile)));
  } catch(error){report(errorText(error),true);}finally{busy=false;$('workspace-tool').value=id;sync();}
}
$('workspace-tool').onchange=event=>void switchTool(event.target.value);
function toolNavigation() {
  const select=$('workspace-tool');select.replaceChildren();
  const current=activeFile;
  const groups=new Map();
  for(const [key,title,,category] of tools) {
    const accept=(formats[key]||pdfOnly).split(',');
    const compatible=!current||accept.some(type=>type.startsWith('.')?current.name.toLowerCase().endsWith(type):current.type===type);
    if(compatible||key===id) {
      if(!groups.has(category)){const group=document.createElement('optgroup');group.label=categories[category];groups.set(category,group);select.append(group);}
      groups.get(category).append(new Option(title,key,false,key===id));
    }
  }
  const actions=$('edit-actions');actions.replaceChildren();actions.hidden=id!=='edit';
  if(id==='edit') {
    const mode=fields.get('mode');mode.parentElement.hidden=true;
    const refresh=()=>{for(const b of actions.children)b.setAttribute('aria-pressed',String(b.dataset.mode===mode.value));};
    for(const [value,label] of [['text','Текст'],['ink','Карандаш'],['highlight','Выделить'],['image','Изображение']]) {
      const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;button.dataset.mode=value;
      button.onclick=()=>{mode.value=value;mode.onchange();refresh();};actions.append(button);
    }
    refresh();
  }
}
function clearDocuments() {
  for(const entry of visualCache.values()) void entry.viewer.dispose().catch(()=>{});
  visualCache.clear();pageStates.clear();activeFile=null;
}
function pageSettings(file) {
  const value=settings(), state=pageStates.get(file);
  if(state&&fields.has('pages')) {
    const indexes=state.items.flatMap((p,i)=>p.selected?[String(i+1)]:[]);
    if(!indexes.length) throw Error('Выберите хотя бы одну страницу.');
    value.pages=indexes.join(',');
  }
  return value;
}
function theme(value) {
  document.documentElement.dataset.theme=value;
  drawIcon($('theme'),value==='dark'?'sun':'moon');
}
let stored;
try {stored=localStorage.getItem('pdf-studio-theme');} catch {}
theme(stored||'light');
$('theme').onclick=()=>{
  const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
  theme(next);
  try {localStorage.setItem('pdf-studio-theme',next);} catch {}
};
for(const [index,label] of ['Все инструменты',...categories].entries()) {
  const button=document.createElement('button');
  button.textContent=label;
  button.onclick=()=>{filter=index-1;renderCatalog();};
  $('filters').append(button);
}
function renderCatalog() {
  [...$('filters').querySelectorAll('button')].forEach((button,i)=>button.setAttribute('aria-pressed',String(i-1===filter)));
  const query=$('search').value.trim().toLowerCase();
  const matches=tools.filter(([key,title,desc,category])=>(filter===-1||filter===category)&&
    matchesTool([key,title,desc],query));
  $('tool-count').textContent=query||filter!==-1?'Найдено '+matches.length+' из '+tools.length:tools.length+' способов работать с PDF';
  const cards=matches.map(([key,title,desc,,icon,color])=>{
    const button=document.createElement('button');
    button.className='card';
    button.dataset.tool=key;
    button.innerHTML='<span class="tool-icon"></span><strong></strong><small></small><span aria-hidden="true" class="arrow"></span>';
    const [badge,heading,caption,arrow]=button.children;
    badge.classList.add(color);
    badge.setAttribute('aria-hidden','true');
    drawIcon(badge,icon);
    drawIcon(arrow,'arrow-up-right');
    heading.textContent=title;
    caption.textContent=desc;
    button.onclick=()=>show(key);
    return button;
  });
  if(!cards.length) {
    const empty=document.createElement('div');
    empty.className='empty';
    const title=document.createElement('h3');title.textContent='Не нашли подходящий инструмент';
    const help=document.createElement('p');help.textContent='Попробуйте «подпись», «уменьшить PDF» или откройте весь каталог.';
    const reset=document.createElement('button');reset.type='button';reset.className='secondary';reset.textContent='Показать все инструменты';
    reset.onclick=()=>{resetCatalog();$('search').focus();};
    empty.append(title,help,reset);
    cards.push(empty);
  }
  $('grid').replaceChildren(...cards);
}
function resetCatalog(){filter=-1;$('search').value='';renderCatalog();experience.catalog();}
$('search').oninput=()=>{renderCatalog();experience.catalog();};
renderCatalog();
const experience=$('quick-tools')?initExperience({tools,icons,openTool:key=>show(key),resetSearch:resetCatalog}):{remember(){},catalog(){},sync(){}};

function report(message,error=false) {
  status.className=error?'error':'';
  status.textContent=message;
}
function clearDownload() {
  if(!download) return;
  URL.revokeObjectURL(download);
  download=null;
}
function settings() {
  return Object.fromEntries([...fields].map(([key,field])=>[key,field.type==='file'?field.files[0]:field.value]));
}
function renderOptions() {
  controls.replaceChildren();
  fields.clear();
  const panel=document.createElement('div');
  panel.className='fields';
  for(const [key,label,type,value,minimum,maximum] of schemas[id]||[]) {
    if(pageTools.has(id)) continue;
    const wrapper=document.createElement('label');
    wrapper.append(label);
    const field=document.createElement(type==='select'?'select':'input');
    if(type==='select') for(const [item,name] of value) field.add(new Option(name,item));
    else {
      field.type=type;
      if(type==='file') field.accept=value;
      else field.value=value;
      if(type==='number'||type==='range') {field.min=minimum;field.max=maximum;field.step=1;field.required=true;}
      if(type==='range') field.value=value;
      if(type==='password') {field.autocomplete='off';field.maxLength=127;}
      if(type==='text') {field.maxLength=key==='pages'||key==='ranges'?2000:500;}
    }
    wrapper.append(field);
    if(['color','jpg','png','resize'].includes(id)) {
      const valueLabel=document.createElement('output');
      if(type==='range'){valueLabel.textContent=field.value;wrapper.append(valueLabel);}
      const update=()=>{if(type==='range')valueLabel.textContent=field.value;refreshAdjustments();};
      field.addEventListener('input',update);field.addEventListener('change',update);
    }
    if(key==='pages'||key==='ranges') wrapper.hidden=true;
    if(type==='text'&&minimum) {
      const hint=document.createElement('small');
      hint.className='hint';
      hint.textContent=minimum;
      wrapper.append(hint);
    }
    if(type==='number') {
      const stepper=document.createElement('div');stepper.className='number-stepper';
      for(const [caption,step] of [['−',-1],['+',1]]) {
        const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=caption;button.setAttribute('aria-label',(step<0?'Уменьшить: ':'Увеличить: ')+label);
        button.onclick=()=>{field.value=Math.max(Number(minimum),Math.min(Number(maximum),Number(field.value)+step));field.dispatchEvent(new Event('change'));};stepper.append(button);
      }
      wrapper.append(stepper);
    }
    panel.append(wrapper);
    fields.set(key,field);
  }
  if(id==='resize'){
    const refresh=()=>{const custom=fields.get('paperFormat').value==='custom';for(const key of ['widthMm','heightMm']){fields.get(key).parentElement.hidden=!custom;fields.get(key).disabled=!custom;}};
    fields.get('paperFormat').addEventListener('change',refresh);refresh();
  }
  if(id==='edit') {
    const refresh=()=>{
      const mode=fields.get('mode').value;
      for(const [key,visible] of Object.entries({text:mode==='text',size:mode==='text',color:['text','ink'].includes(mode),image:mode==='image'})) {
        fields.get(key).parentElement.style.display=visible?'':'none';
        fields.get(key).disabled=!visible;
      }
    };
    fields.get('mode').onchange=refresh;
    refresh();
  }
  controls.append(panel);
  if(['color','jpg','png'].includes(id)) {
    const presets=document.createElement('div');presets.className='color-presets';
    for(const [label,values] of [['Сбросить',{}],['Чёткий скан',{brightness:8,contrast:25,saturation:0,sharpness:35}],['Чёрно-белый',{colorMode:'bw',contrast:10}],['Тёплый',{warmth:30,saturation:110}]]) {
      const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;
      button.onclick=()=>{for(const [key,field] of fields)if(['brightness','contrast','saturation','warmth','sharpness','colorMode','threshold'].includes(key)){field.value=values[key]??({saturation:100,colorMode:'color',threshold:160}[key]??0);field.dispatchEvent(new Event('input'));}};
      presets.append(button);
    }
    controls.prepend(presets);
  }
  if(id==='crop') {
    const presets=document.createElement('div');presets.className='page-toolbar';
    for(const value of [0,10,20,40]) {const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=value===0?'Без полей':'Поля '+value+' пт';button.onclick=()=>{for(const key of ['left','top','right','bottom'])fields.get(key).value=value;};presets.append(button);}
    controls.append(presets);
  }
  if(hints[id]) {
    const hint=document.createElement('p');
    hint.className='hint';
    hint.textContent=hints[id];
    controls.append(hint);
  }
}
function sync() {
  const locked=busy;
  input.disabled=locked;
  $('workspace-tool').disabled=locked||preparing;
  $('edit-actions').inert=locked;
  $('document-tab').disabled=locked||preparing||!activeFile||!(sourceKind(activeFile)||/\.pdf$/i.test(activeFile.name));
  $('pages-tab').disabled=locked||preparing||!pageManager;
  $('close').disabled=locked;
  $('cancel').disabled=locked;
  for(const button of $('files').querySelectorAll('button')) button.disabled=locked||button.dataset.boundary==='true';
  controls.inert=locked;
  stage.inert=locked;
  $('page-manager').inert=locked;
  run.hidden=id==='view';
  run.disabled=busy||preparing||!files.length||
    (id==='merge'&&files.length<2)||(visual.has(id)&&!viewer)||(id==='form'&&!prepared?.fields.length);
  experience.sync({busy,preparing,hasFiles:Boolean(files.length),toolId:id,canRun:!run.disabled});
}
function sizeText(size) {
  if(size<1024) return size+' Б';
  if(size<1048576) return (size/1024).toFixed(1)+' КБ';
  return (size/1048576).toFixed(2)+' МБ';
}
function fileList() {
  $('files').replaceChildren(...files.map((file,index)=>{
    const row=document.createElement('li');
    const name=document.createElement('span');
    name.textContent=file.name+' · '+sizeText(file.size)+(file===activeFile?' · Открыт':'');
    row.append(name);
    const action=(caption,title,callback,boundary=false)=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='secondary';
      button.textContent=caption;
      button.setAttribute('aria-label',title+' '+file.name);
      button.title=title;
      button.dataset.boundary=boundary;
      button.onclick=callback;
      row.append(button);
    };
    if(files.length>1) action('Открыть','Предпросмотр и правки',()=>{activeFile=file;void changed();});
    if(files.length>1) for(const [delta,caption,label] of [[-1,'↑','Выше'],[1,'↓','Ниже']]) {
      action(caption,label,()=>{
        const target=index+delta;
        [files[index],files[target]]=[files[target],files[index]];
        changed();
      },index+delta<0||index+delta>=files.length);
    }
    action('×','Удалить',()=>{files.splice(index,1);const cached=visualCache.get(file);if(cached)void cached.viewer.dispose().catch(()=>{});visualCache.delete(file);pageStates.delete(file);changed();});
    return row;
  }));
}
function resetStage() {
  generation++;
  sourcePreview?.dispose();sourcePreview=null;
  viewer?.suspend?.();
  if(pageManager) void pageManager.dispose().catch(()=>{});
  pageManager=null;
  $('page-manager').replaceChildren();
  $('page-manager').hidden=true;
  viewer=null;
  prepared=null;
  preparing=false;
  stage.hidden=true;
  stage.replaceChildren();
}
function renderForm(fields) {
  if(!fields.length) {report('В этом PDF нет поддерживаемых интерактивных полей.',true);return;}
  const panel=document.createElement('div');
  panel.className='fields';
  for(const field of fields) {
    const label=document.createElement('label');
    label.textContent=field.name;
    const input=document.createElement(field.kind==='select'?'select':'input');
    if(field.kind==='checkbox') {
      input.type='checkbox';
      input.checked=field.initial=field.value;
    } else if(field.kind==='select') {
      input.multiple=field.multiple;
      const picked=Array.isArray(field.value)?field.value:[field.value];
      if(!input.multiple) input.add(new Option('—',''));
      for(const option of field.options) input.add(new Option(option,option,false,picked.includes(option)));
      field.initial=input.multiple?[...input.selectedOptions].map(option=>option.value):input.value;
    } else {
      input.type='text';
      input.value=field.initial=field.value;
    }
    field.input=input;
    label.append(input);
    panel.append(label);
  }
  stage.replaceChildren(panel);
  stage.hidden=false;
}
async function changed() {
  resetStage();
  clearDownload();
  report('');
  fileList();
  const current=generation;
  const file=files.includes(activeFile)?activeFile:files[0];
  activeFile=file;fileList();
  toolNavigation();
  if(!file) {workspaceView();sync();return;}
  preparing=true;
  sync();
  report('Открываем документ…');
  try {
    const isPdf=/\.pdf$/i.test(file.name);
    if(isPdf&&id!=='unlock') {
      const host=document.createElement('div');
      const manager=await createPages(file,id,host,pageStates.get(file),state=>pageStates.set(file,state),(message,error)=>{if(generation===current)report(message,error);},()=>['color','jpg','png','resize'].includes(id)?settings():null);
      if(generation!==current){await manager.dispose();return;}
      pageManager=manager;
      $('page-manager').replaceChildren(host);$('page-manager').hidden=false;
    }
    if(!isPdf&&sourceKind(file)) {
      const host=document.createElement('div');stage.replaceChildren(host);stage.hidden=false;
      const ready=await createSourcePreview(file,host,(message,error)=>{if(generation===current)report(message,error);},()=>generation===current);
      if(generation!==current){ready.dispose();return;}sourcePreview=ready;report('');
    } else if(visual.has(id)) {
      const cached=visualCache.get(file);
      const host=cached?.host||document.createElement('div');
      const ready=cached?.viewer||await createViewer(file,id,host,settings,(message,error)=>{if(file===activeFile) report(message,error);});
      if(generation!==current) {if(!cached)await ready.dispose();return;}
      if(cached)await ready.resume?.();
      if(generation!==current)return;
      visualCache.set(file,{host,viewer:ready});
      stage.replaceChildren(host);
      stage.hidden=false;
      viewer=ready;
      if(!status.classList.contains('error')) report('');
    } else if(['form','metadata'].includes(id)) {
      const doc=await load(file);
      if(generation!==current) return;
      report('');
      if(id==='form') {
        prepared={doc,fields:formData(doc)};
        renderForm(prepared.fields);
      } else {
        for(const [key,getter] of Object.entries({title:'getTitle',author:'getAuthor',subject:'getSubject',keywords:'getKeywords'})) fields.get(key).value=doc[getter]()||'';
      }
    }
  } catch(error) {
    if(generation===current) report(errorText(error),true);
  } finally {
    if(generation===current) {preparing=false;workspaceView();sync();}
  }
}
function errorText(error) {
  const message=error?.message||'Не удалось обработать документ.';
  if(/encrypted|password/i.test(message)) return 'PDF защищён паролем. Сохраните незашифрованную копию и попробуйте снова.';
  if(/invalid pdf|no pdf header|invalid typed array|bad pdf/i.test(message)) return 'Не удалось прочитать PDF. Проверьте файл.';
  if(/fetch|network|failed to load/i.test(message)) return 'Не удалось загрузить компонент обработки. Проверьте подключение.';
  return message;
}
function addFiles(entries) {
  if(busy||!entries.length) return;
  const accept=(formats[id]||pdfOnly).split(',');
  const supported=[...entries].filter(file=>accept.some(format=>format.startsWith('.')?
    file.name.toLowerCase().endsWith(format):file.type===format||(
      format==='image/jpeg'?/\.jpe?g$/i.test(file.name):file.name.toLowerCase().endsWith('.'+format.split('/')[1])
    )));
  if(!supported.length) {report('Выбранный формат не поддерживается этим инструментом.',true);return;}
  files=[...files,...supported];
  if(!activeFile)activeFile=supported[0];
  void changed();
  if(supported.length!==entries.length) report('Некоторые файлы пропущены из-за неподдерживаемого формата.');
}
function show(key,initial=[],preferred=0) {
  id=key;
  const [,,description,,icon,color]=toolMap.get(key);
  $('operation-title').textContent=toolMap.get(key)[1];
  $('operation-description').textContent=description;
  $('operation-icon').className='tool-icon '+color;
  drawIcon($('operation-icon'),icon);
  clearDocuments();
  files=[];
  input.value='';
  input.accept=formats[id]||pdfOnly;
  input.multiple=true;
  run.textContent=id==='merge'?'Объединить и скачать':visual.has(id)?'Сохранить PDF':'Применить и скачать';
  renderOptions();
  workspaceMode=pageTools.has(id)||id==='merge'?'pages':'document';
  toolNavigation();
  if(!initial.length){$('workspace-sidebar').hidden=false;$('toggle-settings').setAttribute('aria-expanded','true');}
  if(!dialog.open) dialog.showModal();
  experience.remember(key);
  if(initial.length) {activeFile=initial[preferred]||initial[0];addFiles(initial);}
  else void changed();
}
function close() {if(!busy) dialog.close();}
$('close').onclick=close;
$('cancel').onclick=close;
dialog.oncancel=event=>{if(busy) event.preventDefault();};
dialog.onclose=()=>{resetStage();clearDocuments();clearDownload();};
input.onchange=()=>{addFiles(input.files);input.value='';};

run.onclick=async()=>{
  if(run.disabled||busy) return;
  for(const field of fields.values()) if(!field.disabled&&!field.reportValidity()) return;
  busy=true;
  sync();
  clearDownload();
  report('Обрабатываем документ…');
  try {
    await new Promise(resolve=>setTimeout(resolve,30));
    const file=activeFile||files[0];
    const state=pageStates.get(file);
    let result;
    if(state&&pageTools.has(id)) result=await pageResult(file,state,id);
    else if(id==='merge') {
      const entries=[];
      for(const entry of files) entries.push(pageStates.has(entry)?await transformPages(entry,pageStates.get(entry)):entry);
      result=await operate(id,entries,settings(),report);
    } else if(state&&(visual.has(id)||['form','metadata'].includes(id))) {
      result=await operate(id,[file],pageSettings(file),report,viewer,prepared,sourcePreview);
      if(result.blob.type==='application/pdf') result.blob=await transformPages(new File([result.blob],result.name,{type:'application/pdf'}),state);
    } else {
      const entry=state?await transformPages(file,state):file;
      result=await operate(id,id==='images'?files:[entry],pageSettings(file),report,viewer,prepared,sourcePreview);
    }
    const message=result.note||(id==='compress'?'Готово. '+sizeText(activeFile.size)+' → '+sizeText(result.blob.size)+'.':'Готово · '+sizeText(result.blob.size));
    report(message);
    const link=document.createElement('a');
    link.className='primary';
    link.href=download=URL.createObjectURL(result.blob);
    link.download=result.name;
    link.textContent='Скачать '+result.name;
    status.className='downloads';
    status.append(link);
    if(result.blob.type==='application/pdf') {
      const next=document.createElement('button');next.type='button';next.className='secondary';next.textContent='Продолжить редактирование';
      next.onclick=()=>{const file=new File([result.blob],result.name,{type:'application/pdf'});show('edit',[file]);};status.append(next);
    }
  } catch(error) {report(errorText(error),true);}
  finally {busy=false;sync();}
};
function quick(files) {
  if(!files.length) return;
  const name=files[0].name.toLowerCase();
  const key=name.endsWith('.pdf')?(files.length>1&&[...files].every(file=>/\.pdf$/i.test(file.name))?'merge':'edit'):
    name.endsWith('.docx')?'docx':/\.(html?|txt|csv|md)$/.test(name)?'textpdf':'images';
  show(key,files);
}
$('choose').onclick=()=>$('quick-input').click();
$('quick-input').onchange=event=>{quick(event.target.files);event.target.value='';};
for(const [target,callback] of [[$('home-drop'),quick],[$('workspace-drop'),addFiles]]) {
  target.ondragover=event=>{event.preventDefault();target.classList.add('dragging');};
  target.ondragleave=()=>target.classList.remove('dragging');
  target.ondrop=event=>{event.preventDefault();event.stopPropagation();target.classList.remove('dragging');callback(event.dataTransfer.files);};
}
