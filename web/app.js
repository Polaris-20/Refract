'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime = value => {const n=Math.max(0,Math.floor(Number(value)||0)); return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
const isNative = !!window.chrome?.webview;
const audio = window.RefractAudio;
const state = { tracks:[], playlists:[], view:'all', group:null, current:null, queue:[], query:'', sort:'added', shuffle:false, repeat:0, history:[], upcoming:[], editorId:null, playlistTarget:null, mini:false };
let sequence=0, toastTimer, loadingAudio=0, dragDepth=0;
let crossfadeEnabled=localStorage.getItem('refract.crossfade')!=='false',crossfadeSeconds=Math.max(1,Math.min(12,Number(localStorage.getItem('refract.crossfadeSeconds'))||4)),autoAttempt='',autoStarting=false;
const pending=new Map();
function rpc(cmd,payload={},additional){
  if(!isNative) return previewRpc(cmd,payload);
  return new Promise((resolve,reject)=>{
    const id=String(++sequence);
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('操作用时较长，请等待导入结束。'));},300000);
    pending.set(id,{resolve,reject,timer});
    if(additional) window.chrome.webview.postMessageWithAdditionalObjects({id,cmd,payload},additional);
    else window.chrome.webview.postMessage({id,cmd,payload});
  });
}
if(isNative)window.chrome.webview.addEventListener('message',event=>{const r=event.data;if(r.eventName==='glass'){applyGlassState(r.data);return;}if(r.eventName==='desktopLyrics'){applyDesktopLyricsSettings(r.data);if(r.error)notify(r.error,true);return;}if(r.id==='desktop-state'){if(r.error&&!desktopSyncFailed){desktopSyncFailed=true;notify(r.error,true);}return;}const p=pending.get(r.id);if(!p)return;clearTimeout(p.timer);pending.delete(r.id);r.error?p.reject(new Error(r.error)):p.resolve(r.data);});
function notify(message,error=false){clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,error?10000:4500);}
function safe(fn){return async(...args)=>{try{return await fn(...args);}catch(e){notify(e.message||String(e),true);}};}
function track(id=state.current){return state.tracks.find(t=>t.id===id);}
function applyLibrary(data){
  if(!data?.tracks)return;
  state.tracks=data.tracks;state.playlists=data.playlists||[];
  state.queue=state.queue.filter(id=>track(id));state.upcoming=state.upcoming.filter(id=>track(id));
  if(state.current&&!track()){audio.pause();audio.removeAttribute('src');audio.load();state.current=null;}
  if(!state.current&&state.tracks.length){const saved=localStorage.getItem('refract.last');state.current=state.tracks.some(t=>t.id===saved)?saved:state.tracks[0].id;}
  if(!state.queue.length)state.queue=state.tracks.filter(t=>!t.missing).map(t=>t.id);
  render();renderNow();
}
function visibleTracks(){
  let list=state.tracks;
  if(state.view==='favorites')list=list.filter(t=>t.favorite);
  if(state.view.startsWith('playlist:')){const p=state.playlists.find(p=>p.id===state.view.slice(9));list=(p?.trackIds||[]).map(id=>track(id)).filter(Boolean);}
  if(state.group)list=list.filter(t=>(t[state.group.type]||unknown(state.group.type))===state.group.name);
  if(state.query){const q=state.query.toLocaleLowerCase();list=list.filter(t=>[t.title,t.artist,t.album,t.genre].some(v=>(v||'').toLocaleLowerCase().includes(q)));}
  list=[...list];
  if(state.sort==='added')list.sort((a,b)=>new Date(b.added)-new Date(a.added));
  else if(state.sort==='album')list.sort((a,b)=>(a.album||'').localeCompare(b.album||'','zh-CN')||(a.number-b.number)||a.title.localeCompare(b.title,'zh-CN'));
  else list.sort((a,b)=>(a[state.sort]||'').localeCompare(b[state.sort]||'','zh-CN',{numeric:true}));
  return list;
}
function unknown(kind){return kind==='album'?'未命名专辑':'未知歌手';}
function artwork(t,cls=''){return t?.cover?`<img class="${cls}" src="${escapeHtml(t.cover)}" alt="" loading="lazy">`:icon('note');}
function render(){
  $('#nav-count').textContent=state.tracks.length;
  const list=visibleTracks();
  const names={all:'我的音乐',albums:'专辑',artists:'歌手',favorites:'喜欢的音乐'};
  const viewName=state.view.startsWith('playlist:')?state.playlists.find(p=>p.id===state.view.slice(9))?.name||'歌单':names[state.view];
  const title=state.group?state.group.name:viewName;
  $('#breadcrumb').textContent=title;
  $('#view-title').replaceChildren(document.createTextNode(title+' '));const count=document.createElement('span');count.id='track-count';count.textContent=String(list.length).padStart(2,'0');$('#view-title').append(count);
  $$('#navigation .nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  $('#playlists').innerHTML=state.playlists.length?state.playlists.map(p=>`<button class="nav-item ${state.view===`playlist:${p.id}`?'active':''}" data-playlist="${p.id}"><span>≡</span>${escapeHtml(p.name)}</button>`).join(''):'<span class="playlist-hint">为某个时刻，留一张歌单。</span>';
  $('#hero').hidden=state.view!=='all'||!!state.query;
  $('#hero-play span').textContent=state.tracks.length?'播放我的音乐':'试听折光';
  $('#hero-detail').textContent=state.tracks.length?`${state.tracks.length} 个声音，随时为你响起。`:'三段原创声景，感受一下。';
  const grouped=['albums','artists'].includes(state.view)&&!state.group;
  $('#group-grid').hidden=!grouped;$('#track-table').hidden=grouped||!list.length;
  $('#empty-state').hidden=list.length>0;
  if(!list.length){
    const empty=$('#empty-state');
    $('strong',empty).textContent=state.query?'没有找到这个声音。':state.view==='favorites'?'给喜欢的声音，留一个位置。':state.view.startsWith('playlist:')?'这张歌单还很安静。':'你的音乐，从这里开始。';
    $('p',empty).textContent=state.query?'换一个标题、歌手或专辑名试试。':state.view==='favorites'?'点亮歌曲旁的爱心，就会出现在这里。':state.view.startsWith('playlist:')?'在歌曲右侧的菜单中，选择「加入歌单」。':'拖入音乐文件，或点击右上角导入。MP3 / FLAC / WAV / M4A 等格式。';
    $('#load-demo').hidden=state.tracks.length>0;
  }
  if(grouped){
    const kind=state.view==='albums'?'album':'artist';const groups=new Map();
    list.forEach(t=>{const name=t[kind]||unknown(kind);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(t);});
    $('#group-grid').innerHTML=[...groups].map(([name,tracks])=>`<button class="group-card" data-group="${escapeHtml(name)}" data-kind="${kind}"><div class="group-art">${artwork(tracks.find(t=>t.cover)||tracks[0])}</div><strong>${escapeHtml(name)}</strong><small>${tracks.length} 首音乐 ${kind==='album'?'· '+escapeHtml(tracks[0].artist||'未知歌手'):''}</small></button>`).join('');
  }else $('#track-list').innerHTML=list.map((t,i)=>`<div class="track-row ${t.id===state.current?'selected':''} ${t.missing?'missing':''}" data-id="${t.id}" role="button" tabindex="0" aria-label="播放 ${escapeHtml(t.title)}"><span class="row-number">${t.id===state.current?icon(audio.paused?'play':'pause'):String(i+1).padStart(2,'0')}</span><div class="row-song"><div class="row-art">${artwork(t)}</div><div><strong>${escapeHtml(t.title)}</strong><small>${t.missing?'文件已移动 · ':''}${escapeHtml(t.artist||'未知歌手')}</small></div></div><span class="row-album" title="${escapeHtml(t.album)}">${escapeHtml(t.album||'未命名专辑')}</span><span class="format-tag">${escapeHtml(t.format)}</span><span class="row-duration">${formatTime(t.duration)}</span><span class="row-actions"><button class="icon-button ${t.favorite?'favorited':''}" data-favorite="${t.id}" aria-label="${t.favorite?'取消喜欢':'喜欢'} ${escapeHtml(t.title)}" title="${t.favorite?'取消喜欢':'喜欢'}">${icon('heart')}</button><button class="icon-button" data-menu="${t.id}" aria-label="${escapeHtml(t.title)} 的更多操作" title="更多操作">${icon('more')}</button></span></div>`).join('');
  $('#play-all').disabled=!list.some(t=>!t.missing);
  const total=list.reduce((s,t)=>s+t.duration,0);$('#library-summary').textContent=`${list.length} 首音乐${list.length?' · '+(total>=3600?`${Math.floor(total/3600)} 小时 ${Math.floor(total%3600/60)} 分钟`:`${Math.floor(total/60)} 分 ${Math.floor(total%60)} 秒`):' · 等待你的第一个声音'}`;
  renderQueue();
}
let lastCover=null;
function renderNow(){
  const t=track();
  $('#now-title').textContent=t?.title||'等待一个好声音';$('#now-artist').textContent=t?(t.artist||'未知歌手'):'你的私人声场，即将开启。';
  $('#player-title').textContent=t?.title||'还没有正在播放的音乐';$('#player-artist').textContent=t?(t.artist||'未知歌手'):'让声音进来。';
  $('#now-catalog').textContent=t?`${t.format} / ${String(state.tracks.indexOf(t)+1).padStart(3,'0')} ${t.edited?'· 已整理':''}`:'REFRACT / 000';
  $('#info-album').textContent=t?.album||'—';$('#info-year').textContent=t?[t.year||'年份未知',t.genre||'流派未填写'].join(' / '):'—';
  $('#info-quality').textContent=t?`${t.format} · ${t.sampleRate?(t.sampleRate/1000).toFixed(1)+' kHz':'—'}${t.bitrate?' / '+t.bitrate+' kbps':''}`:'—';
  updateArtwork($('#now-art'),t?.cover?artwork(t):'<span class="default-cover">R<span>REFRACT<br>SOUND ARCHIVE</span></span>',t?.cover||'');
  updateArtwork($('#player-art'),artwork(t),t?.cover||'');
  ['#now-favorite','#player-favorite'].forEach(s=>{const el=$(s);el.disabled=!t;el.classList.toggle('favorited',!!t?.favorite);el.setAttribute('aria-pressed',String(!!t?.favorite));});
  $('#edit-current').disabled=!t;$('#duration').textContent=formatTime(t?.duration||0);
  $('#previous').disabled=!state.queue.length;$('#next').disabled=!state.queue.length;
  $('#toggle-play').disabled=!t;
  if((t?.cover||'')!==lastCover){lastCover=t?.cover||'';void window.RefractColors?.update(lastCover);}
  updateTransport();refreshLyrics();
}
function updateArtwork(element,markup,key){
  if(element.dataset.cover===key)return;
  const animate=element.dataset.cover!==undefined&&!document.body.classList.contains('low-effects')&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.querySelector('.art-previous')?.remove();const previous=animate?[...element.childNodes].map(node=>node.cloneNode(true)):[];
  element.innerHTML=markup;element.dataset.cover=key;
  if(previous.length){const layer=document.createElement('div');layer.className='art-previous';layer.append(...previous);element.append(layer);setTimeout(()=>layer.remove(),750);}
}
function renderQueue(){
  syncNextPreload();
  const list=state.queue.map(id=>track(id)).filter(Boolean);$('#queue-count').textContent=list.length;
  $('#queue').innerHTML=list.length?`<div class="queue-toolbar"><small>${state.shuffle?'随机播放中':'按此顺序播放'}</small><button class="text-button" data-clear-queue>清空其他</button></div><p class="queue-hint">拖动左侧手柄排序 · 选中手柄后 Alt ↑ / ↓ 移动</p>`+list.map((t,i)=>`<div class="queue-row ${t.id===state.current?'current':''}" data-queue-row="${t.id}"><button class="queue-grip" draggable="true" data-queue-drag="${t.id}" aria-label="移动 ${escapeHtml(t.title)}" title="拖动排序 / Alt ↑ ↓">⠿</button><button class="queue-play" data-queue="${t.id}" title="${escapeHtml(t.title)}"><small>${String(i+1).padStart(2,'0')}</small><span>${escapeHtml(t.title)}</span></button><button class="queue-remove" data-queue-remove="${t.id}" ${t.id===state.current?'disabled':''} aria-label="从队列移除 ${escapeHtml(t.title)}" title="${t.id===state.current?'正在播放':'从队列移除'}">×</button></div>`).join(''):'<p class="playlist-hint">播放歌曲后，这里会显示队列。</p>';
}
function moveQueue(id,targetId,after=false){
  if(id===targetId||!state.queue.includes(id)||!state.queue.includes(targetId))return;
  const list=state.queue.filter(x=>x!==id),at=list.indexOf(targetId)+(after?1:0);list.splice(at,0,id);state.queue=list;
  const wasShuffle=state.shuffle;state.shuffle=false;state.upcoming=[];state.history=[];renderQueue();updateTransport();
  if(wasShuffle)notify('已按你的排序播放，随机播放已关闭。');
}
function removeQueue(id){
  if(id===state.current)return;
  state.queue=state.queue.filter(x=>x!==id);state.upcoming=state.upcoming.filter(x=>x!==id);state.history=state.history.filter(x=>x!==id);renderQueue();
}
function clearOtherQueue(){state.queue=state.current?[state.current]:[];state.upcoming=[];state.history=[];renderQueue();notify('已清空其他待播歌曲，当前歌曲继续播放。');}
function enqueue(id,nextUp=false){
  const t=track(id);if(!t||t.missing)throw new Error('这首歌的文件不可用，无法加入队列。');
  if(id===state.current){notify('这首歌已经是当前歌曲。');return;}
  if(nextUp){
    state.queue=state.queue.filter(x=>x!==id);const index=state.queue.indexOf(state.current);state.queue.splice(index+1,0,id);
    if(state.shuffle)state.upcoming=[id,...state.upcoming.filter(x=>x!==id)];
  }else{
    if(state.queue.includes(id)){notify('这首歌已经在队列中了。');return;}
    state.queue.push(id);if(state.shuffle)state.upcoming.push(id);
  }
  renderQueue();notify(nextUp?'已设为下一首播放。':'已加入播放队列。');
}
let queueDragId=null;
function clearQueueDrag(){queueDragId=null;$$('#queue .drag-before,#queue .drag-after,#queue .dragging').forEach(el=>el.classList.remove('drag-before','drag-after','dragging'));}
$('#queue').addEventListener('dragstart',e=>{
  const handle=e.target.closest('[data-queue-drag]');if(!handle)return;
  queueDragId=handle.dataset.queueDrag;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-refract-queue',queueDragId);handle.closest('[data-queue-row]').classList.add('dragging');
});
$('#queue').addEventListener('dragover',e=>{
  if(!queueDragId)return;const row=e.target.closest('[data-queue-row]');if(!row)return;e.preventDefault();e.dataTransfer.dropEffect='move';
  $$('#queue .drag-before,#queue .drag-after').forEach(el=>el.classList.remove('drag-before','drag-after'));
  if(row.dataset.queueRow!==queueDragId)row.classList.add(e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2?'drag-after':'drag-before');
  const box=$('#queue').getBoundingClientRect();if(e.clientY<box.top+30)$('#queue').scrollTop-=14;else if(e.clientY>box.bottom-30)$('#queue').scrollTop+=14;
});
$('#queue').addEventListener('drop',e=>{
  if(!queueDragId)return;e.preventDefault();e.stopPropagation();const row=e.target.closest('[data-queue-row]');
  if(row)moveQueue(queueDragId,row.dataset.queueRow,e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2);clearQueueDrag();
});
$('#queue').addEventListener('dragend',clearQueueDrag);
$('#queue').addEventListener('keydown',e=>{
  const handle=e.target.closest('[data-queue-drag]');if(!handle||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();const id=handle.dataset.queueDrag,index=state.queue.indexOf(id),target=state.queue[index+(e.key==='ArrowUp'?-1:1)];
  if(target){moveQueue(id,target,e.key==='ArrowDown');$(`[data-queue-drag="${id}"]`)?.focus();}
});

function updateTransport(){
  const playing=!audio.paused&&!audio.ended;$('#toggle-play').innerHTML=icon(playing?'pause':'play');$('#toggle-play').setAttribute('aria-label',playing?'暂停':'播放');
  $('#playing-label').textContent=playing?(audio.crossfading?'MIXING':'NOW PLAYING'):state.current?'PAUSED':'STANDBY';
  $('#shuffle').classList.toggle('active',state.shuffle);$('#shuffle').setAttribute('aria-pressed',String(state.shuffle));
  $('#repeat').classList.toggle('active',state.repeat!==0);$('#repeat-one').hidden=state.repeat!==2;
  const repeatText=['顺序播放','列表循环','单曲循环'][state.repeat];$('#repeat').title='播放模式：'+repeatText;$('#repeat').setAttribute('aria-label',repeatText);
  const row=$('.track-row.selected .row-number');if(row)row.innerHTML=icon(playing?'pause':'play');
}
async function play(id,queue=null,recordHistory=true,automatic=false){
  const t=track(id);if(!t)return;if(t.missing)throw new Error('找不到音乐文件。请将文件放回原位置，或重新导入。');
  if(queue){state.queue=queue.filter(id=>track(id)&&!track(id).missing);state.history=[];state.upcoming=state.shuffle?shuffled(state.queue.filter(q=>q!==id)):[];}
  const token=++loadingAudio;
  try{
    const changed=await audio.switchTo(t,{
      seconds:crossfadeEnabled?(automatic?crossfadeSeconds:.35):0,
      valid:()=>token===loadingAudio&&(!automatic||(crossfadeEnabled&&state.repeat!==2&&peekNext(false)===id)),
      commit:()=>{
        if(recordHistory&&state.current&&state.current!==id)state.history.push(state.current);
        state.upcoming=state.upcoming.filter(x=>x!==id);state.current=id;localStorage.setItem('refract.last',id);
        autoAttempt='';desktopBuffering=false;render();renderNow();
      }
    });
    if(changed){updateTransport();syncNextPreload();}
  }catch(e){if(token===loadingAudio&&e.name!=='AbortError')throw new Error('这首音乐暂时无法播放。请检查文件是否存在或系统是否支持此音频编码。');}
}
async function togglePlay(){if(!track())return;if(audio.switching||!audio.paused){audio.pause();updateTransport();}else await play(state.current);}
async function playVisible(){const ids=visibleTracks().filter(t=>!t.missing).map(t=>t.id);if(!ids.length)return;await play(ids[0],ids);}
function shuffled(ids){return ids.map(id=>({id,r:Math.random()})).sort((a,b)=>a.r-b.r).map(t=>t.id);}
function peekNext(manual=false){
  const valid=id=>track(id)&&!track(id).missing;
  if(!state.queue.length)return null;
  if(state.shuffle){
    state.upcoming=state.upcoming.filter(id=>id!==state.current&&state.queue.includes(id)&&valid(id));
    if(!state.upcoming.length&&(manual||state.repeat===1))state.upcoming=shuffled(state.queue.filter(id=>id!==state.current&&valid(id)));
    return state.upcoming[0]||((manual||state.repeat===1)&&valid(state.current)?state.current:null);
  }
  const index=state.queue.indexOf(state.current),next=state.queue.slice(index+1).find(valid);
  return next||((manual||state.repeat===1)?state.queue.find(valid):null);
}
function syncNextPreload(){
  const id=state.repeat===2?null:peekNext(false);audio.setNext(id&&id!==state.current?track(id):null);
}
async function tryAutomaticTransition(){
  if(!crossfadeEnabled||autoStarting||audio.paused||audio.ended||audio.seeking||audio.switching||audio.crossfading||state.repeat===2||audio.readyState<3)return;
  const id=peekNext(false);if(!id||id===state.current)return;
  const nextDuration=audio.nextDuration(id),remaining=audio.duration-audio.currentTime;
  if(!Number.isFinite(nextDuration)||nextDuration<=0)return;
  const length=Math.min(crossfadeSeconds,audio.duration/2,nextDuration/2);
  if(!Number.isFinite(length)||length<=0||remaining<=0||remaining>length)return;
  const key=state.current+'>'+id;if(autoAttempt===key)return;autoAttempt=key;autoStarting=true;
  try{await play(id,null,true,true);}finally{autoStarting=false;}
}
async function next(manual=true){
  if(!state.queue.length||(!manual&&audio.switching))return;
  if(!manual&&state.repeat===2){audio.currentTime=0;await audio.play();return;}
  const id=peekNext(manual);
  if(id){if(id===state.current)audio.currentTime=0;await play(id);}else{audio.pause();updateTransport();}
}
async function previous(){if(audio.currentTime>3){audio.currentTime=0;return;}let id;if(state.shuffle){id=state.history.pop();}else{id=state.queue[Math.max(0,state.queue.indexOf(state.current)-1)];}if(id)await play(id,null,false);}

async function importMusic(cmd,files){
  $('#busy').hidden=false;
  try{const result=await rpc(cmd,{},files);if(result?.canceled)return;applyLibrary(result.library);if(result.errors?.length)notify(`导入 ${result.imported} 首，跳过 ${result.skipped} 首。\n${result.errors.slice(0,3).join('\n')}${result.errors.length>3?'\n另有 '+(result.errors.length-3)+' 个文件未能读取。':''}`,true);else notify(result.imported?`已加入 ${result.imported} 首音乐。${result.skipped?'跳过 '+result.skipped+' 首重复或非音乐文件。':''}`:'这些音乐已经在曲库中，或没有找到支持的音乐文件。');return result;}
  finally{$('#busy').hidden=true;}
}
async function loadDemo(){await importMusic('demo');if(state.tracks.length)await playVisible();}
async function favorite(id){applyLibrary(await rpc('favorite',{trackId:id}));}
function openEditor(id){
  const t=track(id);if(!t)return;state.editorId=id;
  for(const field of ['title','artist','album','genre','year','number'])$('#edit-form').elements[field].value=t[field]||'';
  $('#editor-file').textContent=t.fileName;$('#editor-cover').innerHTML=artwork(t);$('#editor').showModal();
  $('#write-tags').disabled=!['MP3','FLAC','M4A','OGG','WAV','AIF','AIFF'].includes(t.format);
}
async function saveEdit(close=true){
  const form=$('#edit-form');if(!form.reportValidity())return false;
  const values=Object.fromEntries(new FormData(form));values.year=Number(values.year)||0;values.number=Number(values.number)||0;
  applyLibrary(await rpc('edit',{trackId:state.editorId,...values}));if(close){$('#editor').close();notify('歌曲信息已保存到曲库。');}return true;
}
function openMenu(id,anchor){
  const menu=$('#context-menu');menu.innerHTML=`<button data-action="playNext">${icon('next')}下一首播放</button><button data-action="enqueue">${icon('plus')}加入播放队列</button><button data-action="edit">${icon('edit')}编辑歌曲信息</button><button data-action="playlist">${icon('plus')}加入歌单</button>${state.view.startsWith('playlist:')?'<button data-action="removePlaylist">从当前歌单移除</button>':''}<button data-action="remove" class="danger">从曲库移除 · 保留文件</button>`;
  menu.dataset.id=id;menu.hidden=false;
  const rect=anchor.getBoundingClientRect();menu.style.left=Math.min(rect.right-menu.offsetWidth,window.innerWidth-menu.offsetWidth-12)+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-menu.offsetHeight-110))+'px';
}
async function menuAction(action,id){
  if(action==='edit')return openEditor(id);
  if(action==='playNext')return enqueue(id,true);
  if(action==='enqueue')return enqueue(id);
  if(action==='playlist'){
    state.playlistTarget=id;
    if(!state.playlists.length){$('#playlist-dialog').showModal();notify('先为这首歌新建一张歌单。');return;}
    $('#add-to-options').innerHTML=state.playlists.map(p=>`<button class="button" data-add-playlist="${p.id}">${escapeHtml(p.name)}${p.trackIds.includes(id)?' · 已加入':''}</button>`).join('');$('#add-to-dialog').showModal();
  }else if(action==='removePlaylist'){applyLibrary(await rpc('playlistTrack',{playlistId:state.view.slice(9),trackId:id,remove:true}));notify('已从歌单移除，歌曲仍在曲库。');}
  else if(action==='remove'){applyLibrary(await rpc('remove',{trackId:id}));notify('已从曲库移除。原音乐文件仍在原处。');}
}
function setView(view){state.view=view;state.group=null;state.query='';$('#search').value='';render();$('.content-scroll').scrollTop=0;}
$('#navigation').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)setView(b.dataset.view);});
$('.brand').onclick=e=>{e.preventDefault();setView('all');};
$('#playlists').onclick=e=>{const b=e.target.closest('[data-playlist]');if(b)setView('playlist:'+b.dataset.playlist);};
$('#search').oninput=e=>{state.query=e.target.value.trim();render();};$('#sort').onchange=e=>{state.sort=e.target.value;render();};
$('#group-grid').onclick=e=>{const b=e.target.closest('[data-group]');if(b){state.group={type:b.dataset.kind,name:b.dataset.group};render();}};
$('#track-list').onclick=safe(async e=>{const favoriteButton=e.target.closest('[data-favorite]');if(favoriteButton){await favorite(favoriteButton.dataset.favorite);return;}const menuButton=e.target.closest('[data-menu]');if(menuButton){openMenu(menuButton.dataset.menu,menuButton);return;}const row=e.target.closest('[data-id]');if(row)await play(row.dataset.id,visibleTracks().filter(t=>!t.missing).map(t=>t.id));});
$('#track-list').onkeydown=e=>{if(e.target.matches('.track-row')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.target.click();}};
$('#queue').onclick=safe(async e=>{if(e.target.closest('[data-clear-queue]'))return clearOtherQueue();const remove=e.target.closest('[data-queue-remove]');if(remove)return removeQueue(remove.dataset.queueRemove);const b=e.target.closest('[data-queue]');if(b)await play(b.dataset.queue);});
['#import','#sidebar-import'].forEach(s=>$(s).onclick=safe(()=>importMusic('importFiles')));$('#folder-import').onclick=safe(()=>importMusic('importFolder'));
$('#hero-play').onclick=safe(()=>state.tracks.length?playVisible():loadDemo());$('#load-demo').onclick=safe(loadDemo);$('#play-all').onclick=safe(playVisible);
$('#toggle-play').onclick=safe(togglePlay);$('#previous').onclick=safe(previous);$('#next').onclick=safe(()=>next(true));
$('#shuffle').onclick=()=>{state.shuffle=!state.shuffle;state.upcoming=state.shuffle?shuffled(state.queue.filter(id=>id!==state.current)):[];state.history=[];autoAttempt='';syncNextPreload();renderQueue();updateTransport();notify(state.shuffle?'随机播放已开启。':'随机播放已关闭。');};
$('#repeat').onclick=()=>{state.repeat=(state.repeat+1)%3;autoAttempt='';syncNextPreload();updateTransport();notify(['播放完队列后停止。','列表循环已开启。','单曲循环已开启。'][state.repeat]);};
['#now-favorite','#player-favorite'].forEach(s=>$(s).onclick=safe(()=>state.current&&favorite(state.current)));
$('#edit-current').onclick=()=>openEditor(state.current);
$('#edit-form').onsubmit=safe(async e=>{e.preventDefault();await saveEdit();});
$('#change-cover').onclick=safe(async()=>{const data=await rpc('cover',{trackId:state.editorId});if(!data.canceled){applyLibrary(data);$('#editor-cover').innerHTML=artwork(track(state.editorId));notify('封面已更新，保存于本地曲库。');}});
$('#write-tags').onclick=safe(async()=>{
  if(!await saveEdit(false))return;
  const current=track(),wasPlaying=!audio.paused,time=audio.currentTime;
  audio.releaseTrack(state.editorId);
  try{const result=await rpc('writeTags',{trackId:state.editorId});if(!result.canceled){applyLibrary(result.library);notify('已写回音乐文件，原文件已备份：\n'+result.backup);$('#editor').close();}}
  finally{if(current?.id===state.editorId){audio.src=current.src;audio.dataset.track=current.id;audio.addEventListener('loadedmetadata',()=>{audio.currentTime=Math.min(time,audio.duration||time);if(wasPlaying)safe(()=>audio.play())();},{once:true});audio.load();}}
});
$('#new-playlist').onclick=()=>{state.playlistTarget=null;$('#playlist-form').reset();$('#playlist-dialog').showModal();};
$('#playlist-form').onsubmit=safe(async e=>{e.preventDefault();const name=$('#playlist-form').elements.name.value;applyLibrary(await rpc('createPlaylist',{name}));const newList=state.playlists.at(-1);if(state.playlistTarget){applyLibrary(await rpc('playlistTrack',{playlistId:newList.id,trackId:state.playlistTarget,remove:false}));state.playlistTarget=null;}$('#playlist-dialog').close();$('#playlist-form').reset();notify('歌单已创建。');});
$('#add-to-options').onclick=safe(async e=>{const b=e.target.closest('[data-add-playlist]');if(b){applyLibrary(await rpc('playlistTrack',{playlistId:b.dataset.addPlaylist,trackId:state.playlistTarget,remove:false}));$('#add-to-dialog').close();notify('已加入歌单。');}});
$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#context-menu').onclick=safe(async e=>{const b=e.target.closest('[data-action]');if(b){const id=$('#context-menu').dataset.id;$('#context-menu').hidden=true;await menuAction(b.dataset.action,id);}});
document.addEventListener('click',e=>{if(!e.target.closest('#context-menu')&&!e.target.closest('[data-menu]'))$('#context-menu').hidden=true;});
document.addEventListener('scroll',()=>$('#context-menu').hidden=true,true);
function selectPanel(panel){
  $$('[data-panel]').forEach(x=>x.classList.toggle('active',x.dataset.panel===panel));
  $('#song-info').hidden=panel!=='info';$('#queue').hidden=panel!=='queue';$('#lyrics-panel').hidden=panel!=='lyrics';
  $('.now-panel').classList.toggle('show-lyrics',panel==='lyrics');$('.now-panel').classList.toggle('show-queue',panel==='queue');
  if(panel==='lyrics')requestAnimationFrame(()=>syncLyrics(true));
}
$$('[data-panel]').forEach(b=>b.onclick=()=>selectPanel(b.dataset.panel));
// Window changes are serialized; a new request replaces the pending destination.
let windowMode='normal', desiredMode='normal', immersiveReturn='normal', modeTransition=null;
function applyWindowMode(data){
  windowMode=data.mode;state.mini=windowMode==='mini';state.immersive=windowMode==='immersive';
  document.body.classList.toggle('mini',state.mini);document.body.classList.toggle('immersive',state.immersive);
  $('#exit-immersive').hidden=!state.immersive;
  $('#mini').title=state.mini?'回到正常窗口':'迷你播放器';$('#mini').setAttribute('aria-label',$('#mini').title);
  if(state.immersive)selectPanel('lyrics');
}
function requestWindowMode(mode){
  if(mode==='immersive'&&desiredMode!=='immersive')immersiveReturn=desiredMode;
  desiredMode=mode;
  if(!modeTransition)modeTransition=runModeTransitions().finally(()=>{modeTransition=null;});
  return modeTransition;
}
async function runModeTransitions(){
  const shell=$('.app-shell'),exit=$('#exit-immersive');let animation;
  document.body.classList.add('mode-switching');shell.inert=true;exit.disabled=true;
  $('#context-menu').hidden=true;clearFileDrag();
  try{
    while(desiredMode!==windowMode){
      const target=desiredMode;
      const animate=!document.body.classList.contains('low-effects')&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(animate){
        animation=shell.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(6px)'}],{duration:110,easing:'ease-in',fill:'forwards'});
        await animation.finished;
      }
      const data=await rpc('window',{action:'mode',mode:target,animate});
      applyWindowMode(data);
      animation?.cancel();animation=null;
      if(animate){
        animation=shell.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
        await animation.finished;animation.cancel();animation=null;
      }
    }
  }catch(error){desiredMode=windowMode;throw error;}
  finally{
    animation?.cancel();shell.inert=false;exit.disabled=false;document.body.classList.remove('mode-switching');
    requestAnimationFrame(()=>syncLyrics(true));
    if(state.immersive)exit.focus({preventScroll:true});else $('#mini').focus({preventScroll:true});
  }
}
function immersive(on){return requestWindowMode(on?'immersive':immersiveReturn);}
$('#immersive').onclick=safe(()=>immersive(true));$('#mini-immersive').onclick=safe(()=>immersive(true));
$('#exit-immersive').onclick=safe(()=>immersive(false));
$('#mini').onclick=safe(()=>requestWindowMode(desiredMode==='mini'?'normal':'mini'));
$('#settings').onclick=()=>$('#settings-dialog').showModal();
$('#low-effects').checked=localStorage.getItem('refract.lowEffects')==='true';document.body.classList.toggle('low-effects',$('#low-effects').checked);
$('#low-effects').onchange=safe(async e=>{document.body.classList.toggle('low-effects',e.target.checked);localStorage.setItem('refract.lowEffects',e.target.checked);await syncDesktopGlass();});
function readGlassMode(){
  const saved=localStorage.getItem('refract.glassMode');
  return ['off','focused','always'].includes(saved)?saved:localStorage.getItem('refract.desktopGlass')==='false'?'off':'focused';
}
let glassMode=readGlassMode(),glassSyncSequence=0,glassRevision=0;
function renderGlassMode(){
  $$('#desktop-glass [data-glass-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.glassMode===glassMode)));
}
function applyGlassState(result){
  if(!result||result.mode!==glassMode||result.lowEffects!==$('#low-effects').checked)return;
  if(result.revision!=null&&result.revision<glassRevision)return;
  glassRevision=result.revision??glassRevision;
  document.body.classList.toggle('desktop-glass',!!result.enabled);
  $$('#desktop-glass [data-glass-mode]').forEach(button=>button.disabled=!result.supported);
  $('#glass-depth').disabled=!result.enabled;
  $('#glass-status').textContent=!result.supported?'桌面玻璃需要 Windows 11 22H2 或更新版本。':result.highContrast?'系统高对比度模式下使用实色背景。':result.lowEffects?'轻量视觉已开启，玻璃暂时关闭；所选档位已保留。':glassMode==='off'?'桌面玻璃已关闭，当前使用深色实底。':glassMode==='always'&&!result.keepSupported?'当前系统不支持保持玻璃，暂按聚焦时启动。':!result.active&&glassMode==='focused'?'窗口未聚焦，玻璃由系统渐变收起；返回窗口后渐变恢复。':result.enabled?(glassMode==='always'?'保持玻璃已启用，切换到其他窗口时仍保留。':'聚焦与失焦时，由系统自然渐变玻璃效果。')+' 系统透明与节能设置仍会影响效果。':'当前系统未能启用桌面玻璃，已使用深色背景。';
}
async function syncDesktopGlass(){
  const seq=++glassSyncSequence;
  const result=await rpc('glass',{mode:glassMode,lowEffects:$('#low-effects').checked});
  if(seq!==glassSyncSequence)return result;
  applyGlassState(result);
  return result;
}
async function setGlassMode(mode){
  if(!['off','focused','always'].includes(mode))return;
  glassMode=mode;localStorage.setItem('refract.glassMode',mode);
  renderGlassMode();return syncDesktopGlass();
}
renderGlassMode();
$$('#desktop-glass [data-glass-mode]').forEach(button=>button.onclick=safe(()=>setGlassMode(button.dataset.glassMode)));
function setGlassDepth(value){const parsed=Number(value);const depth=Number.isFinite(parsed)?Math.max(0,Math.min(60,parsed)):18;$('#glass-depth').value=depth;$('#glass-depth-value').value=depth+'%';document.body.style.setProperty('--glass-shade',depth/100);$('#glass-depth').style.setProperty('--fill',(depth/60*100)+'%');localStorage.setItem('refract.glassDepth',depth);}
setGlassDepth(localStorage.getItem('refract.glassDepth')??18);$('#glass-depth').oninput=e=>setGlassDepth(e.target.value);
function setVolume(value){const volume=Math.max(0,Math.min(100,Number(value)||0));audio.volume=volume/100;$('#volume').value=volume;$('#volume').style.setProperty('--fill',volume+'%');localStorage.setItem('refract.volume',volume);$('#mute').innerHTML=icon(audio.muted||volume===0?'mute':'volume');}
setVolume(localStorage.getItem('refract.volume')??65);$('#volume').oninput=e=>{audio.muted=false;setVolume(e.target.value);};$('#mute').onclick=()=>{audio.muted=!audio.muted;$('#mute').innerHTML=icon(audio.muted||audio.volume===0?'mute':'volume');$('#mute').setAttribute('aria-label',audio.muted?'取消静音':'静音');};
audio.addEventListener('timeupdate',()=>{if(!Number.isFinite(audio.duration))return;const ratio=audio.duration>0?audio.currentTime/audio.duration:0;$('#elapsed').textContent=formatTime(audio.currentTime);$('#seek').value=Math.round(ratio*1000);$('#seek').style.setProperty('--fill',(ratio*100)+'%');});
audio.addEventListener('loadedmetadata',()=>{$('#seek').disabled=false;$('#duration').textContent=formatTime(audio.duration);});
audio.addEventListener('emptied',()=>{$('#seek').value=0;$('#seek').disabled=true;$('#seek').style.setProperty('--fill','0%');$('#elapsed').textContent='0:00';});
audio.addEventListener('play',updateTransport);audio.addEventListener('pause',updateTransport);audio.addEventListener('ended',safe(()=>next(false)));
audio.addEventListener('error',()=>{if(audio.getAttribute('src')){notify('播放失败：文件不可访问，或系统不支持此音频编码。',true);updateTransport();}});
$('#seek').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(e.target.value)/1000*audio.duration;};
function updateCrossfadeSettings(){
  $('#crossfade-enabled').checked=crossfadeEnabled;$('#crossfade-seconds').value=crossfadeSeconds;
  $('#crossfade-seconds').disabled=!crossfadeEnabled;$('#crossfade-value').value=crossfadeSeconds+' 秒';
  $('#crossfade-seconds').style.setProperty('--fill',((crossfadeSeconds-1)/11*100)+'%');
}
updateCrossfadeSettings();
$('#crossfade-enabled').onchange=e=>{crossfadeEnabled=e.target.checked;localStorage.setItem('refract.crossfade',crossfadeEnabled);autoAttempt='';if(!crossfadeEnabled)audio.finishTransition();updateCrossfadeSettings();};
$('#crossfade-seconds').oninput=e=>{crossfadeSeconds=Number(e.target.value);localStorage.setItem('refract.crossfadeSeconds',crossfadeSeconds);autoAttempt='';updateCrossfadeSettings();};
audio.addEventListener('transitioncheck',safe(tryAutomaticTransition));
audio.addEventListener('timeupdate',safe(tryAutomaticTransition));
audio.addEventListener('transitionend',updateTransport);
audio.addEventListener('seeked',()=>{autoAttempt='';syncNextPreload();});
let engineWarningShown=false;
audio.addEventListener('enginewarning',e=>{if(!engineWarningShown){engineWarningShown=true;notify(e.detail,true);}$('#crossfade-status').textContent=e.detail;});

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){$('#context-menu').hidden=true;if(!$('dialog[open]')&&desiredMode==='immersive'){e.preventDefault();safe(()=>immersive(false))();}return;}
  if(e.key==='F11'){e.preventDefault();if(!e.repeat&&!$('dialog[open]'))safe(()=>immersive(desiredMode!=='immersive'))();return;}
  if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();return;}
  if(e.ctrlKey&&e.key.toLowerCase()==='o'){e.preventDefault();if(!$('dialog[open]'))safe(()=>importMusic('importFiles'))();return;}
  if(e.target.closest('input,textarea,select,button,dialog')||$('dialog[open]'))return;
  if(e.code==='Space'){e.preventDefault();safe(togglePlay)();}
  if((e.key==='ArrowRight'||e.key==='ArrowLeft')&&Number.isFinite(audio.duration)){e.preventDefault();audio.currentTime=Math.max(0,Math.min(audio.duration,audio.currentTime+(e.key==='ArrowRight'?5:-5)));}
});
function isFileDrag(e){return [...(e.dataTransfer?.types||[])].includes('Files');}
function overLyrics(e){return !$('#lyrics-panel').hidden&&!state.mini&&!$('dialog[open]')&&!!e.target?.closest?.('#lyrics-panel');}
function clearFileDrag(){dragDepth=0;$('#drop-overlay').hidden=true;$('#lyrics-panel').classList.remove('drag-over');}
function showFileDrag(e){
  const lyrics=overLyrics(e);
  $('#drop-overlay').hidden=lyrics;$('#lyrics-panel').classList.toggle('drag-over',lyrics);
  if(lyrics){
    $('#lyrics-drop-title').textContent=lyricsImporting?'正在导入歌词，请稍等':track()?'松手，为这首歌导入歌词':'先选择一首歌曲';
    $('#lyrics-drop-song').textContent=track()?.title||'歌词会关联到当前歌曲';
  }
  e.dataTransfer.dropEffect=lyrics&&(!state.current||lyricsImporting)?'none':'copy';
}
document.addEventListener('dragenter',e=>{if(isFileDrag(e)){e.preventDefault();dragDepth++;showFileDrag(e);}});
document.addEventListener('dragover',e=>{if(isFileDrag(e)){e.preventDefault();showFileDrag(e);}});
document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)clearFileDrag();});
document.addEventListener('dragend',clearFileDrag);window.addEventListener('blur',clearFileDrag);
document.addEventListener('keydown',e=>{if(e.key==='Escape')clearFileDrag();});
document.addEventListener('drop',safe(async e=>{
  e.preventDefault();const lyrics=overLyrics(e),id=state.current,files=[...(e.dataTransfer?.files||[])];clearFileDrag();
  if(!files.length)return;
  if(lyrics){
    if(!id)throw new Error('请先选择一首歌曲，再把歌词拖入歌词显示区。');
    if(files.length!==1)throw new Error('一次请拖入一个歌词文件，避免覆盖错歌曲。');
    if(!/\.(lrc|txt|json|srt)$/i.test(files[0].name))throw new Error('歌词区支持 LRC、SRT、JSON、TXT；音乐文件请拖到曲库区域。');
    await importLyricsForTrack('importLyricsDrop',id,files);
  }else if(files.every(file=>/\.(lrc|txt|json|srt)$/i.test(file.name))){
    notify('请打开右侧「歌词」，把歌词文件拖到歌词显示区。');
  }else await importMusic('importDrop',files);
}));

