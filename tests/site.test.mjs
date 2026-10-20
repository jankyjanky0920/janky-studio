import test from 'node:test';
import assert from 'node:assert/strict';
import {countBudget, DEFAULT_SETTINGS} from '../docs/data.js';
import {budget,postText,sanitizePost,sanitizeLibrary,testLineConnection,inspectLineQuota,isLineUserId,verifyLineTestRecipient,sendSingleLineTest} from '../worker/src/index.js';
import {planBulkRange} from '../docs/bulk.js';
const day='2026-10-17';
const make=(kind,date,id)=>({id,kind,date,time:'19:00',stage:'scheduled',statuses:{line:'planned'}});
test('縦動画の残枠を横動画と月1回の全員通知を確保してから計算',()=>{
  const posts=[...Array.from({length:26},(_,i)=>make('vertical',`2026-10-${String(i+17).padStart(2,'0')}`,String(i))),make('horizontal','2026-10-20','h1'),make('horizontal','2026-10-29','h2')];
  const s={...DEFAULT_SETTINGS, friendCount:18, monthlyQuota:200, spontaneousMonth:''};
  const b=countBudget(posts,s,12,day);
  assert.equal(b.H,36);assert.equal(b.S,18);assert.equal(b.R,134);assert.equal(b.next,5);
  const remote=budget(posts,s,12,day);
  assert.equal(remote.R,b.R);assert.equal(remote.next,b.next);
});
test('自発的通知を使用すると予約枠は解除される',()=>{
  const b=countBudget([make('vertical',day,'x')],{...DEFAULT_SETTINGS,spontaneousMonth:'2026-10'},0,day);
  assert.equal(b.S,0);assert.equal(b.next,18);
});
test('来月の投稿は今月の送信回数Dに含めない',()=>{
  const b=countBudget([make('vertical','2026-11-01','x')],DEFAULT_SETTINGS,0,day);
  assert.equal(b.D,0);assert.equal(b.next,0);
});
test('SNS文章はユーザー指定の文面と一致',()=>{
  const p={title:'テスト',roller:'#歌い手 #高校生',mini:'#a #b #c',shortsUrl:'https://www.youtube.com/shorts/abcdefghijk'};
  assert.equal(postText(p,'shorts'),'テスト\n\n#歌い手 #高校生');
  assert.equal(postText(p,'instagram'),'テスト #a #b #c');
  assert.equal(postText(p,'tiktok'),'テスト #a #b #c');
  assert.equal(postText(p,'x'),'じゃんきー。がshortsを更新しました！\n\nテスト\nhttps://www.youtube.com/shorts/abcdefghijk\n\n#a #b #c');
  assert.equal(postText(p,'line'),'じゃんきー。がshortsを更新しました！\n\nテスト\nhttps://www.youtube.com/shorts/abcdefghijk');
});
test('3個でないミニタグは拒否',()=>{
  const p={kind:'vertical',stage:'draft',date:day,time:'19:00',title:'テスト',mini:'#a #b'};
  assert.throws(()=>sanitizePost(p,null),/3個/);
  assert.doesNotThrow(()=>sanitizePost({...p,mini:'#a #b #c'},null));
});
test('投稿先によって本編とプレビューの必要条件が変わる',()=>{
  const p={kind:'vertical',stage:'scheduled',date:day,time:'19:00',title:'テスト',mini:'#a #b #c'};
  assert.throws(()=>sanitizePost(p,null),/本編動画/);
  const videoKey='uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4';
  assert.throws(()=>sanitizePost({...p,videoKey},null),/プレビュー動画/);
});
test('TikTokだけの一括予約はShorts・Instagram・LINE・Xを選択しない',()=>{
  const p=sanitizePost({
    kind:'vertical',stage:'scheduled',date:day,time:'10:00',title:'過去動画',mini:'#a #b #c',
    videoKey:'uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4',
    targets:{shorts:false,instagram:false,tiktok:true,x:false,line:false},thumbnailOffsetMs:2530
  },null);
  assert.equal(p.targets.tiktok,true);
  assert.equal(p.statuses.tiktok,'planned');
  for(const k of ['shorts','instagram','line'])assert.equal(p.statuses[k],'skipped');
  assert.equal(p.thumbnailOffsetMs,2530);
  assert.equal(p.previewKey,'');
  const web=countBudget([p],DEFAULT_SETTINGS,0,day);
  const backend=budget([p],DEFAULT_SETTINGS,0,day);
  assert.equal(web.D,0);assert.equal(backend.D,0);
});
test('予約済みのBuffer投稿は、投稿先を後から外せない',()=>{
  const p=sanitizePost({
    kind:'vertical',stage:'scheduled',date:day,time:'10:00',title:'動画',mini:'#a #b #c',
    videoKey:'uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4',
    targets:{shorts:false,instagram:false,tiktok:true,x:false,line:false}
  },null);
  p.statuses.tiktok='queued';
  assert.throws(()=>sanitizePost({targets:{tiktok:false}},p),/投稿先を変更/);
});

