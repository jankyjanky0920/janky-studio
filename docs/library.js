/* Text preset library: collaboration invitation controls are intentionally disabled. */
const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function createLibraryManager({getLibrary,saveLibrary,notify,onSaved}){
  let editingId='';
  const byId=id=>(getLibrary()?.templates||[]).find(t=>t.id===id);
  function view(){
    const templates=getLibrary()?.templates||[];
    return '<div class="page-head"><div><div class="eyebrow">TEXT PRESETS</div><h1>文章プリセット</h1>'
      +'<p>タイトル・ミニタグ・ローラータグ・概要欄を保存し、次回の投稿に使えます。</p></div></div>'
      +'<section class="panel form-panel" style="margin-top:18px"><div class="form-section"><h2>文章の登録</h2>'
      +'<form id="textForm"><div class="field"><label>プリセット名（必須）</label><input id="templateName" required maxlength="120" placeholder="例：歌ってみた用"/></div>'
      +'<div class="form-grid"><div class="field"><label>タイトル</label><input id="templateTitle" maxlength="200"/></div>'
      +'<div class="field"><label>ミニタグ（3個）</label><input id="templateMini" placeholder="#歌い手 #歌ってみた #shorts"/></div></div>'
      +'<div class="field"><label>ローラータグ</label><textarea id="templateRoller" rows="3" placeholder="#歌い手 #高校生 ..."></textarea></div>'
      +'<div class="field"><label>横タイトル</label><input id="templateHorizontalTitle" maxlength="200"/></div>'
      +'<div class="field"><label>横概要欄</label><textarea id="templateHorizontalDescription" rows="3"></textarea></div>'
      +'<div class="form-actions"><button type="button" class="btn btn-white" id="templateCancel">入力を消す</button>'
      +'<button type="submit" class="btn btn-primary" id="templateSave">文章を保存</button></div></form></div>'
      +'<div class="form-section"><h3>保存済みの文章（'+templates.length+'件）</h3>'
      +(templates.length?'<div class="table-wrap"><table class="table"><thead><tr><th>名前</th><th>内容</th><th>操作</th></tr></thead><tbody>'
        +templates.map(t=>'<tr><td><strong>'+escapeText(t.name)+'</strong></td>'
          +'<td>'+escapeText(t.title||t.horizontalTitle||'(タイトルなし)')+'<div class="small muted">'+escapeText(t.mini)+'</div></td>'
          +'<td><button type="button" class="btn btn-white btn-small" data-template-edit="'+escapeText(t.id)+'">編集</button> '
          +'<button type="button" class="btn btn-white btn-small" data-template-del="'+escapeText(t.id)+'">削除</button></td></tr>').join('')
        +'</tbody></table></div>':'<p class="small muted">まだ文章プリセットはありません。</p>')
      +'</div></section>';
  }
  function render(root){
    if(!root)return;
    root.innerHTML=view();
    const form=root.querySelector('#textForm');
    const clear=()=>{editingId='';form.reset();root.querySelector('#templateSave').textContent='文章を保存';};
    root.querySelector('#templateCancel').onclick=clear;
    form.onsubmit=async event=>{
      event.preventDefault();
      const value=name=>root.querySelector('#'+name)?.value?.trim()||'';
      const name=value('templateName');
      if(!name)return notify('プリセット名を入力してください','error');
      const record={id:editingId||crypto.randomUUID(),name,title:value('templateTitle'),
        mini:value('templateMini'),roller:value('templateRoller'),
        horizontalTitle:value('templateHorizontalTitle'),horizontalDescription:value('templateHorizontalDescription')};
      if(record.mini&&!/^#[^\s#]+(?:\s+#[^\s#]+){2}$/.test(record.mini))return notify('ミニタグは #付きで3つ入力してください','error');
      const current=getLibrary()?.templates||[];
      await submit({templates:editingId?current.map(t=>t.id===editingId?record:t):[...current,record]},root,'文章プリセットを保存しました');
    };
    root.querySelectorAll('[data-template-edit]').forEach(button=>button.onclick=()=>{
      const template=byId(button.dataset.templateEdit);
      if(!template)return;
      editingId=template.id;
      for(const [field,key] of [['templateName','name'],['templateTitle','title'],['templateMini','mini'],
        ['templateRoller','roller'],['templateHorizontalTitle','horizontalTitle'],['templateHorizontalDescription','horizontalDescription']]){
        root.querySelector('#'+field).value=template[key]||'';
      }
      root.querySelector('#templateSave').textContent='変更を保存';
      root.querySelector('#templateName').focus();
    });
    root.querySelectorAll('[data-template-del]').forEach(button=>button.onclick=async()=>{
      if(!confirm('この文章プリセットを削除しますか？'))return;
      await submit({templates:(getLibrary()?.templates||[]).filter(t=>t.id!==button.dataset.templateDel)},root,'文章プリセットを削除しました');
    });
  }
  async function submit(next,root,message){
    try{
      await saveLibrary(next);
      editingId='';
      notify(message,'success');
      await onSaved();
      render(root);
    }catch(error){notify('保存に失敗しました: '+error.message,'error');}
  }
  return {render};
}
