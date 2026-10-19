/**
 * JANKY Studio Worker.
 * All external API secrets stay in Workers, not in GitHub Pages.
 * Actions are opt-in, disabled until Settings.autoEnabled and the service flag are on.
 */
const DEFAULTS = {
  monthlyQuota:200, friendCount:18, manualUsed:0, manualUsedMonth:'', spontaneousMonth:'',
  bufferEnabled:false, lineEnabled:false, autoEnabled:false,
  bufferOrganizationId:'', youtubeChannelId:'', instagramChannelId:'', tiktokChannelId:'',
  mediaRetentionDays:3,
};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const err=(message,status=400)=>json({error:message},status);
const nowIso=()=>new Date().toISOString();
const jstDate=(date=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const safeNum=(n,def=0)=>Number.isFinite(Number(n))?Math.max(0,Number(n)):def;
const parse=row=>row?JSON.parse(row.payload):null;
const safePath=key=>/^uploads\/[a-f0-9-]{36}\.(mp4|mov|webm|jpg|jpeg|png)$/.test(key);
function cors(env,origin){const allow=env.SITE_ORIGIN?.replace(/\/$/,'');if(allow&&origin===allow)return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Vary':'Origin'};if(origin?.startsWith('http://localhost:')&&env.ALLOW_LOCAL_DEV==='true')return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Vary':'Origin'};return {};}
async function secureEqual(a,b){if(!a||!b)return false;const encoder=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);return [...new Uint8Array(x)].every((v,i)=>v===new Uint8Array(y)[i]);}
async function log(env,level,message){await env.DB.prepare('INSERT INTO logs (id,level,message,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),level,String(message).slice(0,1200),nowIso()).run();if(level==='error'&&env.DISCORD_WEBHOOK_URL){try{await fetch(env.DISCORD_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:`⚠️ JANKY Studio: ${String(message).slice(0,1500)}`})});}catch{}}}
async function getPosts(env){const {results}=await env.DB.prepare('SELECT payload FROM posts ORDER BY updated_at DESC LIMIT 500').all();return results.map(parse).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));}
async function getPost(env,id){return parse(await env.DB.prepare('SELECT payload FROM posts WHERE id=?').bind(id).first());}
async function putPost(env,input){const p={...input};p.id||=crypto.randomUUID();p.createdAt||=nowIso();p.updatedAt=nowIso();const found=await getPost(env,p.id);
if(found)await env.DB.prepare('UPDATE posts SET payload=?,updated_at=? WHERE id=?').bind(JSON.stringify(p),p.updatedAt,p.id).run();
else await env.DB.prepare('INSERT INTO posts (id,payload,created_at,updated_at) VALUES (?,?,?,?)').bind(p.id,JSON.stringify(p),p.createdAt,p.updatedAt).run();return p;}
async function getSettings(env){const row=await env.DB.prepare("SELECT value FROM settings WHERE id='main'").first();const s={...DEFAULTS,...(row?JSON.parse(row.value):{})};if(s.manualUsedMonth&&s.manualUsedMonth!==jstDate().slice(0,7))s.manualUsed=0;return s;}
async function setSettings(env,s){const v={...DEFAULTS,...s};await env.DB.prepare("INSERT INTO settings(id,value) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(JSON.stringify(v)).run();return v;}
function sanitizeLibrary(body){
  if(!body||typeof body!=='object')throw new Error('保存するライブラリが不正です');
  const clean=str=>String(str??'').trim();
  const collabs=Array.isArray(body.collaborators)?body.collaborators:[];
  const texts=Array.isArray(body.templates)?body.templates:[];
  if(collabs.length>150||texts.length>150)throw new Error('プリセットは各150件までです');
  const collaborators=collabs.map(c=>({
    id:clean(c.id).slice(0,100),name:clean(c.name).slice(0,120),
    youtube:clean(c.youtube).slice(0,500),tiktok:clean(c.tiktok).replace(/^@/,'').slice(0,60),
    instagram:clean(c.instagram).replace(/^@/,'').slice(0,60),notes:clean(c.notes).slice(0,1000)
  }));
  const templates=texts.map(c=>({
    id:clean(c.id).slice(0,100),name:clean(c.name).slice(0,120),title:clean(c.title).slice(0,200),
    roller:clean(c.roller).slice(0,8000),mini:clean(c.mini).slice(0,500),
    horizontalTitle:clean(c.horizontalTitle).slice(0,200),horizontalDescription:clean(c.horizontalDescription).slice(0,8000)
  }));
  for(const item of collaborators){
    if(!/^[a-zA-Z0-9_-]{4,100}$/.test(item.id)||!item.name)throw new Error('コラボ相手のID・名前が不正です');
    if(item.youtube && !/^https:\/\/(www\.)?youtube\.com\/(channel\/UC[A-Za-z0-9_-]+|@[A-Za-z0-9_.-]+)(\/.*)?$/.test(item.youtube))
      throw new Error('YouTubeチャンネルのURLを確認してください');
    if(item.tiktok&&!/^[a-zA-Z0-9._]{2,32}$/.test(item.tiktok))throw new Error('TikTokのユーザー名を確認してください');
    if(item.instagram&&!/^[a-zA-Z0-9._]{2,30}$/.test(item.instagram))throw new Error('Instagramのユーザー名を確認してください');
  }
  for(const item of templates)if(!/^[a-zA-Z0-9_-]{4,100}$/.test(item.id)||!item.name)throw new Error('文章プリセット名が不正です');
  const ids=[...collaborators,...templates].map(c=>c.id);
  if(ids.length!==new Set(ids).size)throw new Error('プリセットIDが重複しています');
  const result={collaborators,templates};
  if(JSON.stringify(result).length>250000)throw new Error('保存データが大きすぎます');
  return result;
}
async function getLibrary(env){
  const row=await env.DB.prepare("SELECT value FROM settings WHERE id='library'").first();
  return row?sanitizeLibrary(JSON.parse(row.value)):{collaborators:[],templates:[]};
}
async function saveLibrary(env,input){
  const value=sanitizeLibrary(input);
  await env.DB.prepare("INSERT INTO settings(id,value) VALUES('library',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
    .bind(JSON.stringify(value)).run();
  return value;
}
async function lineFetch(env,path,options={}){if(!env.LINE_CHANNEL_ACCESS_TOKEN)throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');const r=await fetch(`https://api.line.me${path}`,{...options,headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,...options.headers}});if(!r.ok){let error=await r.text();throw new Error(`LINE API ${r.status}: ${error.slice(0,350)}`);}return r;}
async function getMonthlyUsage(env,s){let apiUsed=0,source='manual';if(env.LINE_CHANNEL_ACCESS_TOKEN){try{const r=await lineFetch(env,'/v2/bot/message/quota/consumption');apiUsed=safeNum((await r.json()).totalUsage);source='api';}catch(e){await log(env,'error',`LINE配信実績の取得失敗: ${e.message}`);}}
const month=jstDate().slice(0,7);const rec=await env.DB.prepare("SELECT COALESCE(SUM(target_count),0) AS total FROM line_records WHERE month=? AND state IN ('accepted','pending','sent')").bind(month).first();
// LINE API usage is approximate and may lag. The local ledger is a second lower bound.
const used=Math.max(apiUsed,safeNum(s.manualUsed),safeNum(rec?.total));return {used,source,timestamp:nowIso(),friendCount:s.friendCount,apiUsed,localLedger:safeNum(rec?.total)};}
function targetEnabled(p,key){return p.targets?.[key]!==false;}
function budget(posts,settings,used,day=jstDate()){const month=day.slice(0,7);const remainingPosts=posts.filter(p=>p.stage==='scheduled'&&p.date?.startsWith(month));
const vertical=remainingPosts.filter(p=>p.kind==='vertical'&&targetEnabled(p,'line')&&!['sent','skipped'].includes(p.statuses?.line));const horizontal=remainingPosts.filter(p=>p.kind==='horizontal'&&!['sent','skipped'].includes(p.statuses?.line));const M=safeNum(settings.monthlyQuota,200),U=safeNum(used),F=safeNum(settings.friendCount),H=horizontal.length*F,S=settings.spontaneousMonth===month?0:F,R=Math.max(0,M-U-H-S),D=vertical.length;
return {M,U,F,H,S,R,D,next:D?Math.min(F,Math.floor(R/D)):0,remaining:Math.max(0,M-U)};}
function sanitizePost(body,old){
  const p={...old,...body};
  p.id=old?.id||crypto.randomUUID();p.createdAt=old?.createdAt||nowIso();
  p.kind=p.kind==='horizontal'?'horizontal':'vertical';p.stage=p.stage==='scheduled'?'scheduled':'draft';
  for(const f of ['title','roller','mini','horizontalTitle','horizontalDescription','shortsUrl','videoKey','previewKey','thumbnailKey','videoName','previewName'])p[f]=String(p[f]||'').slice(0,f==='roller'||f==='horizontalDescription'?8000:650);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!/^\d{2}:\d{2}$/.test(p.time))throw new Error('投稿日時を正しく指定してください');
  if(!p.title.trim())throw new Error('タイトルを入力してください');
  const defaults={shorts:true,instagram:true,tiktok:true,line:true,x:true};
  p.targets={...defaults,...(old?.targets||{}),...(body.targets||{})};
  for(const key of Object.keys(defaults))p.targets[key]=Boolean(p.targets[key]);
  if(old?.statuses)for(const key of ['shorts','instagram','tiktok','line']){
    if(old.statuses[key]&&['queued','review','sent','pending'].includes(old.statuses[key]) && p.targets[key]!==targetEnabled(old,key))
      throw new Error(key+' の処理開始後は投稿先を変更できません');
  }
  p.thumbnailOffsetMs=Math.max(0,Math.min(86400000,Math.round(Number(p.thumbnailOffsetMs)||0)));
  p.previewThumbMs=Math.max(0,Math.min(86400000,Math.round(Number(p.previewThumbMs)||0)));
  if(p.kind==='vertical'){
    if(p.stage==='scheduled'&&!Object.values(p.targets).some(Boolean))throw new Error('投稿先を1つ以上選択してください');
    if(p.stage==='scheduled'&&p.targets.shorts&&p.title.length>100)throw new Error('YouTube Shortsのタイトルは100文字以内です');
    if(p.stage==='scheduled'&&(p.targets.tiktok||p.targets.instagram||p.targets.x)&&!p.mini.trim())throw new Error('ミニタグを3個入力してください');
    if(p.mini.trim()&&(!/^#[^\s#]+(?:\s+#[^\s#]+){2}$/.test(p.mini.trim())))throw new Error('ミニタグは3個のハッシュタグで入力してください');
    if(p.stage==='scheduled'&&(p.targets.shorts||p.targets.tiktok||p.targets.instagram)&&!p.videoKey)throw new Error('本編動画を登録してください');
    if(p.stage==='scheduled'&&(p.targets.line||p.targets.x)&&!p.previewKey)throw new Error('LINE・Xを選んだ場合はプレビュー動画が必要です');
  }
  for(const f of ['videoKey','previewKey','thumbnailKey'])if(p[f]&&!safePath(p[f]))throw new Error(`${f} が不正です`);
  if(p.shortsUrl&&(!/^https:\/\/(www\.|m\.)?youtube\.com\/shorts\/[A-Za-z0-9_-]{6,}/.test(p.shortsUrl)&&!/^https:\/\/youtu\.be\/[A-Za-z0-9_-]{6,}/.test(p.shortsUrl)))throw new Error('Shorts URLを確認してください');
  p.statuses={shorts:'planned',instagram:'planned',tiktok:'planned',line:'planned',...(old?.statuses||{}),...(body.statuses||{})};
  for(const key of ['shorts','instagram','tiktok','line']){
    if(!p.targets[key])p.statuses[key]='skipped';
    else if(p.statuses[key]==='skipped')p.statuses[key]='planned';
  }
  p.bufferIds={...(old?.bufferIds||{}),...(body.bufferIds||{})};
  p.collaboratorIds=Array.isArray(p.collaboratorIds)?[...new Set(p.collaboratorIds.map(x=>String(x).slice(0,100)))].slice(0,10):[];
  const actions=Array.isArray(p.collabActions)?p.collabActions:[];
  p.collabActions=actions.filter(a=>a&&typeof a==='object'&&p.collaboratorIds.includes(a.personId)&&['youtube','tiktok','instagram'].includes(a.platform)&&a.status==='done_manually')
    .slice(0,100).map(a=>({personId:String(a.personId),platform:String(a.platform),status:'done_manually',at:String(a.at||'').slice(0,40)}));
  p.xPosted=Boolean(p.xPosted);
  return p;
}
function postText(p,kind){if(kind==='shorts')return `${p.title}\n\n${p.roller}`;if(['instagram','tiktok'].includes(kind))return `${p.title} ${p.mini}`;if(kind==='line')return `じゃんきー。がshortsを更新しました！\n\n${p.title}\n${p.shortsUrl}`;if(kind==='x')return `じゃんきー。がshortsを更新しました！\n\n${p.title}\n${p.shortsUrl}\n\n${p.mini}`;return '';}
function mediaUrl(env,key){return `${env.MEDIA_ORIGIN.replace(/\/$/,'')}/media/${key}`;}
async function gql(env,query){if(!env.BUFFER_API_KEY)throw new Error('BUFFER_API_KEY が未設定です');const r=await fetch('https://api.buffer.com',{method:'POST',headers:{'Authorization':`Bearer ${env.BUFFER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({query})});const data=await r.json();if(!r.ok||data.errors?.length)throw new Error(`Buffer API: ${JSON.stringify(data.errors||data).slice(0,300)}`);return data.data;}
async function bufferPosts(env,org,channel,status){const data=await gql(env,`query { posts(first:100,input:{organizationId:${JSON.stringify(org)},filter:{status:[${status}],channelIds:[${JSON.stringify(channel)}]}}){edges{node{id channelId createdAt}}pageInfo{hasNextPage}} }`);return data?.posts?.edges?.map(e=>e.node)||[];}
async function enqueueBuffer(env,p,key,channel){const dueAt=new Date(`${p.date}T${p.time}:00+09:00`).toISOString();const bodyText=key==='shorts'?p.roller:postText(p,key);const thumbMeta=(key==='instagram'||key==='tiktok')&&p.thumbnailOffsetMs>0?`,metadata:{thumbnailOffset:${p.thumbnailOffsetMs}}`:'';const extra=key==='shorts'?`, metadata:{youtube:{title:${JSON.stringify(p.title)},categoryId:"24"}}`:key==='instagram'?`, metadata:{instagram:{type:reel,shouldShareToFeed:true}}`:'';const query=`mutation { createPost(input:{ text:${JSON.stringify(bodyText)}, channelId:${JSON.stringify(channel)}, schedulingType:automatic, mode:customScheduled, dueAt:${JSON.stringify(dueAt)}, assets:[{video:{url:${JSON.stringify(mediaUrl(env,p.videoKey))}${thumbMeta}}}]${extra} }){... on PostActionSuccess{post{id dueAt}} ... on MutationError{message}} }`;
const data=await gql(env,query);const out=data.createPost;if(out?.message)throw new Error(out.message);if(!out?.post?.id)throw new Error('Bufferから投稿IDが返されませんでした');return out.post.id;}
async function syncBuffer(env,s,posts){if(!s.autoEnabled||!s.bufferEnabled||!env.BUFFER_API_KEY||!s.bufferOrganizationId)return;
for(const [key,channel] of [['shorts',s.youtubeChannelId],['instagram',s.instagramChannelId],['tiktok',s.tiktokChannelId]]){
if(!channel)continue;try{
 const scheduled=await bufferPosts(env,s.bufferOrganizationId,channel,'scheduled');const sent=await bufferPosts(env,s.bufferOrganizationId,channel,'sent');const sentIds=new Set(sent.map(x=>x.id));const failed=await bufferPosts(env,s.bufferOrganizationId,channel,'error').catch(()=>[]);const failedIds=new Set(failed.map(x=>x.id));
 for(const p of posts){if(p.kind!=='vertical'||!p.bufferIds?.[key])continue;if(failedIds.has(p.bufferIds[key])&&p.statuses?.[key]!=='error'){p.statuses[key]='error';await putPost(env,p);await log(env,'error',`${key} Buffer投稿失敗: ${p.title}`);}if(sentIds.has(p.bufferIds[key])&&p.statuses?.[key]!=='sent'){p.statuses[key]='sent';await putPost(env,p);await log(env,'success',`${key} 投稿確認: ${p.title}`);}}
 let capacity=Math.max(0,10-scheduled.length);
 const eligible=posts.filter(p=>p.stage==='scheduled'&&p.kind==='vertical'&&targetEnabled(p,key)&&p.videoKey&&p.statuses?.[key]==='planned'&&new Date(`${p.date}T${p.time}:00+09:00`).getTime()>Date.now()+4*60*1000).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
 for(const p of eligible.slice(0,capacity)){
   // Claim the post before contacting Buffer to avoid duplicate posts if the request times out.
   p.statuses[key]='review';await putPost(env,p);
   try{const id=await enqueueBuffer(env,p,key,channel);p.bufferIds[key]=id;p.statuses[key]='queued';await putPost(env,p);await log(env,'success',`${key} Buffer予約登録: ${p.title}`);}
   catch(e){await log(env,'error',`${key} Buffer予約登録を確認できません: ${p.title} / ${e.message}`); /* stays in review; do not blind retry */}
 }
}catch(e){await log(env,'error',`${key} Buffer同期失敗: ${e.message}`);}}
}
async function lineRecord(env,{postId=null,kind,target,state,requestId=null}){const id=crypto.randomUUID(),t=nowIso();await env.DB.prepare('INSERT INTO line_records (id,post_id,kind,month,target_count,state,request_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,postId,kind,jstDate().slice(0,7),target,state,requestId,t,t).run();return id;}
async function beginLineSend(env,p,s,posts,{force=false}={}){
if(!s.lineEnabled)throw new Error('LINE配信が無効です');if(!targetEnabled(p,'line'))throw new Error('この投稿はLINEの配信対象外です');if(p.kind!=='vertical')throw new Error('横動画の配信ルールは未設定です');if(['sent','pending','review'].includes(p.statuses?.line))throw new Error('LINEの送信が受付済みか結果確認待ちです。LINE管理画面を確認してから復旧してください');
if(!p.shortsUrl)throw new Error('Shorts URLが未設定です');if(!p.previewKey||!p.thumbnailKey)throw new Error('LINE送信用プレビュー・サムネイルが不足しています');
if(!force&&p.statuses?.shorts!=='sent')throw new Error('Shortsの公開確認ができていません');
const usage=await getMonthlyUsage(env,s);const b=budget(posts,s,usage.used);const target=Math.min(b.F,b.next,b.remaining);if(target<1)throw new Error('LINEの配信可能人数が0人です');
const messages=[{type:'video',originalContentUrl:mediaUrl(env,p.previewKey),previewImageUrl:mediaUrl(env,p.thumbnailKey)},{type:'text',text:postText(p,'line')}];
const retryKey=crypto.randomUUID();
// Set pending BEFORE network request: a timeout must not trigger an automatic duplicate.
p.statuses.line='pending';await putPost(env,p);const recordId=await lineRecord(env,{postId:p.id,kind:'vertical',target,state:'pending'});
try{const response=await lineFetch(env,'/v2/bot/message/narrowcast',{method:'POST',headers:{'Content-Type':'application/json','X-Line-Retry-Key':retryKey},body:JSON.stringify({messages,limit:{max:target,upToRemainingQuota:true}})});const requestId=response.headers.get('x-line-request-id');await env.DB.prepare("UPDATE line_records SET state='accepted',request_id=?,updated_at=? WHERE id=?").bind(requestId,nowIso(),recordId).run();await log(env,'success',`LINEランダム配信を受付: ${p.title} / 最大${target}人`);return {accepted:true,requestId,target};}
catch(e){await env.DB.prepare("UPDATE line_records SET state='review',error=?,updated_at=? WHERE id=?").bind(String(e.message).slice(0,350),nowIso(),recordId).run();p.statuses.line='review';await putPost(env,p);await log(env,'error',`LINE配信に失敗または結果不明: ${p.title} / ${e.message}`);throw e;}
}
async function syncLineProgress(env,posts){if(!env.LINE_CHANNEL_ACCESS_TOKEN)return;const records=(await env.DB.prepare("SELECT * FROM line_records WHERE state='accepted' AND request_id IS NOT NULL ORDER BY created_at LIMIT 20").all()).results;
for(const r of records){try{const response=await lineFetch(env,`/v2/bot/message/progress/narrowcast?requestId=${encodeURIComponent(r.request_id)}`);const d=await response.json();if(d.phase==='waiting'||d.phase==='sending')continue;const state=d.phase==='succeeded'?'sent':'review';await env.DB.prepare('UPDATE line_records SET state=?,updated_at=? WHERE id=?').bind(state,nowIso(),r.id).run();if(r.post_id){const p=posts.find(p=>p.id===r.post_id);if(p){p.statuses.line=state;await putPost(env,p);}}await log(env,state==='sent'?'success':'error',`LINE配信 ${state}: ${r.post_id||'全員通知'} / ${d.successCount??'人数未確定'}人`);
}catch(e){await log(env,'error',`LINE配信進捗の取得失敗: ${e.message}`);}}
}
async function syncFollowers(env,s){if(!env.LINE_CHANNEL_ACCESS_TOKEN)return;const day=new Date(Date.now()-86400000);const date=jstDate(day).replace(/-/g,'');if(s.followersCheckedDate===date)return;try{const r=await lineFetch(env,`/v2/bot/insight/followers?date=${date}`);const data=await r.json();if(data.status==='ready'&&typeof data.followers==='number'&&typeof data.blocks==='number'){
// Target count is an estimate. The LINE API can lag ~1 day.
s.friendCount=Math.max(0,data.followers-data.blocks);s.followersCheckedDate=date;await setSettings(env,s);
}}catch(e){await log(env,'error',`友だち数の取得失敗: ${e.message}`);}}
async function cleanup(env,s,posts){const cutoff=Date.now()-Math.max(1,safeNum(s.mediaRetentionDays,3))*86400000;
for(const p of posts){if(!p.videoKey&&!p.previewKey&&!p.thumbnailKey)continue;if(p.stage!=='scheduled'||p.kind!=='vertical')continue;
const allSent=['shorts','instagram','tiktok','line'].every(k=>!targetEnabled(p,k)||p.statuses?.[k]==='sent')&&(!targetEnabled(p,'x')||p.xPosted);
if(!allSent)continue;const doneAt=p.completedAt||nowIso();if(!p.completedAt){p.completedAt=doneAt;await putPost(env,p);continue;}if(new Date(doneAt).getTime()>cutoff)continue;
for(const key of ['videoKey','previewKey','thumbnailKey'])if(p[key]){await env.MEDIA.delete(p[key]);p[key]='';}p.filesDeletedAt=nowIso();await putPost(env,p);await log(env,'success',`完了後${s.mediaRetentionDays}日を経過した動画を削除: ${p.title}`);}}
// Buffer Free API has a rolling 30-day limit (3,000 calls). Avoid querying
// every five minutes. Poll on a six-hour cadence, and every 30 minutes near
// a scheduled release to reduce LINE follow-up delay. External API calls from
// manual /api/run are subject to the same cadence.
function shouldSyncBuffer(posts, now=new Date()) {
  const minute=now.getUTCMinutes();
  const regular=now.getUTCHours()%6===0 && minute<5;
  const nearRelease=posts.some(p=>{
    if(p.kind!=='vertical'||p.stage!=='scheduled')return false;
    const due=new Date(`${p.date}T${p.time}:00+09:00`).getTime();
    return Number.isFinite(due)&&Math.abs(now.getTime()-due)<=45*60*1000;
  });
  return regular || (nearRelease && minute%30<5);
}
async function cron(env){const s=await getSettings(env);if(!s.autoEnabled)return {skipped:true,reason:'自動処理はオフ'};const posts=await getPosts(env);await syncFollowers(env,s);if(shouldSyncBuffer(posts))await syncBuffer(env,s,posts);await syncLineProgress(env,posts);
if(s.lineEnabled&&env.LINE_CHANNEL_ACCESS_TOKEN){for(const p of posts){if(p.kind!=='vertical'||p.stage!=='scheduled'||!targetEnabled(p,'line')||p.statuses?.line!=='planned')continue;if(new Date(`${p.date}T${p.time}:00+09:00`).getTime()>Date.now())continue;if(!p.shortsUrl||p.statuses.shorts!=='sent'){if(!p.lastWaitingNotice || Date.now()-new Date(p.lastWaitingNotice).getTime()>86400000){p.lastWaitingNotice=nowIso();await putPost(env,p);await log(env,'error',`LINE配信を保留: Shorts公開URLまたは公開確認がありません「${p.title}」`);}continue;}try{await beginLineSend(env,p,s,posts);}catch{} }}await cleanup(env,s,posts);return {ok:true};}
function mimeFromFile(file){const ext=file.name?.split('.').pop()?.toLowerCase();if(file.type==='image/jpeg'||ext==='jpg'||ext==='jpeg')return 'image/jpeg';if(file.type==='image/png'||ext==='png')return 'image/png';if(file.type==='video/mp4'||ext==='mp4')return 'video/mp4';if(file.type==='video/quicktime'||ext==='mov')return 'video/quicktime';if(file.type==='video/webm'||ext==='webm')return 'video/webm';throw new Error('サポートされていないファイル形式です');}
async function uploadStart(env,body){const mime=mimeFromFile({name:body.filename,type:body.type});const ext={ 'image/jpeg':'jpg','image/png':'png','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'}[mime];const size=safeNum(body.size);if(size<1||size>3*1024*1024*1024)throw new Error('1ファイル最大3GBです（R2無料枠とは別）');const key=`uploads/${crypto.randomUUID()}.${ext}`;
const upload=await env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType:mime,cacheControl:'public,max-age=86400'}});return {key,uploadId:upload.uploadId};}
async function mediaResponse(request,env,key){if(!safePath(key))return err('invalid media path',404);const range=request.headers.get('range');let object;
if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(match){const meta=await env.MEDIA.head(key);if(!meta)return err('not found',404);const start=Number(match[1]),end=match[2]?Number(match[2]):meta.size-1;if(start>=meta.size||end<start)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta.size}`}});object=await env.MEDIA.get(key,{range:{offset:start,length:Math.min(end,meta.size-1)-start+1}});if(!object)return err('not found',404);const h=new Headers();object.writeHttpMetadata(h);h.set('Content-Range',`bytes ${start}-${Math.min(end,meta.size-1)}/${meta.size}`);h.set('Content-Length',String(Math.min(end,meta.size-1)-start+1));h.set('Accept-Ranges','bytes');h.set('X-Robots-Tag','noindex');if(new URL(request.url).searchParams.get('download')==='1')h.set('Content-Disposition','attachment');return new Response(request.method==='HEAD'?null:object.body,{status:206,headers:h});}}
object=await env.MEDIA.get(key);if(!object)return err('not found',404);const h=new Headers();object.writeHttpMetadata(h);h.set('Content-Length',String(object.size));h.set('Accept-Ranges','bytes');h.set('X-Robots-Tag','noindex');if(new URL(request.url).searchParams.get('download')==='1')h.set('Content-Disposition','attachment');return new Response(request.method==='HEAD'?null:object.body,{headers:h});}
async function mainRequest(request,env){const u=new URL(request.url),path=u.pathname,method=request.method,origin=request.headers.get('origin');
if(path.startsWith('/media/')&&(method==='GET'||method==='HEAD'))return mediaResponse(request,env,path.slice(7));
if(path==='/api/health')return json({ok:true,service:'JANKY Studio API'});
if(!path.startsWith('/api/'))return err('not found',404);
const auth=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
if(!await secureEqual(auth,env.ADMIN_TOKEN))return err('管理トークンが正しくありません',401);
if(origin&&env.SITE_ORIGIN&&origin!==env.SITE_ORIGIN.replace(/\/$/,''))return err('このサイトからは接続できません',403);
if(path==='/api/posts'&&method==='GET')return json({posts:await getPosts(env)});
if(path==='/api/posts'&&method==='POST'){const body=await request.json();const p=sanitizePost(body,null);await putPost(env,p);await log(env,'info',`投稿を新規登録: ${p.title}`);return json({post:p},201);}
const pm=path.match(/^\/api\/posts\/([a-f0-9-]{36})(?:\/line\/send)?$/);
if(pm){const id=pm[1],p=await getPost(env,id);if(!p)return err('投稿が見つかりません',404);
if(path.endsWith('/line/send')&&method==='POST'){const s=await getSettings(env);const posts=await getPosts(env);const result=await beginLineSend(env,p,s,posts);return json(result,202);}
if(method==='GET')return json({post:p});
if(method==='PUT'){const body=await request.json();if(p.statuses&&Object.entries(p.statuses).some(([k,v])=>['shorts','instagram','tiktok'].includes(k)&&['queued','sent','review'].includes(v))&&(body.title!==p.title||body.date!==p.date||body.time!==p.time||body.videoKey!==p.videoKey||body.stage!==p.stage))return err('Bufferで予約済みの投稿は公開情報を変更できません。先にBuffer予約を確認してください');
const updated=sanitizePost(body,p);await putPost(env,updated);await log(env,'info',`投稿を更新: ${p.title}`);return json({post:updated});}
if(method==='DELETE'){if(Object.entries(p.statuses||{}).some(([k,v])=>['shorts','instagram','tiktok'].includes(k)&&['queued','sent','review'].includes(v)))return err('外部予約または送信済み投稿は削除できません');await env.DB.prepare('DELETE FROM posts WHERE id=?').bind(id).run();for(const key of ['videoKey','previewKey','thumbnailKey'])if(p[key])await env.MEDIA.delete(p[key]);await log(env,'info',`投稿削除: ${p.title}`);return json({ok:true});}}
if(path==='/api/buffer/channels'&&method==='GET'){
  if(!env.BUFFER_API_KEY)return err('CloudflareのSecretにBUFFER_API_KEYが設定されていません',503);
  const accountData=await gql(env,'query JankyOrganizations { account { organizations { id name } } }');
  const organizations=accountData?.account?.organizations;
  if(!Array.isArray(organizations))throw new Error('Bufferの組織一覧を取得できませんでした');
  if(organizations.length>20)throw new Error('組織が20件を超えています。管理者に確認してください');
  const result=[];
  for(const organization of organizations){
    const channelData=await gql(env,`query JankyChannels { channels(input: { organizationId: ${JSON.stringify(organization.id)} }) { id name displayName service } }`);
    if(!Array.isArray(channelData?.channels))throw new Error('Bufferのチャンネル一覧を取得できませんでした: '+String(organization.name));
    result.push({
      id: String(organization.id),
      name: String(organization.name||'名称未設定'),
      channels:channelData.channels.map(c=>({
        id:String(c.id), name:String(c.name||''), displayName:String(c.displayName||''),
        service:String(c.service||'')
      }))
    });
  }
  return json({organizations:result});
}
if(path==='/api/library'&&method==='GET')return json({library:await getLibrary(env)});
if(path==='/api/library'&&method==='PUT'){const library=await saveLibrary(env,await request.json());await log(env,'info','コラボ相手・文章プリセットを更新');return json({library});}
if(path==='/api/settings'&&method==='GET')return json({settings:await getSettings(env)});
if(path==='/api/settings'&&method==='PUT'){const body=await request.json();const prev=await getSettings(env);const whitelist=['monthlyQuota','friendCount','manualUsed','spontaneousMonth','autoEnabled','bufferEnabled','lineEnabled','bufferOrganizationId','youtubeChannelId','instagramChannelId','tiktokChannelId','mediaRetentionDays'];
for(const k of whitelist)if(body[k]!==undefined)prev[k]=body[k];prev.monthlyQuota=safeNum(prev.monthlyQuota,200);prev.manualUsed=safeNum(prev.manualUsed);prev.manualUsedMonth=jstDate().slice(0,7);prev.friendCount=safeNum(prev.friendCount);prev.mediaRetentionDays=Math.min(30,Math.max(1,safeNum(prev.mediaRetentionDays,3)));for(const k of ['autoEnabled','bufferEnabled','lineEnabled'])prev[k]=Boolean(prev[k]);const saved=await setSettings(env,prev);await log(env,'info','設定を更新しました');return json({settings:saved});}
if(path==='/api/logs'&&method==='GET'){const result=await env.DB.prepare('SELECT id,level,message,created_at as createdAt FROM logs ORDER BY created_at DESC LIMIT 100').all();return json({logs:result.results});}
if(path==='/api/line/usage'&&method==='GET'){return json(await getMonthlyUsage(env,await getSettings(env)));}
if(path==='/api/line/spontaneous'&&method==='POST'){
const s=await getSettings(env);if(!s.lineEnabled)return err('LINE送信がオフです');const text=String((await request.json()).text||'').trim();if(!text||text.length>5000)return err('本文を1〜5000文字にしてください');const month=jstDate().slice(0,7);if(s.spontaneousMonth===month)return err('今月の自発的な全員通知枠は使用済みです');const usage=await getMonthlyUsage(env,s);if(usage.used+s.friendCount>s.monthlyQuota)return err('全員に送るための無料枠が不足しています');
// Claim one voluntary slot before network. Avoid accidental double sends after timeout.
s.spontaneousMonth=month;await setSettings(env,s);await lineRecord(env,{kind:'spontaneous',target:s.friendCount,state:'pending'});
try{await lineFetch(env,'/v2/bot/message/broadcast',{method:'POST',headers:{'Content-Type':'application/json','X-Line-Retry-Key':crypto.randomUUID()},body:JSON.stringify({messages:[{type:'text',text}]})});await env.DB.prepare("UPDATE line_records SET state='sent',updated_at=? WHERE kind='spontaneous' AND month=? AND state='pending'").bind(nowIso(),month).run();await log(env,'success','自発的な全員通知を送信しました');return json({ok:true},202);}
catch(e){await log(env,'error',`自発的な全員通知の結果が不明です。LINE管理画面で確認してください: ${e.message}`);return err(`送信結果を確認できません: ${e.message}`,502);}}
if(path==='/api/uploads/start'&&method==='POST')return json(await uploadStart(env,await request.json()));
if(path==='/api/uploads/part'&&method==='PUT'){const key=u.searchParams.get('key'),uploadId=u.searchParams.get('uploadId'),n=Number(u.searchParams.get('part'));if(!safePath(key)||!uploadId||!Number.isInteger(n)||n<1||n>10000)return err('アップロード情報が不正です');const upload=env.MEDIA.resumeMultipartUpload(key,uploadId);const part=await upload.uploadPart(n,request.body);return json({etag:part.etag,partNumber:part.partNumber});}
if(path==='/api/uploads/complete'&&method==='POST'){const b=await request.json();if(!safePath(b.key)||!b.uploadId||!Array.isArray(b.parts)||!b.parts.length)return err('アップロードの完成情報が不正です');await env.MEDIA.resumeMultipartUpload(b.key,b.uploadId).complete(b.parts);return json({ok:true,key:b.key});}
if(path==='/api/uploads/abort'&&method==='POST'){const b=await request.json();if(!safePath(b.key)||!b.uploadId)return err('アップロード情報が不正です');await env.MEDIA.resumeMultipartUpload(b.key,b.uploadId).abort();return json({ok:true});}
if(path==='/api/run'&&method==='POST')return json(await cron(env));
return err('not found',404);
}
export default {
  async fetch(request,env){const origin=request.headers.get('origin');if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(env,origin)});
    try{const res=await mainRequest(request,env);const response=new Response(res.body,res);for(const [k,v] of Object.entries(cors(env,origin)))response.headers.set(k,v);return response;}
    catch(e){const message=e instanceof Error?e.message:String(e);return json({error:message},message.includes('not found')?404:400,cors(env,origin));}},
  async scheduled(_event,env,ctx){ctx.waitUntil(cron(env).catch(e=>log(env,'error',`定期処理の例外: ${e.message}`)));}
};

// Pure helpers are exported for offline unit tests.
export {budget,postText,sanitizePost,sanitizeLibrary};