test('一括予約の開始日・終了日は両端を含み合計本数を計算する',()=>{
  const range=planBulkRange({start:'2026-11-01',end:'2026-11-07',daily:3,times:'10:00,15:00,20:00',now:Date.parse('2026-10-19T00:00:00+09:00')});
  assert.equal(range.days,7);assert.equal(range.total,21);assert.equal(range.available,21);
  assert.equal(range.slots[0].date,'2026-11-01');assert.equal(range.slots.at(-1).date,'2026-11-07');
});
test('既存枠を除外し終了日を越えて追加しない',()=>{
  const range=planBulkRange({start:'2026-11-01',end:'2026-11-02',daily:2,times:'12:00,19:00',now:Date.parse('2026-10-19T00:00:00+09:00'),existing:[{date:'2026-11-01',time:'12:00'}]});
  assert.equal(range.total,4);assert.equal(range.booked,1);assert.equal(range.available,3);
  assert.equal(range.slots.every(x=>x.date<='2026-11-02'),true);
  assert.throws(()=>planBulkRange({start:'2026-11-03',end:'2026-11-01',daily:2,times:'12:00,19:00'}),/終了日/);
});
test('文章プリセットの保存では以前のコラボ情報を画面へ返さない',()=>{
  const lib=sanitizeLibrary({collaborators:[{id:'creator_A',name:'以前の登録'}],templates:[
    {id:'copy_01',name:'歌ってみた用',title:'曲名',mini:'#歌い手 #高校生 #shorts',roller:'#歌い手 #高校生'}
  ]});
  assert.deepEqual(Object.keys(lib),['templates']);
  assert.equal(lib.templates[0].name,'歌ってみた用');
  assert.equal(lib.templates[0].mini,'#歌い手 #高校生 #shorts');
});
test('無効な文章プリセットは受け付けない',()=>{
  assert.throws(()=>sanitizeLibrary({templates:[{id:'abc',name:'短すぎるID'}]}),/ID|不正/);
});
test('LINE接続確認はGETのみで実行し、アクセストークンを返さない',async()=>{
  const original=globalThis.fetch;
  const token='sample-secret-token-not-real';
  let requestCount=0;
  globalThis.fetch=async (url,options)=>{
    requestCount++;
    assert.equal(url,'https://api.line.me/v2/bot/info');
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    return {ok:true,status:200,json:async()=>({displayName:'テスト公式LINE',basicId:'@example',userId:'Uhidden'})};
  };
  try{
    const result=await testLineConnection({LINE_CHANNEL_ACCESS_TOKEN:token});
    assert.deepEqual(result,{connected:true,displayName:'テスト公式LINE',basicId:'@example'});
    assert.equal(JSON.stringify(result).includes(token),false);
    assert.equal(requestCount,1);
  }finally{globalThis.fetch=original;}
});
test('LINE接続確認では401を送信せず安全な失敗メッセージとして返す',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    assert.equal(options.method,'GET');
    return {ok:false,status:401,json:async()=>({message:'Invalid token'})};
  };
  try{
    const result=await testLineConnection({LINE_CHANNEL_ACCESS_TOKEN:'invalid-token'});
    assert.equal(result.connected,false);
    assert.match(result.error,/アクセストークン/);
    assert.equal(JSON.stringify(result).includes('invalid-token'),false);
  }finally{globalThis.fetch=original;}
});

test('LINEの配信枠と使用通数をGETだけで確認する',async()=>{
  const original=globalThis.fetch;
  const called=[];
  globalThis.fetch=async (url,options)=>{
    called.push({url,method:options.method});
    if(url.endsWith('/quota'))return {ok:true,json:async()=>({type:'limited',value:200})};
    if(url.endsWith('/quota/consumption'))return {ok:true,json:async()=>({totalUsage:33})};
    throw new Error('unexpected URL');
  };
  const env={LINE_CHANNEL_ACCESS_TOKEN:'dummy-key-for-test',
    DB:{prepare:query=>({first:async()=>({value:JSON.stringify({monthlyQuota:200})})})}};
  try{
    const result=await inspectLineQuota(env);
    assert.equal(result.ok,true);
    assert.equal(result.monthlyLimit,200);
    assert.equal(result.used,33);
    assert.equal(result.remaining,167);
    assert.equal(result.siteLimit,200);
    assert.equal(result.siteLimitAboveLine,false);
    assert.equal(called.length,2);
    assert.equal(called.every(x=>x.method==='GET'),true);
    assert.equal(JSON.stringify(result).includes('dummy-key-for-test'),false);
  }finally{globalThis.fetch=original;}
});
test('LINEが上限目安を返さない場合に無制限と誤表示しない',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options)=>url.endsWith('/quota')?
    {ok:true,json:async()=>({type:'none'})}:
    {ok:true,json:async()=>({totalUsage:5})};
  const env={LINE_CHANNEL_ACCESS_TOKEN:'dummy',
    DB:{prepare:query=>({first:async()=>({value:JSON.stringify({monthlyQuota:200})})})}};
  try{
    const result=await inspectLineQuota(env);
    assert.equal(result.ok,true);
    assert.equal(result.monthlyLimit,null);
    assert.equal(result.remaining,null);
    assert.equal(result.used,5);
  }finally{globalThis.fetch=original;}
});

