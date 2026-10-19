/* Creator identities and text preset manager. No third-party invites are transmitted. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=>crypto.randomUUID();
export function createLibraryManager({getLibrary,getPosts,saveLibrary,notify,onSaved}){
  let editPersonId='',editTextId='';
  const fresh=(name)=>getLibrary()[name]||[];
  const val=(name)=>document.getElementById(name)?.value?.trim()||'';
  const usage=(personId)=>{
    const posts=getPosts().filter(p=>p.collaboratorIds?.includes(personId));
    return {posts:posts.length,handled:posts.reduce((n,p)=>n+(p.collabActions||[]).filter(a=>a.personId===personId&&a.status==='done_manually').length,0)};
  };
  function view(){
    const people=fresh('collaborators'),templates=fresh('templates');
    return '<div class="page-head"><div><div class="eyebrow">LIBRARY</div><h1>プリセット・コラボ</h1><p>投稿文章・タグと、複数SNSのコラボ相手をまとめて保存します。</p></div></div>'
    +'<div class="notice">YouTube Studio・TikTok・Instagramの「招待を送信する」操作は、現在の公開APIからは自動実行しません。ここでは相手情報の保存・一括選択・各SNSでの手動操作と履歴管理を行います。</div>'
    +'<section class="panel form-panel" style="margin-top:18px"><div class="form-section"><h2>コラボ相手のプリセット</h2>'
    +'<p class="small muted">Aさんを一度登録すれば、YouTube・TikTok・Instagramのアカウントを同一人物として扱えます。</p>'
    +'<form id="personForm"><div class="form-grid"><div class="field"><label>表示名（必須）</label><input id="personName" required maxlength="120" placeholder="例：Aさん"/></div>'
    +'<div class="field"><label>YouTubeチャンネルURL</label><input id="personYouTube" placeholder="https://www.youtube.com/@channelname"/></div>'
    +'<div class="field"><label>TikTokユーザー名</label><input id="personTikTok" placeholder="@username"/></div>'
    +'<div class="field"><label>Instagramユーザー名</label><input id="personInstagram" placeholder="@username"/></div></div>'
    +'<div class="field"><label>メモ</label><textarea id="personNotes" rows="2" placeholder="過去のコラボ、連絡手段など（公開のアカウント情報のみ）"></textarea></div>'
    +'<div class="form-actions"><button type="button" class="btn btn-white" id="personCancel">入力を消す</button><button type="submit" class="btn btn-primary" id="personSave">相手を保存</button></div></form></div>'
    +'<div class="form-section"><h3>登録済みの相手（'+people.length+'人）</h3>'
    +(people.length?'<div class="table-wrap"><table class="table"><thead><tr><th>相手</th><th>各SNS</th><th>これまでの動画</th><th>操作</th></tr></thead><tbody>'
      +people.map(p=>{const u=usage(p.id);return '<tr><td><strong>'+esc(p.name)+'</strong><div class="small muted">'+esc(p.notes)+'</div></td>'
      +'<td>'+[p.youtube?'YouTube':'',p.tiktok?'TikTok':'',p.instagram?'Instagram':''].filter(Boolean).join(' / ')+'</td>'
      +'<td>'+u.posts+'件（手動対応記録'+u.handled+'件）</td><td><button type="button" class="btn btn-white btn-small" data-person-edit="'+esc(p.id)+'">編集</button> '
      +'<button type="button" class="btn btn-white btn-small" data-person-del="'+esc(p.id)+'">削除</button></td></tr>';}).join('')
      +'</tbody></table></div>':'<p class="small muted">まだ誰も登録されていません。</p>')+'</div></section>'
    +'<section class="panel form-panel" style="margin-top:18px"><div class="form-section"><h2>文章プリセット</h2>'
    +'<p class="small muted">ローラータグ・ミニタグ・題名・横概要欄をまとめて保存して、次の投稿から選べます。</p>'
    +'<form id="textForm"><div class="field"><label>プリセット名（必須）</label><input id="templateName" required maxlength="120" placeholder="例：歌ってみた用"/></div>'
    +'<div class="form-grid"><div class="field"><label>タイトル</label><input id="templateTitle" maxlength="200"/></div>'
    +'<div class="field"><label>ミニタグ（3個）</label><input id="templateMini" placeholder="#歌い手 #歌ってみた #shorts"/></div></div>'
    +'<div class="field"><label>ローラータグ</label><textarea id="templateRoller" rows="3" placeholder="#歌い手 #高校生 ..."></textarea></div>'
    +'<div class="field"><label>横タイトル</label><input id="templateHorizontalTitle" maxlength="200"/></div>'
    +'<div class="field"><label>横概要欄</label><textarea id="templateHorizontalDescription" rows="3"></textarea></div>'
    +'<div class="form-actions"><button type="button" class="btn btn-white" id="templateCancel">入力を消す</button><button type="submit" class="btn btn-primary" id="templateSave">文章を保存</button></div></form></div>'
    +'<div class="form-section"><h3>保存済みの文章（'+templates.length+'件）</h3>'
    +(templates.length?'<div class="table-wrap"><table class="table"><thead><tr><th>名前</th><th>内容</th><th>操作</th></tr></thead><tbody>'
      +templates.map(p=>'<tr><td><strong>'+esc(p.name)+'</strong></td><td>'+esc(p.title||p.horizontalTitle||'(タイトルなし)')+'<div class="small muted">'+esc(p.mini)+'</div></td>'
      +'<td><button type="button" class="btn btn-white btn-small" data-template-edit="'+esc(p.id)+'">編集</button> '
      +'<button type="button" class="btn btn-white btn-small" data-template-del="'+esc(p.id)+'">削除</button></td></tr>').join('')
      +'</tbody></table></div>':'<p class="small muted">まだ文章が登録されていません。</p>')+'</div></section>';
  }
  function render(root){
    if(!root)return;
    root.innerHTML=view();
    const people=fresh('collaborators'),texts=fresh('templates');
    const clearPerson=()=>{editPersonId='';root.querySelector('#personForm').reset();root.querySelector('#personSave').textContent='相手を保存';};
    const clearText=()=>{editTextId='';root.querySelector('#textForm').reset();root.querySelector('#templateSave').textContent='文章を保存';};
    root.querySelector('#personCancel').onclick=clearPerson;
    root.querySelector('#templateCancel').onclick=clearText;
    root.querySelector('#personForm').onsubmit=async(e)=>{
      e.preventDefault();let youtube=val('personYouTube');
      let tiktok=val('personTikTok').replace(/^@/,'');
      let instagram=val('personInstagram').replace(/^@/,'');
      if(!val('personName'))return notify('相手の名前を入力してください','error');
      if(youtube&&!/^https:\/\/(www\.)?youtube\.com\/(channel\/UC[A-Za-z0-9_-]+|@[A-Za-z0-9_.-]+)(\/.*)?$/.test(youtube))return notify('YouTubeチャンネルのURLを確認してください','error');
      if(tiktok&&!/^[A-Za-z0-9._]{2,32}$/.test(tiktok))return notify('TikTokのユーザー名を確認してください','error');
      if(instagram&&!/^[A-Za-z0-9._]{2,30}$/.test(instagram))return notify('Instagramのユーザー名を確認してください','error');
      const record={id:editPersonId||id(),name:val('personName'),youtube,tiktok,instagram,notes:val('personNotes')};
      const library=structuredClone(getLibrary());
      library.collaborators=editPersonId?library.collaborators.map(p=>p.id===editPersonId?record:p):[...library.collaborators,record];
      await submit(library,root,'コラボ相手を保存しました');
    };
    root.querySelectorAll('[data-person-edit]').forEach(button=>button.onclick=()=>{
      const p=people.find(x=>x.id===button.dataset.personEdit);if(!p)return;
      editPersonId=p.id;
      for(const [field,value] of [['personName',p.name],['personYouTube',p.youtube],['personTikTok',p.tiktok],['personInstagram',p.instagram],['personNotes',p.notes]])root.querySelector('#'+field).value=value||'';
      root.querySelector('#personSave').textContent='変更を保存';root.querySelector('#personName').focus();
    });
    root.querySelectorAll('[data-person-del]').forEach(button=>button.onclick=async()=>{
      const p=people.find(x=>x.id===button.dataset.personDel);if(!p)return;
      if(usage(p.id).posts>0){notify('過去のコラボ履歴を保護するため、投稿で使用済みの相手は削除できません。必要なら名前・アカウントを編集してください。','error');return;}
      if(!confirm(p.name+'をプリセットから削除しますか？'))return;
      const library=structuredClone(getLibrary());library.collaborators=library.collaborators.filter(x=>x.id!==p.id);
      await submit(library,root,'コラボ相手を削除しました');
    });
    root.querySelector('#textForm').onsubmit=async(e)=>{
      e.preventDefault();if(!val('templateName'))return notify('プリセット名を入力してください','error');
      const record={id:editTextId||id(),name:val('templateName'),title:val('templateTitle'),mini:val('templateMini'),
        roller:val('templateRoller'),horizontalTitle:val('templateHorizontalTitle'),horizontalDescription:val('templateHorizontalDescription')};
      if(record.mini&&!/^#[^\s#]+(?:\s+#[^\s#]+){2}$/.test(record.mini))return notify('ミニタグは3つの#付きタグで入力してください','error');
      const library=structuredClone(getLibrary());
      library.templates=editTextId?library.templates.map(p=>p.id===editTextId?record:p):[...library.templates,record];
      await submit(library,root,'文章プリセットを保存しました');
    };
    root.querySelectorAll('[data-template-edit]').forEach(button=>button.onclick=()=>{
      const p=texts.find(x=>x.id===button.dataset.templateEdit);if(!p)return;
      editTextId=p.id;
      for(const [field,value] of [['templateName',p.name],['templateTitle',p.title],['templateMini',p.mini],['templateRoller',p.roller],
        ['templateHorizontalTitle',p.horizontalTitle],['templateHorizontalDescription',p.horizontalDescription]])root.querySelector('#'+field).value=value||'';
      root.querySelector('#templateSave').textContent='変更を保存';root.querySelector('#templateName').focus();
    });
    root.querySelectorAll('[data-template-del]').forEach(button=>button.onclick=async()=>{
      if(!confirm('この文章プリセットを削除しますか？'))return;
      const library=structuredClone(getLibrary());library.templates=library.templates.filter(p=>p.id!==button.dataset.templateDel);
      await submit(library,root,'文章プリセットを削除しました');
    });
  }
  async function submit(value,root,message){
    try{await saveLibrary(value);editPersonId='';editTextId='';notify(message,'success');await onSaved();render(root);}
    catch(e){notify('保存に失敗しました: '+e.message,'error');}
  }
  return {render};
}
