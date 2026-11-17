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
let activeFile=null, pageManager=null;
const pageStates=new Map(), visualCache=new Map();
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
theme(stored||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
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
  [...$('filters').children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i-1===filter)));
  const query=$('search').value.trim().toLowerCase();
  const matches=tools.filter(([,title,desc,category])=>(filter===-1||filter===category)&&
    query.split(/\s+/).every(word=>(title+' '+desc).toLowerCase().includes(word)));
  $('tool-count').textContent=query||filter!==-1?'Найдено '+matches.length+' из '+tools.length:tools.length+' способов работать с PDF';
  const cards=matches.map(([key,title,desc,,icon,color])=>{
    const button=document.createElement('button');
    button.className='card';
    button.innerHTML='<span class="tool-icon"></span><strong></strong><small></small><span aria-hidden="true" class="arrow"></span>';
    const [badge,heading,caption,arrow]=button.children;
    badge.classList.add(color);
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
    empty.textContent='Инструмент не найден.';
    cards.push(empty);
  }
  $('grid').replaceChildren(...cards);
}
$('search').oninput=renderCatalog;
renderCatalog();

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
      if(type==='number') {field.min=minimum;field.max=maximum;field.required=true;}
      if(type==='password') {field.autocomplete='off';field.maxLength=127;}
      if(type==='text') {field.maxLength=key==='pages'||key==='ranges'?2000:500;}
    }
    wrapper.append(field);
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
  $('close').disabled=locked;
  $('cancel').disabled=locked;
  for(const button of $('files').querySelectorAll('button')) button.disabled=locked||button.dataset.boundary==='true';
  controls.inert=locked;
  stage.inert=locked;
  $('page-manager').inert=locked;
  run.hidden=id==='view';
  run.disabled=busy||preparing||!files.length||
    (id==='merge'&&files.length<2)||(visual.has(id)&&!viewer)||(id==='form'&&!prepared?.fields.length);
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
    action('×','Удалить',()=>{files.splice(index,1);changed();});
    return row;
  }));
}
function resetStage() {
  generation++;
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
  if(!file) {sync();return;}
  preparing=true;
  sync();
  report('Открываем документ…');
  try {
    const isPdf=/\.pdf$/i.test(file.name);
    if(isPdf&&id!=='unlock') {
      const host=document.createElement('div');
      const manager=await createPages(file,id,host,pageStates.get(file),state=>pageStates.set(file,state),(message,error)=>{if(generation===current)report(message,error);});
      if(generation!==current){await manager.dispose();return;}
      pageManager=manager;
      $('page-manager').replaceChildren(host);$('page-manager').hidden=false;
    }
    if(visual.has(id)) {
      const cached=visualCache.get(file);
      const host=cached?.host||document.createElement('div');
      const ready=cached?.viewer||await createViewer(file,id,host,settings,(message,error)=>{if(file===activeFile) report(message,error);});
      if(generation!==current) {if(!cached)await ready.dispose();return;}
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
    if(generation===current) {preparing=false;sync();}
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
function show(key,initial=[]) {
  id=key;
  const [,,description,,icon,color]=toolMap.get(key);
  $('operation-title').textContent=toolMap.get(key)[1];
  $('operation-description').textContent=description+' · Можно добавить несколько файлов. Кнопка «Открыть» переключает документ.';
  $('operation-icon').className='tool-icon '+color;
  drawIcon($('operation-icon'),icon);
  clearDocuments();
  files=[];
  input.value='';
  input.accept=formats[id]||pdfOnly;
  input.multiple=true;
  run.textContent=id==='merge'?'Объединить файлы':visual.has(id)?'Сохранить PDF':'Обработать открытый файл';
  renderOptions();
  if(!dialog.open) dialog.showModal();
  if(initial.length) addFiles(initial);
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
      result=await operate(id,[file],pageSettings(file),report,viewer,prepared);
      if(result.blob.type==='application/pdf') result.blob=await transformPages(new File([result.blob],result.name,{type:'application/pdf'}),state);
    } else {
      const entry=state?await transformPages(file,state):file;
      result=await operate(id,id==='images'?files:[entry],pageSettings(file),report,viewer,prepared);
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