test('本人LINE IDの形式を検証し、宛先確認ではGETだけ実行',async()=>{
  const userId='U'+ 'a'.repeat(32),original=globalThis.fetch;
  assert.equal(isLineUserId(userId),true);
  assert.equal(isLineUserId('Uinvalid'),false);
  const observed=[];
  globalThis.fetch=async (url,options)=>{
    observed.push({url,method:options.method});
    return {ok:true,json:async()=>({displayName:'自分のテストLINE',userId})};
  };
  try{
    const verified=await verifyLineTestRecipient({LINE_CHANNEL_ACCESS_TOKEN:'fake-test-token'},userId);
    assert.deepEqual(verified,{ok:true,displayName:'自分のテストLINE'});
    assert.equal(observed.length,1);
    assert.equal(observed[0].url,'https://api.line.me/v2/bot/profile/'+userId);
    assert.equal(observed[0].method,'GET');
    assert.equal(JSON.stringify(verified).includes(userId),false);
  }finally{globalThis.fetch=original;}
});
test('本番自動送信がONならLINEの単独テスト送信を拒否',async()=>{
  const userId='U'+'b'.repeat(32),original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(url);
    return {ok:true,json:async()=>({displayName:'本人LINE'})};
  };
  try{
    await assert.rejects(async()=>sendSingleLineTest({
      LINE_CHANNEL_ACCESS_TOKEN:'fake-test-token',
      DB:{prepare:sql=>({first:async()=>({value:JSON.stringify({autoEnabled:true,lineEnabled:true,monthlyQuota:200})})})}
    },{userId,displayName:'本人LINE',confirmation:'自分のアカウントに1通だけ送信する'}),/OFF/);
    assert.equal(calls.filter(x=>x.endsWith('/push')).length,0);
  }finally{globalThis.fetch=original;}
});
test('明示的確認を経て本人1人にのみ送信し、同日2回目を禁止',async()=>{
  const userId='U'+'c'.repeat(32),original=globalThis.fetch;
  const calls=[];let reserved=false;
  globalThis.fetch=async(url,options)=>{
    calls.push({url,method:options.method,body:options.body});
    if(url.endsWith('/profile/'+userId))return {ok:true,json:async()=>({displayName:'自分のLINE'})};
    if(url.endsWith('/quota'))return {ok:true,json:async()=>({type:'limited',value:200})};
    if(url.endsWith('/quota/consumption'))return {ok:true,json:async()=>({totalUsage:0})};
    if(url.endsWith('/push'))return {ok:true};
    throw new Error('unexpected endpoint '+url);
  };
  const env={
    LINE_CHANNEL_ACCESS_TOKEN:'fake-test-token',
    DB:{prepare:sql=>({
      bind(...args){this.args=args;return this;},
      first:async()=>{
        if(sql.includes("SELECT value FROM settings"))return {value:JSON.stringify({autoEnabled:false,lineEnabled:false,monthlyQuota:200,friendCount:18})};
        if(sql.includes('COALESCE(SUM'))return {total:0};
        return null;
      },
      run:async()=>{
        if(sql.startsWith('INSERT OR IGNORE INTO settings')){if(reserved)return {meta:{changes:0}};reserved=true;return {meta:{changes:1}};}
        return {meta:{changes:1}};
      }
    })}
  };
  const body={userId,displayName:'自分のLINE',confirmation:'自分のアカウントに1通だけ送信する'};
  try{
    assert.deepEqual(await sendSingleLineTest(env,body),{sent:true,count:1});
    const pushes=calls.filter(c=>c.url.endsWith('/push'));
    assert.equal(pushes.length,1);
    assert.equal(pushes[0].method,'POST');
    const sent=JSON.parse(pushes[0].body);
    assert.equal(sent.to,userId);
    assert.equal(sent.messages.length,1);
    assert.equal(sent.messages[0].type,'text');
    await assert.rejects(async()=>sendSingleLineTest(env,body),/本日のテスト送信/);
    assert.equal(calls.filter(c=>c.url.endsWith('/push')).length,1);
  }finally{globalThis.fetch=original;}
});
