import test from 'node:test';
import assert from 'node:assert/strict';
import {countBudget, DEFAULT_SETTINGS} from '../docs/data.js';
import {budget,postText,sanitizePost} from '../worker/src/index.js';
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
