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
test('予約した縦動画に本編とプレビューが必要',()=>{
  const p={kind:'vertical',stage:'scheduled',date:day,time:'19:00',title:'テスト',mini:'#a #b #c'};
  assert.throws(()=>sanitizePost(p,null),/本編とプレビュー/);
});