let lyricsImporting=false;
let lyricsKey=null,lyricsLoad=Promise.resolve(),lyricsData={timed:false,lines:[]},lyricsActive=-1,lyricsActiveKey='',lyricsManualUntil=0;
function refreshLyrics(){
  const t=track(),key=t?`${t.id}:${t.lyricsRevision||''}`:'';
  $('#import-lyrics').disabled=!t||lyricsImporting;
  if(key===lyricsKey){syncDesktopLyricsDocument();return lyricsLoad;}
  lyricsKey=key;lyricsData={timed:false,lines:[]};lyricsActive=-1;lyricsActiveKey='';lyricsManualUntil=0;syncDesktopLyricsDocument();
  $('#lyrics-scroll').scrollTop=0;$('#lyrics-source').textContent='';
  $('#lyrics-kind').textContent='LYRICS / LOCAL';$('#import-lyrics').textContent='导入歌词 ↗';
  $('#lyrics-hint').textContent='可拖入歌词文件 · 随这首歌保存在本地';
  $('#lyrics-scroll').innerHTML='<p class="lyrics-empty">'+(!t?'先选一首喜欢的歌。':t.hasLyrics?'正在打开歌词…':'给声音，添上文字。')+'<small>支持 LRC / SRT / JSON / TXT<br>拖到这里即可导入</small></p>';
  lyricsLoad=(async()=>{
    if(!t?.hasLyrics)return;
    try{
      const result=await rpc('getLyrics',{trackId:t.id});
      if(lyricsKey!==key)return;
      lyricsData=RefractLyrics.parse(result.text,result.name);syncDesktopLyricsDocument();
      $('#lyrics-kind').textContent=lyricsData.timed?'SYNC / 同步歌词':'TEXT / 纯文本';
      $('#lyrics-source').textContent=result.name;$('#lyrics-source').title=result.name;
      $('#import-lyrics').textContent='更换歌词 ↗';
      $('#lyrics-hint').textContent=lyricsData.timed?'点击歌词跳转 · 手动滚动后 5 秒恢复跟随':'没有时间轴，可自由滚动阅读';
      const fragment=document.createDocumentFragment();
      lyricsData.lines.forEach((line,index)=>{
        const el=document.createElement(lyricsData.timed?'button':'p');el.className='lyric-line';el.textContent=line.text||'···';
        if(lyricsData.timed){el.type='button';el.dataset.lyric=index;el.title='跳转到 '+formatTime(line.time);}
        fragment.append(el);
      });
      $('#lyrics-scroll').replaceChildren(fragment);syncLyrics(true);
    }catch(e){if(lyricsKey!==key)return;$('#lyrics-scroll').textContent='歌词无法读取，请重新导入。';lyricsKey=null;notify(e.message,true);}
  })();return lyricsLoad;
}
function syncLyrics(force=false){
  if(!lyricsData.timed)return;
  const time=audio.dataset.track===state.current?audio.currentTime:0;
  const indices=RefractLyrics.activeIndices(lyricsData.lines,time),index=indices.at(-1)??-1,key=indices.join(','),changed=key!==lyricsActiveKey;
  if(changed){
    $$('.lyric-line.active').forEach(row=>{row.classList.remove('active');row.removeAttribute('aria-current');});
    for(const active of indices){const row=$(`[data-lyric="${active}"]`);if(row){row.classList.add('active');row.setAttribute('aria-current','true');}}
    lyricsActive=index;lyricsActiveKey=key;
  }
  const row=$(`[data-lyric="${index}"]`),container=$('#lyrics-scroll');
  const resume=lyricsManualUntil>0&&Date.now()>=lyricsManualUntil;
  if((changed||force||resume)&&row&&(!lyricsManualUntil||resume||force)&&container.clientHeight){
    lyricsManualUntil=0;
    const top=container.scrollTop+row.getBoundingClientRect().top-container.getBoundingClientRect().top-(container.clientHeight-row.offsetHeight)/2;
    container.scrollTo({top:Math.max(0,top),behavior:document.body.classList.contains('low-effects')||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
}
async function seekLyric(index){
  const id=state.current,key=lyricsKey,line=lyricsData.lines[index];if(!lyricsData.timed||!line)return;
  await play(id);
  if(state.current!==id||lyricsKey!==key)return;
  if(Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(audio.duration,line.time));
  lyricsManualUntil=0;syncLyrics(true);
}
$('#lyrics-scroll').onclick=safe(async e=>{const row=e.target.closest('[data-lyric]');if(row)await seekLyric(Number(row.dataset.lyric));});
['wheel','pointerdown','keydown'].forEach(name=>$('#lyrics-scroll').addEventListener(name,()=>{lyricsManualUntil=Date.now()+5000;},{passive:true}));
async function importLyricsForTrack(cmd,id,files){
  if(lyricsImporting)throw new Error('正在导入歌词，请稍等。');
  lyricsImporting=true;$('#import-lyrics').disabled=true;
  try{
    const result=await rpc(cmd,{trackId:id},files);if(result.canceled)return;
    applyLibrary(result);await refreshLyrics();
    notify('歌词已保存到「'+(track(id)?.title||'这首歌')+'」。');
  }finally{lyricsImporting=false;$('#import-lyrics').disabled=!track();}
}
$('#import-lyrics').onclick=safe(async()=>{if(state.current)await importLyricsForTrack('importLyrics',state.current);});
audio.addEventListener('timeupdate',()=>syncLyrics());audio.addEventListener('seeked',()=>syncLyrics());
window.addEventListener('resize',()=>requestAnimationFrame(()=>syncLyrics(true)));

// Desktop lyrics use an independent native window and a clock anchored to media events.
let desktopLyricsSettings={enabled:false,locked:false,fontSize:28},desktopDocument='',desktopSyncFailed=false,desktopBuffering=false;
function applyDesktopLyricsSettings(data){
  desktopLyricsSettings=data;
  $('#desktop-lyrics-enabled').checked=data.enabled;$('#desktop-lyrics-locked').checked=data.locked;
  $('#desktop-lyrics-size').value=data.fontSize;$('#desktop-lyrics-size-value').value=data.fontSize;
  syncDesktopLyricsClock();
}
function sendDesktop(cmd,payload){
  if(isNative)window.chrome.webview.postMessage({id:'desktop-state',cmd,payload});
}
function syncDesktopLyricsDocument(){
  const t=track();
  const payload={song:lyricsKey||'',title:t?.title||'折光 · REFRACT',artist:t?.artist||'选择一首音乐',timed:lyricsData.timed,
    lines:lyricsData.timed?lyricsData.lines.map(line=>({time:line.time,end:line.end,text:line.text})):[]};
  const signature=JSON.stringify(payload);if(signature===desktopDocument)return;desktopDocument=signature;
  sendDesktop('desktopLyricsDocument',payload);syncDesktopLyricsClock();
}
function syncDesktopLyricsClock(){
  if(!desktopLyricsSettings.enabled)return;
  const current=audio.dataset.track===state.current;
  sendDesktop('desktopLyricsSync',{song:lyricsKey||'',time:current&&Number.isFinite(audio.currentTime)?audio.currentTime:0,
    duration:current&&Number.isFinite(audio.duration)?audio.duration:0,
    playing:current&&!audio.paused&&!audio.ended&&!audio.seeking&&!desktopBuffering&&audio.readyState>=3});
}
async function configureDesktopLyrics(p){
  if(!isNative)throw new Error('桌面悬浮歌词需要打开 Windows 版 Refract.exe。');
  const previous={...desktopLyricsSettings};
  try{applyDesktopLyricsSettings(await rpc('desktopLyrics',p));syncDesktopLyricsDocument();syncDesktopLyricsClock();}
  catch(error){applyDesktopLyricsSettings(previous);throw error;}
}
$('#desktop-lyrics-enabled').onchange=safe(e=>configureDesktopLyrics({enabled:e.target.checked}));
$('#desktop-lyrics-locked').onchange=safe(e=>configureDesktopLyrics({locked:e.target.checked}));
$('#desktop-lyrics-size').oninput=e=>$('#desktop-lyrics-size-value').value=e.target.value;
$('#desktop-lyrics-size').onchange=safe(e=>configureDesktopLyrics({fontSize:Number(e.target.value)}));
$('#desktop-lyrics-reset').onclick=safe(()=>configureDesktopLyrics({reset:true}));
window.addEventListener('refract-theme',e=>sendDesktop('desktopLyricsAccent',{rgb:e.detail.accent}));
['timeupdate','pause','ended','seeking','seeked','loadedmetadata','ratechange'].forEach(event=>audio.addEventListener(event,syncDesktopLyricsClock));
audio.addEventListener('waiting',()=>{desktopBuffering=true;syncDesktopLyricsClock();});
['playing','canplay','emptied'].forEach(event=>audio.addEventListener(event,()=>{desktopBuffering=false;syncDesktopLyricsClock();}));
window.addEventListener('pagehide',()=>sendDesktop('desktopLyricsSync',{song:lyricsKey||'',time:audio.currentTime||0,duration:0,playing:false}));
if(!isNative){$$('.desktop-lyrics-options input,.desktop-lyrics-options button').forEach(el=>el.disabled=true);$('#desktop-lyrics-status').textContent='桌面悬浮歌词仅在 Windows 版中可用。';}

let previewData={tracks:[],playlists:[]};
const ready=safe(async()=>{const data=await rpc('init');if(data.desktopLyrics)applyDesktopLyricsSettings(data.desktopLyrics);applyLibrary(data.library);if(data.window){applyWindowMode(data.window);desiredMode=windowMode;}await syncDesktopGlass();if(data.warning)notify(data.warning,true);})();

// A dependency-free browser preview uses bundled demo files only. Native imports and tagging stay inside the Windows host.
async function previewRpc(cmd,p){
  if(cmd==='glass')return {supported:false,enabled:false,mode:p.mode,lowEffects:p.lowEffects};
  if(cmd==='init')return {library:previewData,version:'0.1.0-preview'};
  if(cmd==='demo'){const demos=await fetch('assets/demo/catalog.json').then(r=>r.json());const before=previewData.tracks.length;demos.forEach(t=>{if(!previewData.tracks.some(a=>a.id===t.id))previewData.tracks.push(t);});return {library:previewData,imported:previewData.tracks.length-before,skipped:before,errors:[]};}
  const t=previewData.tracks.find(t=>t.id===p.trackId);
  if(cmd==='favorite'){t.favorite=!t.favorite;return previewData;}
  if(cmd==='edit'){Object.assign(t,p,{edited:true});return previewData;}
  if(cmd==='createPlaylist'){previewData.playlists.push({id:crypto.randomUUID(),name:p.name,trackIds:[]});return previewData;}
  if(cmd==='playlistTrack'){const list=previewData.playlists.find(l=>l.id===p.playlistId);if(p.remove)list.trackIds=list.trackIds.filter(id=>id!==p.trackId);else if(!list.trackIds.includes(p.trackId))list.trackIds.push(p.trackId);return previewData;}
  if(cmd==='remove'){previewData.tracks=previewData.tracks.filter(t=>t.id!==p.trackId);previewData.playlists.forEach(l=>l.trackIds=l.trackIds.filter(id=>id!==p.trackId));return previewData;}
  if(cmd==='window'){const mode=p.mode||windowMode;return {mode,mini:mode==='mini',immersive:mode==='immersive'};}
  throw new Error('这是界面预览。请打开 Refract.exe 导入和整理你自己的音乐。');
}

// Opt-in native integration harness, invoked only by the desktop host with --ui-test.
window.runNativeTests=async()=>{
  const checks=[];const check=(name,ok)=>{checks.push({name,passed:!!ok});if(!ok)throw new Error(name);};
  try{
    await ready;check('native bridge initialized',isNative);
    const initialGlass=await syncDesktopGlass();
    if(initialGlass.supported){
      check('desktop acrylic enabled through DWM',initialGlass.enabled&&initialGlass.backdrop===3&&initialGlass.hresult===0&&initialGlass.frameResult===0);
      check('text and controls keep full window opacity',initialGlass.windowOpacity===1);
      const solid=await setGlassMode('off');
      check('glass switch restores solid window',!solid.enabled&&solid.backdrop===1&&!document.body.classList.contains('desktop-glass'));
      await setGlassMode('focused');
      check('glass switch restores transparent surface',document.body.classList.contains('desktop-glass')&&getComputedStyle(document.body).backgroundColor.startsWith('rgba'));
      const previousDepth=$('#glass-depth').value;setGlassDepth(0);check('clear glass depth uses zero surface tint',getComputedStyle(document.body).backgroundColor.endsWith(', 0)'));
      setGlassDepth(60);check('dark glass depth reaches 60 percent',getComputedStyle(document.body).backgroundColor.endsWith(', 0.6)'));setGlassDepth(previousDepth);
    }
    const result=await rpc('demo');applyLibrary(result.library);check('three playable demo tracks imported',state.tracks.length===3);
    const repeated=await rpc('demo');check('duplicate import adds zero tracks',repeated.imported===0&&repeated.skipped===3);
    const t=state.tracks[0];check('metadata and artwork extracted',t.artist==='REFRACT'&&!!t.cover&&t.duration>15);
    const response=await fetch(t.src,{headers:{Range:'bytes=0-15'}});check('audio range request returns 206 and 16 bytes',response.status===206&&(await response.arrayBuffer()).byteLength===16);
    const suffix=await fetch(t.src,{headers:{Range:'bytes=-12'}});check('suffix range returns 12 bytes',suffix.status===206&&(await suffix.arrayBuffer()).byteLength===12);
    const badRange=await fetch(t.src,{headers:{Range:'bytes=9999999999-'}});check('out of bounds range rejected',badRange.status===416);
    audio.muted=true;await play(t.id,state.tracks.map(t=>t.id));await new Promise(r=>setTimeout(r,550));check('native audio clock advances',audio.currentTime>0.1&&!audio.paused);
    audio.currentTime=8;await new Promise(r=>setTimeout(r,250));check('seek works',audio.currentTime>=8&&audio.currentTime<10);
    await next();check('next changes track',state.current!==t.id);audio.pause();check('pause works',audio.paused);
    applyLibrary(await rpc('favorite',{trackId:t.id}));check('favorite saved',track(t.id).favorite);applyLibrary(await rpc('favorite',{trackId:t.id}));
    applyLibrary(await rpc('edit',{trackId:t.id,title:'测试 <b>不执行 HTML</b>',artist:t.artist,album:t.album,genre:t.genre,year:t.year,number:t.number}));check('metadata safely rendered as text',$('#track-list').textContent.includes('<b>不执行 HTML</b>')&&!$('#track-list b'));
    const reload=await rpc('init');check('edit persists across bridge reload',reload.library.tracks.find(x=>x.id===t.id).title.includes('<b>'));
    applyLibrary(await rpc('edit',{trackId:t.id,title:t.title,artist:t.artist,album:t.album,genre:t.genre,year:t.year,number:t.number}));
    if(!state.playlists.length)applyLibrary(await rpc('createPlaylist',{name:'夜间航线'}));const p=state.playlists[0];
    applyLibrary(await rpc('playlistTrack',{playlistId:p.id,trackId:t.id,remove:false}));applyLibrary(await rpc('playlistTrack',{playlistId:p.id,trackId:t.id,remove:false}));check('playlist insertion is deduplicated',state.playlists[0].trackIds.length===1);
    state.query='不存在的曲目_987';render();check('search empty state visible',!$('#empty-state').hidden);state.query='';state.view='albums';render();check('album view is populated',$$('#group-grid .group-card').length>0);state.view='all';render();
    const originals=new Set(state.tracks.map(t=>t.id));
    const formats=await rpc('testFormats');applyLibrary(formats.library);
    for(const f of state.tracks.filter(t=>!originals.has(t.id))){
      await play(f.id);await new Promise(r=>setTimeout(r,350));check(`${f.format} native playback advances`,audio.currentTime>0.05&&!audio.paused);
      audio.currentTime=3;await new Promise(r=>setTimeout(r,150));check(`${f.format} seek works`,audio.currentTime>=3);audio.pause();
      applyLibrary(await rpc('remove',{trackId:f.id}));
    }
    await play(t.id,state.tracks.map(t=>t.id));audio.pause();audio.currentTime=7;audio.muted=false;
    $('#low-effects').click();await syncDesktopGlass();check('lightweight mode disables desktop glass',document.body.classList.contains('low-effects')&&!document.body.classList.contains('desktop-glass'));$('#low-effects').click();await syncDesktopGlass();
    $('#settings-dialog').showModal();const settingsBounds=$('#settings-dialog').getBoundingClientRect();
    check('glass settings stay within viewport',settingsBounds.top>=0&&settingsBounds.bottom<=innerHeight+1&&!!$('#desktop-glass')&&!!$('#glass-depth'));$('#settings-dialog').close();
    openEditor(t.id);
    const dialogBounds=$('#editor').getBoundingClientRect();check('editor opens inside viewport',$('#editor').open&&dialogBounds.top>=0&&dialogBounds.bottom<=innerHeight+1);
    await rpc('testCapture',{name:'editor'});
    $('#edit-form').elements.title.value=t.title+' · 表单测试';$('#edit-form').requestSubmit();
    for(let i=0;i<30&&$('#editor').open;i++)await new Promise(r=>setTimeout(r,50));
    check('editor submit saves and closes',!$('#editor').open&&track(t.id).title.endsWith('表单测试'));
    openEditor(t.id);$('#edit-form').elements.title.value=t.title;$('#edit-form').requestSubmit();
    for(let i=0;i<30&&$('#editor').open;i++)await new Promise(r=>setTimeout(r,50));
    $('#mini').click();for(let i=0;i<30&&!state.mini;i++)await new Promise(r=>setTimeout(r,50));
    await new Promise(r=>setTimeout(r,200));const miniBounds=$('.player').getBoundingClientRect();
    check('native mini mode keeps player visible',state.mini&&miniBounds.left>=0&&miniBounds.right<=innerWidth+1&&miniBounds.bottom<=innerHeight+1);
    await rpc('testCapture',{name:'mini'});
    $('#mini').click();for(let i=0;i<30&&state.mini;i++)await new Promise(r=>setTimeout(r,50));
    check('mini mode restores full window',!state.mini&&innerWidth>=990);
    await immersive(true);check('immersive mode opens',document.body.classList.contains('immersive')&&!$('#exit-immersive').hidden);await rpc('testCapture',{name:'immersive'});await immersive(false);
    applyLibrary(await rpc('testLyrics',{trackId:t.id,kind:'timed'}));await refreshLyrics();selectPanel('lyrics');
    check('LRC import has synchronized bilingual rows',lyricsData.timed&&lyricsData.lines[1].text.includes('Leave the night')&&lyricsData.lines[0].time===.5);
    check('lyrics HTML is shown as harmless text',$('#lyrics-scroll').textContent.includes('<b>文字不会执行</b>')&&!$('#lyrics-scroll b'));
    audio.currentTime=7;await new Promise(r=>setTimeout(r,200));syncLyrics(true);
    check('lyrics highlight follows seek',lyricsActive===2&&$('.lyric-line.active').textContent.includes('文字不会执行'));
    await seekLyric(1);audio.pause();check('clicking a lyric seeks audio',audio.currentTime>=3.5&&audio.currentTime<4);
    await seekLyric(7);audio.pause();await new Promise(r=>setTimeout(r,450));
    check('lyrics scroll follows late timestamps',$('#lyrics-scroll').scrollTop>40&&lyricsActive===7);
    const lyricBounds=$('#lyrics-scroll').getBoundingClientRect(),playerTop=$('.player').getBoundingClientRect().top;
    check('lyrics panel fits above playback controls',lyricBounds.height>=100&&lyricBounds.bottom<=playerTop);
    await rpc('testCapture',{name:'lyrics'});
    await play(state.tracks[1].id);audio.pause();await refreshLyrics();
    check('switching songs clears previous lyrics',!lyricsData.lines.length&&!$('.lyric-line.active'));
    await play(t.id);audio.pause();await refreshLyrics();check('switching back restores imported lyrics',lyricsData.timed&&lyricsData.lines.length===8);
    applyLibrary(await rpc('testLyrics',{trackId:t.id,kind:'plain'}));await refreshLyrics();
    check('TXT replacement preserves literal timestamps without seeking',!lyricsData.timed&&$('#lyrics-scroll').textContent.includes('[00:04.00]')&&!$('[data-lyric]'));
    applyLibrary(await rpc('testLyrics',{trackId:t.id,kind:'timed'}));await refreshLyrics();
    audio.currentTime=4;await new Promise(r=>setTimeout(r,150));immersive(true);await new Promise(r=>setTimeout(r,400));
    const immersiveLyrics=$('#lyrics-scroll').getBoundingClientRect();
    check('immersive lyrics are visible within viewport',immersiveLyrics.width>200&&immersiveLyrics.height>100&&immersiveLyrics.bottom<innerHeight-80);
    await rpc('testCapture',{name:'immersive'});immersive(false);selectPanel('lyrics');
    $('#toast').hidden=true;
    window.nativeTestResult={passed:true,checks};
  }catch(e){window.nativeTestResult={passed:false,error:e.message,checks};audio.pause();}
};
