export function planBulkRange({start,end,daily,times,now=Date.now(),existing=[]}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start)throw new Error('終了日は開始日以降を選んでください');
  if(![2,3].includes(Number(daily)))throw new Error('1日2本または3本を選んでください');
  const hours=parseHours(times,Number(daily));
  const days=Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
  if(!Number.isInteger(days)||days<1||days>366)throw new Error('指定期間は最大366日です');
  const occupied=new Set(existing.map(p=>p.date+' '+p.time));
  const slots=[],used=[],past=[];
  for(let d=0;d<days;d++)for(const time of hours){
    const day=isoDay(start,d),entry={date:day,time},id=day+' '+time;
    if(occupied.has(id))used.push(entry);
    else if(Date.parse(day+'T'+time+':00+09:00')<=now+15*60*1000)past.push(entry);
    else slots.push(entry);
  }
  return {days,total:days*Number(daily),booked:used.length,expired:past.length,available:slots.length,slots,used,past};
}
/* Bulk scheduling: one Buffer channel per batch; no SNS dispatch until explicitly enabled. */
const htmlEscape = value => String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dayJst = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const nextJst = () => {const d=new Date(dayJst()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const isoDay = (start,add) => {const d=new Date(start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+add);return d.toISOString().slice(0,10);};
function parseHours(text,n){
  const times=String(text).split(/[,\s、]+/).map(x=>x.trim()).filter(Boolean);
  if(times.length!==n||times.some(x=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))throw new Error('投稿時刻は '+n+' 件を HH:MM 形式で入力してください');
  if(new Set(times).size!==times.length)throw new Error('投稿時刻が重複しています');
  return times.sort();
}
function validMini(value){return /^#[^\s#]+(?:\s+#[^\s#]+){2}$/.test(value.trim());}
export function createBulkManager({getStore,getPosts,getLibrary,notify,onSaved}){
  let files=[],items=[],busy=false;
  let state={channel:'tiktok',start:nextJst(),end:isoDay(nextJst(),6),daily:3,times:'10:00,15:00,20:00',mini:'#歌い手 #歌ってみた #shorts',roller:''};
  const labels={tiktok:'TikTok',instagram:'Instagram Reels',shorts:'YouTube Shorts'};
  function pull(){
    const ids={channel:'bulkChannel',start:'bulkStart',end:'bulkEnd',daily:'bulkDaily',times:'bulkTimes',mini:'bulkMini',roller:'bulkRoller'};
    for(const [name,id] of Object.entries(ids)){const el=document.getElementById(id);if(el)state[name]=el.value;}
    state.daily=Number(state.daily);
  }
  function existingOn(channel,date){
    return getPosts().filter(p=>p.stage==='scheduled'&&p.date===date&&p.kind==='vertical'&&(p.targets?.[channel]!==false)&&p.statuses?.[channel]!=='skipped');
  }
  function getSummary(){
    return planBulkRange({...state,existing:getPosts().filter(p=>p.kind==='vertical'&&p.stage==='scheduled'&&p.targets?.[state.channel]!==false&&p.statuses?.[state.channel]!=='skipped')});
  }
  function getDates(){
    const completed=new Set(items.filter(i=>i.done).map(i=>i.date+' '+i.time));
    const open=getSummary().slots.filter(slot=>!completed.has(slot.date+' '+slot.time));
    if(items.filter(i=>!i.done).length>open.length)throw new Error('指定期間の空き枠は'+open.length+'件です。動画を減らすか期間を延ばしてください');
    let cursor=0;return items.map(item=>item.done?{date:item.date,time:item.time}:open[cursor++]);
  }
  function view(){
    const intro='<div class="notice">過去のYouTube ShortsをTikTokに移す場合は「TikTokのみ」を選択します。ほかのSNS、X、LINEには投稿しません。無料Bufferのキューは各SNS最大10件なので、実行を有効にした後は空き枠へ順番に補充されます。</div>';
    let summaryText='';
    try{const summary=getSummary();
      summaryText='<div class="notice" style="margin:12px 0"><strong>指定期間：'+summary.days+'日 × '+state.daily+'本 = 合計 '+summary.total+'枠</strong>'
      +'<div class="small">同時刻の予約：'+summary.booked+'枠 / 過去・直前：'+summary.expired+'枠 / 新規可能：'+summary.available+'枠</div>'
      +'<div class="small">今回選択：'+items.filter(i=>!i.done).length+'本。不足分は同じ期間で後から追加できます。</div></div>';
    }catch(e){summaryText='<div class="notice">期間設定エラー：'+htmlEscape(e.message)+'</div>';}
    let table='';
    if(items.length){
      let plan=[],error='';
      try{plan=getDates();}catch(e){error=e.message;}
      table='<div class="panel" style="margin-top:18px;padding:18px"><h3>アップロード予定 '+items.length+' 本</h3>'
        +(error?'<div class="notice">'+htmlEscape(error)+'</div>':'')
        +'<div class="table-wrap"><table class="table"><thead><tr><th>順番・ファイル</th><th>タイトル</th><th>予約日時（JST）</th><th>サムネイル位置</th></tr></thead><tbody>'
        +items.map((item,index)=>'<tr><td><strong>'+(index+1)+'.</strong> '+htmlEscape(item.file.name)
          +(item.done?'<br><span class="pill pill-green">保存済み</span>':'')+'</td><td><input class="bulkTitle" data-index="'+index+'" value="'+htmlEscape(item.title)+'" maxlength="150" style="max-width:250px"/></td>'
          +'<td>'+(plan[index]?htmlEscape(plan[index].date+' '+plan[index].time):'—')+'</td>'
          +'<td><button type="button" class="btn btn-white btn-small" data-bulk-thumb="'+index+'">秒数を指定</button><div class="small muted">'+(item.thumbnailOffsetMs/1000).toFixed(1)+'秒</div></td></tr>').join('')
        +'</tbody></table></div>'
        +'<button class="btn btn-primary" type="button" id="bulkSave" '+(busy||error?'disabled':'')+' style="margin-top:18px">'+(busy?'保存中…':items.length+'本を投稿予約として保存')+'</button>'
        +'<div id="bulkProgress" class="small muted" style="margin-top:10px">保存後もSNSへは即時投稿されません。自動投稿スイッチは変更しません。</div></div>';
    }
    return '<div class="page-head"><div><div class="eyebrow">BULK SCHEDULING</div><h1>一括投稿予約</h1><p>同じSNSに過去動画を1日2〜3本ずつ登録します。</p></div></div>'
      +'<section class="panel form-panel"><div class="form-section"><h2>01 / 投稿先と配信ペース</h2>'+intro
      +'<div class="form-grid"><div class="field"><label>予約先SNS（この1つだけ）</label><select id="bulkChannel">'
      +Object.entries(labels).map(([key,label])=>'<option value="'+key+'" '+(state.channel===key?'selected':'')+'>'+label+'</option>').join('')+'</select></div>'
      +'<div class="field"><label>開始日（日本時間）</label><input type="date" id="bulkStart" min="'+dayJst()+'" value="'+htmlEscape(state.start)+'"/></div>'
      +'<div class="field"><label>終了日（日本時間・含む）</label><input type="date" id="bulkEnd" min="'+htmlEscape(state.start)+'" value="'+htmlEscape(state.end)+'"/></div>'
      +'<div class="field"><label>1日の投稿本数</label><select id="bulkDaily"><option value="2" '+(state.daily===2?'selected':'')+'>2本</option><option value="3" '+(state.daily===3?'selected':'')+'>3本</option></select></div>'
      +'<div class="field"><label>投稿時刻（カンマ区切り）</label><input id="bulkTimes" value="'+htmlEscape(state.times)+'" placeholder="10:00,15:00,20:00"/><span class="hint">この時間帯から順番に割り当て、すでに同じSNSの予約があれば避けます。</span></div></div>'
      +summaryText
      +'<div class="field"><label>文章プリセット（タグをまとめて反映）</label><select id="bulkPreset"><option value="">選択してください</option>'
      +(getLibrary()?.templates||[]).map(p=>'<option value="'+htmlEscape(p.id)+'">'+htmlEscape(p.name)+'</option>').join('')
      +'</select><button type="button" class="btn btn-white" id="bulkApplyPreset" style="margin-top:8px">プリセットのタグを使用</button></div>'
      +'<div class="field"><label>ミニタグ（3個）</label><input id="bulkMini" value="'+htmlEscape(state.mini)+'" placeholder="#歌い手 #歌ってみた #shorts"/></div>'
      +'<div class="field"><label>ローラータグ（Shortsのみ）</label><textarea id="bulkRoller" rows="2" placeholder="#歌い手 #高校生 ...">'+htmlEscape(state.roller)+'</textarea></div></div>'
      +'<div class="form-section"><h2>02 / 過去動画をまとめて選択</h2>'
      +'<label class="upload"><input id="bulkFiles" type="file" accept="video/mp4,video/quicktime,video/webm" multiple/><strong>動画ファイルを複数選択</strong><small>1回最大30本。MP4推奨。ファイル名からタイトルを仮入力します。</small></label>'
      +'<div class="hint">動画はCloudflare R2にアップロードされます。大量登録前に無料容量10GBを確認してください。</div></div></section>'
      +table+'<div id="bulkThumbHost"></div>';
  }
  function render(root){
    if(!root)return;
    root.innerHTML=view();
    for(const id of ['bulkChannel','bulkStart','bulkEnd','bulkDaily','bulkTimes','bulkMini','bulkRoller']){
      const el=document.getElementById(id);if(!el)continue;
      el.addEventListener('change',()=>{
        const prev=state.daily;pull();
        if(id==='bulkDaily'&&state.daily!==prev)state.times=state.daily===2?'12:00,19:00':'10:00,15:00,20:00';if(id==='bulkStart'&&state.end<state.start)state.end=state.start;
        render(root);
      });
    }
    const apply=document.getElementById('bulkApplyPreset');
    if(apply)apply.onclick=()=>{
      const template=(getLibrary()?.templates||[]).find(t=>t.id===document.getElementById('bulkPreset')?.value);
      if(!template)return notify('文章プリセットを選んでください','error');
      state.mini=template.mini||state.mini;state.roller=template.roller||state.roller;
      render(root);notify('ミニタグ・ローラータグを反映しました。各動画のタイトルはそのままです。','success');
    };
    const input=document.getElementById('bulkFiles');
    input.onchange=()=>{
      const picked=Array.from(input.files||[]);
      if(picked.length>30){notify('1回の選択は最大30本です','error');return;}
      if(picked.some(f=>!f.size||!(/\.(mp4|mov|webm)$/i.test(f.name)))){notify('MP4・MOV・WebM動画のみ選択してください','error');return;}
      pull();files=picked;
      items=files.map(file=>({file,title:file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim(),thumbnailOffsetMs:0,done:false}));
      render(root);
    };
    root.querySelectorAll('.bulkTitle').forEach(el=>el.oninput=()=>{items[Number(el.dataset.index)].title=el.value;});
    root.querySelectorAll('[data-bulk-thumb]').forEach(el=>el.onclick=()=>showThumb(Number(el.dataset.bulkThumb)));
    const save=document.getElementById('bulkSave');if(save)save.onclick=()=>saveAll(root);
  }
  function showThumb(index){
    const item=items[index];if(!item)return;
    const host=document.getElementById('bulkThumbHost');
    if(!host)return;
    const url=URL.createObjectURL(item.file);
    host.innerHTML='<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><h2>動画 '+(index+1)+' のサムネイル</h2>'
      +'<p class="small muted">再生位置を選んでください。Instagram / TikTokに適用します（YouTube Shortsは非対応）。</p>'
      +'<video id="bulkThumbVideo" controls muted playsinline preload="metadata" style="width:100%;max-height:340px;background:#0d1624"></video>'
      +'<input id="bulkThumbRange" type="range" min="0" max="0" step="0.1" style="width:100%" value="'+(item.thumbnailOffsetMs/1000)+'"/>'
      +'<p>選択位置：<strong id="bulkThumbTime">'+(item.thumbnailOffsetMs/1000).toFixed(1)+'秒</strong></p>'
      +'<canvas id="bulkThumbCanvas" style="max-width:200px;max-height:180px"></canvas>'
      +'<div class="modal-actions"><button type="button" class="btn btn-white" id="bulkThumbClose">キャンセル</button>'
      +'<button type="button" class="btn btn-primary" id="bulkThumbApply">この秒数を保存</button></div></div></div>';
    const video=host.querySelector('#bulkThumbVideo'),range=host.querySelector('#bulkThumbRange'),time=host.querySelector('#bulkThumbTime'),canvas=host.querySelector('#bulkThumbCanvas');
    const close=()=>{video.pause();URL.revokeObjectURL(url);host.innerHTML='';};
    video.onloadedmetadata=()=>{
      range.max=Math.max(0,video.duration-.05).toFixed(1);
      range.value=Math.min(Number(range.value)||0,Number(range.max)||0).toFixed(1);
      video.currentTime=Number(range.value);
    };
    const show=()=>{time.textContent=(Number(range.value)||0).toFixed(1)+'秒';if(video.readyState>=2&&video.videoWidth){try{
      const w=Math.min(240,video.videoWidth);canvas.width=w;canvas.height=Math.max(1,Math.round(video.videoHeight*w/video.videoWidth));
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    }catch{}}};
    video.onseeked=show;video.onloadeddata=show;
    range.oninput=()=>{time.textContent=(Number(range.value)||0).toFixed(1)+'秒';video.currentTime=Math.min(Number(range.value),Math.max(0,video.duration-.05));};
    host.querySelector('#bulkThumbClose').onclick=close;
    host.querySelector('#bulkThumbApply').onclick=()=>{item.thumbnailOffsetMs=Math.round((Number(range.value)||0)*1000);close();render(document.getElementById('bulkRoot'));};
    video.src=url;video.load();
  }
  async function saveAll(root){
    if(busy)return;pull();
    if(!items.length)return notify('動画を選択してください','error');
    if(state.channel!=='shorts'&&!validMini(state.mini))return notify('ミニタグを #付きで3つ入力してください','error');
    const available=items.filter(i=>!i.done);
    if(!available.length)return notify('すべて保存済みです','info');
    if(available.some(i=>!i.title.trim()))return notify('すべてのタイトルを入力してください','error');
    const dateSlots=getDates();const summary=getSummary();
    const bytes=available.reduce((n,i)=>n+i.file.size,0);
    if(bytes>8*1024**3)return notify('選択動画が合計8GBを超えています。分割して登録してください','error');
    if(!confirm(state.start+'〜'+state.end+'（'+summary.days+'日 × 1日'+state.daily+'本 = 計'+summary.total+'枠）のうち、今回'+available.length+'本をR2にアップロードし、'+labels[state.channel]+'だけに予約します。SNSへの即時投稿は行われません。よろしいですか？'))return;
    busy=true;const btn=document.getElementById('bulkSave');if(btn){btn.disabled=true;btn.textContent='保存中…';}
    const status=document.getElementById('bulkProgress');let completed=0;
    try{
      for(let n=0;n<items.length;n++){
        const item=items[n];if(item.done)continue;
        if(status)status.textContent=(completed+1)+'/'+available.length+' 本目：'+item.file.name+' をアップロード中…';
        const videoKey=await getStore().upload(item.file,percent=>{if(status)status.textContent=(completed+1)+'/'+available.length+' 本目をアップロード '+percent+'%';});
        const targets={shorts:false,instagram:false,tiktok:false,x:false,line:false};targets[state.channel]=true;
        const statuses={shorts:'skipped',instagram:'skipped',tiktok:'skipped',line:'skipped'};statuses[state.channel]='planned';
        const p={kind:'vertical',stage:'scheduled',date:dateSlots[n].date,time:dateSlots[n].time,title:item.title.trim(),
          roller:state.roller,mini:state.mini,videoKey,videoName:item.file.name,previewKey:'',thumbnailKey:'',previewName:'',
          horizontalTitle:'',horizontalDescription:'',shortsUrl:'',xPosted:false,
          targets,statuses,bufferIds:{},thumbnailOffsetMs:item.thumbnailOffsetMs,previewThumbMs:0};
        const saved=await getStore().savePost(p);
        item.done=true;item.date=p.date;item.time=p.time;item.savedId=saved.id;completed++;
      }
      if(status)status.textContent=completed+'本の予約を保存しました。投稿の開始には後で自動投稿の設定が必要です。';
      notify(completed+'本の予約を保存しました','success');await onSaved();render(root);
    }catch(e){notify('保存が中断しました（完了分は保持）：'+e.message,'error');if(status)status.textContent=completed+'本保存済み。エラー：'+e.message+'。同じ画面で再試行できます。';}
    finally{busy=false;if(btn){btn.disabled=false;btn.textContent='残りを保存する';}}
  }
  return {render,view};
}
