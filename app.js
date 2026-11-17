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
    if(type==='text'&&minimum) {
      const hint=document.createElement('small');
      hint.className='hint';
      hint.textContent=minimum;
      wrapper.append(hint);
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
    name.textContent=file.name+' · '+sizeText(file.size);
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
  if(viewer) void viewer.dispose().catch(()=>{});
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
  const file=files[0];
  if(!file||!(visual.has(id)||['form','metadata'].includes(id))) {sync();return;}
  preparing=true;
  sync();
  report('Открываем документ…');
  try {
    if(visual.has(id)) {
      const host=document.createElement('div');
      const ready=await createViewer(file,id,host,settings,(message,error)=>{if(generation===current) report(message,error);});
      if(generation!==current) {await ready.dispose();return;}
      stage.replaceChildren(host);
      stage.hidden=false;
      viewer=ready;
      if(!status.classList.contains('error')) report('');
    } else {
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
  files=many.has(id)?[...files,...supported]:[supported[0]];
  void changed();
  if(supported.length!==entries.length) report('Некоторые файлы пропущены из-за неподдерживаемого формата.');
}
function show(key,initial=[]) {
  id=key;
  const [,,description,,icon,color]=toolMap.get(key);
  $('operation-title').textContent=toolMap.get(key)[1];
  $('operation-description').textContent=description;
  $('operation-icon').className='tool-icon '+color;
  drawIcon($('operation-icon'),icon);
  files=[];
  input.value='';
  input.accept=formats[id]||pdfOnly;
  input.multiple=many.has(id);
  run.textContent=visual.has(id)?'Сохранить PDF':'Обработать';
  renderOptions();
  if(!dialog.open) dialog.showModal();
  if(initial.length) addFiles(initial);
  else void changed();
}
function close() {if(!busy) dialog.close();}
$('close').onclick=close;
$('cancel').onclick=close;
dialog.oncancel=event=>{if(busy) event.preventDefault();};
dialog.onclose=()=>{resetStage();clearDownload();};
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
    const result=await operate(id,files,settings(),report,viewer,prepared);
    const message=result.note||(id==='compress'?'Готово. '+sizeText(files[0].size)+' → '+sizeText(result.blob.size)+'.':'Готово · '+sizeText(result.blob.size));
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
