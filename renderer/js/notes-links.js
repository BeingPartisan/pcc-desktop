/* ---------- Academia & Code (Notes & Links) ---------- */
function addNote(){
  state.notes.unshift({id:uid(), title:'Untitled note', body:'', updatedAt:Date.now()});
  Store.set('notes', state.notes); renderNotes();
}
function updateNote(id, field, value){
  const n = state.notes.find(x => x.id===id);
  if(n){ n[field]=value; n.updatedAt=Date.now(); Store.set('notes', state.notes); }
}
function renderNotes(){
  const el = document.getElementById('notes-list');
  if(!state.notes.length){ el.innerHTML = '<div class="empty">No notes yet.</div>'; return; }
  el.innerHTML = state.notes.map(n => `
    <div class="note-card">
      <div style="display:flex; justify-content:space-between; align-items:start;">
        <input class="note-title" value="${esc(n.title)}" onchange="updateNote('${n.id}','title',this.value)" />
        <button class="btn btn-icon" style="border:none; background:transparent; padding:0 4px;" onclick="state.notes=state.notes.filter(x=>x.id!=='${n.id}'); Store.set('notes', state.notes); renderNotes();">&times;</button>
      </div>
      <textarea class="note-body" onchange="updateNote('${n.id}','body',this.value)">${esc(n.body)}</textarea>
    </div>
  `).join('');
}

function onLinkTypeChange(){
  const type = document.getElementById('link-type').value;
  const targetInput = document.getElementById('link-target');
  const browseBtn = document.getElementById('link-browse-btn');
  if(type === 'app'){
    targetInput.placeholder = 'App path — use Browse';
    targetInput.readOnly = true;
    browseBtn.style.display = 'inline-block';
  } else {
    targetInput.placeholder = 'URL (e.g. https://...)';
    targetInput.readOnly = false;
    targetInput.value = '';
    browseBtn.style.display = 'none';
  }
}

async function browseForApp(){
  const filePath = await window.pcc.pickAppFile();
  if(filePath){
    document.getElementById('link-target').value = filePath;
  }
}

function addLink(){
  const name = document.getElementById('link-name').value.trim();
  const type = document.getElementById('link-type').value;
  let target = document.getElementById('link-target').value.trim();
  if(!name || !target) return;
  if(type === 'url' && !/^https?:\/\//i.test(target)) target = 'https://' + target;
  state.links.push({id:uid(), name:name, type:type, target:target});
  document.getElementById('link-name').value='';
  document.getElementById('link-target').value='';
  Store.set('links', state.links); renderLinks();
}
function renderLinks(){
  const body = document.getElementById('links-body');
  if(!state.links.length){ body.innerHTML = '<div class="empty">Nothing here yet. Add a site or an app below.</div>'; return; }
  // Backward-compat: old entries only have {name, url}; treat those as type 'url'
  body.innerHTML = state.links.map(l => {
    const type = l.type || 'url';
    const target = l.target || l.url || '';
    const initial = (l.name || '?').trim().charAt(0).toUpperCase();
    return `
    <div class="link-tile" data-type="${esc(type)}" data-target="${esc(target)}" style="cursor:pointer;">
      <span class="link-avatar ${type === 'app' ? 'app' : ''}">${esc(initial)}</span>
      <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13.5px; font-weight:500;">${esc(l.name)}</span>
      <button class="btn-icon link-remove" data-id="${l.id}" style="background:transparent; border:none; padding:2px; color:var(--line);">&times;</button>
    </div>
  `;
  }).join('');

  body.querySelectorAll('.link-tile').forEach(tile => {
    tile.addEventListener('click', async () => {
      const result = await window.pcc.launchItem(tile.dataset.type, tile.dataset.target);
      if(result && !result.ok) showToast('Could not open: ' + (result.error || 'unknown error'));
    });
  });
  body.querySelectorAll('.link-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      state.links = state.links.filter(x => x.id !== id);
      Store.set('links', state.links);
      renderLinks();
    });
  });
}
