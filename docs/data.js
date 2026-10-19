const DB_NAME = 'janky-studio-v1';
const STORE_NAMES = ['posts', 'assets', 'settings', 'logs'];
const makeId = () => crypto.randomUUID();
const copy = x => structuredClone(x);
function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { for (const name of STORE_NAMES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, {keyPath: 'id'}); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function transaction(name, mode, fn) {
  const db = await dbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const idb = {
  all: name => transaction(name, 'readonly', s => s.getAll()),
  get: (name, id) => transaction(name, 'readonly', s => s.get(id)),
  put: (name, value) => transaction(name, 'readwrite', s => s.put(value)),
  del: (name, id) => transaction(name, 'readwrite', s => s.delete(id)),
};
export const DEFAULT_SETTINGS = {
  monthlyQuota: 200, friendCount: 18, manualUsed: 0, manualUsedMonth: '', spontaneousMonth: '',
  autoEnabled: false, bufferEnabled: false, lineEnabled: false,
  bufferOrganizationId: '', youtubeChannelId: '', instagramChannelId: '', tiktokChannelId: '',
  mediaRetentionDays: 3,
};
function localDate(now = new Date()) {return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
export function countBudget(posts, settings, used = null, today = localDate()) {
  const month = today.slice(0,7);
  const planned = posts.filter(p=>p.stage === 'scheduled' && p.date?.startsWith(month));
  const vertical = planned.filter(p=>p.kind === 'vertical' && !['sent','skipped'].includes(p.statuses?.line));
  const horizontal = planned.filter(p=>p.kind === 'horizontal' && !['sent','skipped'].includes(p.statuses?.line));
  const F = Math.max(0, Number(settings.friendCount) || 0);
  const M = Math.max(0, Number(settings.monthlyQuota) || 0);
  const U = Math.max(0, Number(used ?? settings.manualUsed) || 0);
  const H = horizontal.length * F;
  const S = settings.spontaneousMonth === month ? 0 : F;
  const R = Math.max(0, M - U - H - S);
  return {M,U,F,H,S,R,D:vertical.length,horizontal:horizontal.length,vertical:vertical.length,
    next:vertical.length && F ? Math.min(F, Math.floor(R/vertical.length)) : 0,
    remainder:vertical.length ? R % vertical.length : 0,
    remaining:Math.max(0,M-U)};
}
export class LocalStore {
  mode = 'demo';
  async listPosts() {return (await idb.all('posts')).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));}
  async getPost(id) {return idb.get('posts', id);}
  async savePost(input) {
    const p = copy(input); p.id ||= makeId(); p.createdAt ||= new Date().toISOString(); p.updatedAt = new Date().toISOString();
    await idb.put('posts',p); await this.log('info', `投稿「${p.title}」を${p.stage==='draft'?'下書き保存':'予約保存'}しました`); return p;
  }
  async deletePost(id) {const p=await this.getPost(id);if(p){for(const key of ['videoKey','previewKey','thumbnailKey']) if(p[key]) await idb.del('assets',p[key]);await idb.del('posts',id);await this.log('info',`投稿「${p.title}」を削除しました`);}}
  async upload(file) {const key=makeId();await idb.put('assets',{id:key,blob:file,name:file.name || key,createdAt:new Date().toISOString()});return key;}
  async mediaUrl(key) {if(!key)return ''; const obj=await idb.get('assets',key);return obj?.blob ? URL.createObjectURL(obj.blob) : '';}
  async getSettings() {const s={...DEFAULT_SETTINGS,...(await idb.get('settings','main'))?.value};if(s.manualUsedMonth&&s.manualUsedMonth!==localDate().slice(0,7))s.manualUsed=0;return s;}
  async saveSettings(value) {await idb.put('settings',{id:'main',value:{...DEFAULT_SETTINGS,...value,manualUsedMonth:localDate().slice(0,7)}});await this.log('info','設定を保存しました');return this.getSettings();}
  async listLogs() {return (await idb.all('logs')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);}
  async log(level,message) {await idb.put('logs',{id:makeId(),level,message,createdAt:new Date().toISOString()});}
  async getLineUsage() {const s=await this.getSettings();return {used:s.manualUsed,source:'manual',timestamp:null,friendCount:s.friendCount};}
  async lineSend(post) {await this.log('info',`【デモ】LINE配信のテスト操作: ${post.title}（実際の送信なし）`);return {demo:true};}
  async spontaneous(text) {const s=await this.getSettings();s.spontaneousMonth=localDate().slice(0,7);await this.saveSettings(s);await this.log('info',`【デモ】自発的な全員通知: ${text.slice(0,60)}（実際の送信なし）`);return {demo:true};}
  async refresh() {return {demo:true};}
}
export class RemoteStore {
  mode = 'live';
  constructor(base,token){this.base=base.replace(/\/$/,'');this.token=token;}
  async req(method,path,body=null,options={}){
    const headers={'Authorization':`Bearer ${this.token}`};if(body && !(body instanceof Blob))headers['Content-Type']='application/json';
    const res=await fetch(this.base+path,{method,headers,body:body instanceof Blob?body:body===null?undefined:JSON.stringify(body),...options});
    const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error || `APIエラー (${res.status})`);return data;
  }
  async listPosts(){return (await this.req('GET','/api/posts')).posts;}
  async getPost(id){return (await this.req('GET',`/api/posts/${encodeURIComponent(id)}`)).post;}
  async savePost(input){return (await this.req(input.id?'PUT':'POST',input.id?`/api/posts/${encodeURIComponent(input.id)}`:'/api/posts',input)).post;}
  async deletePost(id){return this.req('DELETE',`/api/posts/${encodeURIComponent(id)}`);}
  async upload(file,progress=()=>{}){
    const start=await this.req('POST','/api/uploads/start',{filename:file.name,type:file.type,size:file.size});
    const chunk=6*1024*1024;const parts=[];
    try {
      for(let pos=0;pos<file.size;pos+=chunk){
        const number=parts.length+1;
        const p=await this.req('PUT',`/api/uploads/part?key=${encodeURIComponent(start.key)}&uploadId=${encodeURIComponent(start.uploadId)}&part=${number}`,file.slice(pos,pos+chunk));
        parts.push({partNumber:number,etag:p.etag});progress(Math.round(100*Math.min(file.size,pos+chunk)/file.size));
      }
      await this.req('POST','/api/uploads/complete',{key:start.key,uploadId:start.uploadId,parts,type:file.type});
      return start.key;
    }catch(e){await this.req('POST','/api/uploads/abort',{key:start.key,uploadId:start.uploadId}).catch(()=>{});throw e;}
  }
  async mediaUrl(key){return key?`${this.base}/media/${key}`:'';}
  async discoverBuffer(){return this.req('GET','/api/buffer/channels');}
  async getSettings(){return (await this.req('GET','/api/settings')).settings;}
  async saveSettings(value){return (await this.req('PUT','/api/settings',value)).settings;}
  async listLogs(){return (await this.req('GET','/api/logs')).logs;}
  async getLineUsage(){return (await this.req('GET','/api/line/usage'));}
  async lineSend(post){return this.req('POST',`/api/posts/${encodeURIComponent(post.id)}/line/send`);}
  async spontaneous(text){return this.req('POST','/api/line/spontaneous',{text});}
  async refresh(){return this.req('POST','/api/run');}
}
export const isVideo = file => file && (file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name));
export const jpNowDate=localDate;
