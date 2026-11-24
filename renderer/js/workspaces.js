/* ---------- Workspaces ---------- */
// A workspace is a named set of Quick launch items that open together:
// "Study" might open Digiicampus, the course site and a notes app in one
// click. The feature is off until the user sets one up, and can be switched
// off again in Settings > Island (prefs().workspacesEnabled). While it's on,
// the island shows a button per workspace.

const WORKSPACES_ASKED_KEY = '__workspacesAsked'; // set once the user has answered the "set one up?" question

const workspaces = {
  list: Store.get('workspaces', []),  // [{ id, name, items: [link ids] }]
  editing: null,                      // null, 'new', or the id of the workspace being edited
};

function saveWorkspaces(){ Store.set('workspaces', workspaces.list); pushIsland(); }

// Links can be removed after a workspace was made, so only count the ones that still exist.
function workspaceLinks(workspace){ return workspace.items.map(id => state.links.find(l => l.id === id)).filter(Boolean); }

function startWorkspaceSetup(){
  localStorage.setItem(WORKSPACES_ASKED_KEY, '1');
  workspaces.editing = 'new';
  if(!prefs().workspacesEnabled) setPref('workspacesEnabled', true); // redraws the card
  else renderWorkspaces();
}

function declineWorkspaces(){
  localStorage.setItem(WORKSPACES_ASKED_KEY, '1');
  renderWorkspaces();
  showToast(sayAny('No problem. You can turn workspaces on later in Settings > Island.', 'Cool cool, no pressure. You can turn workspaces on later in Settings > Island.'));
}

function editWorkspace(id){ workspaces.editing = id; renderWorkspaces(); }
function cancelWorkspaceEdit(){ workspaces.editing = null; renderWorkspaces(); }

function saveWorkspaceEdit(){
  const name = document.getElementById('workspace-name').value.trim();
  const items = Array.from(document.querySelectorAll('#workspace-items input:checked')).map(input => input.value);
  if(!name){ showToast(sayAny('Give the workspace a name', 'Give the workspace a name. “Stuff” counts, I won’t judge.')); return; }
  if(!items.length){ showToast(sayAny('Pick at least one thing to open', 'Pick at least one thing to open. An empty workspace is just a nap.')); return; }
  if(workspaces.editing === 'new') workspaces.list.push({ id: uid(), name: name.slice(0, 24), items });
  else Object.assign(workspaces.list.find(w => w.id === workspaces.editing), { name: name.slice(0, 24), items });
  workspaces.editing = null;
  saveWorkspaces(); renderWorkspaces();
}

function deleteWorkspace(id){
  const workspace = workspaces.list.find(w => w.id === id);
  if(!workspace || !confirm(say(`Delete the "${workspace.name}" workspace?\n\nThe sites and apps in it stay in Quick launch.`,
    `Delete the "${workspace.name}" workspace? It had a good run.\n\nThe sites and apps in it stay in Quick launch.`))) return;
  workspaces.list = workspaces.list.filter(w => w.id !== id);
  saveWorkspaces(); renderWorkspaces();
}

async function openWorkspace(id){
  const workspace = workspaces.list.find(w => w.id === id);
  if(!workspace) return;
  const links = workspaceLinks(workspace);
  if(!links.length){ showToast(sayAny('Everything in this workspace has been removed from Quick launch', 'Nothing to open, bro. Everything in this workspace was removed from Quick launch.')); return; }
  let failed = 0;
  for(const link of links){
    const result = await window.pcc.launchItem(link.type || 'url', link.target || link.url || '');
    if(result && !result.ok) failed++;
  }
  const failedText = `Opened ${workspace.name}, but ${failed} item${failed === 1 ? '' : 's'} could not be opened`;
  showToast(failed
    ? sayAny(failedText, `${failedText}. Mostly a win.`)
    : sayAny(`Opened ${workspace.name}`, `Opened ${workspace.name}. Locked in, let’s go.`, `Opened ${workspace.name}. Now actually do the work, bro.`, `Opened ${workspace.name}. Grind mode: on.`));
}

function workspaceFormHtml(){
  const current = workspaces.list.find(w => w.id === workspaces.editing);
  if(!state.links.length){
    return `<div class="empty">${say('A workspace opens things from Quick launch. Add a few sites or apps to Quick launch above, then come back.', 'A workspace opens things from Quick launch, and yours is empty, bro. Add a few sites or apps to Quick launch above, then come back.')}</div>
      <div class="row-form"><button class="btn" onclick="cancelWorkspaceEdit()">Close</button></div>`;
  }
  return `
    <div class="field">
      <label class="field-label" for="workspace-name">Name</label>
      <input id="workspace-name" type="text" maxlength="24" placeholder="${esc(say('e.g. Study, Research, Wind down', 'e.g. Study, Grind, Pretend to study'))}" value="${esc(current ? current.name : '')}" />
    </div>
    <div class="field">
      <div class="field-label">Open these together</div>
      <div class="workspace-items" id="workspace-items">
        ${state.links.map(l => `<label class="workspace-item"><input type="checkbox" value="${l.id}" ${current && current.items.includes(l.id) ? 'checked' : ''} /><span>${esc(l.name)}</span></label>`).join('')}
      </div>
      <div class="field-note">${say('Missing something? Add it to Quick launch above first.', 'Missing something? Add it to Quick launch above first, I can’t read minds yet.')}</div>
    </div>
    <div class="row-form" style="justify-content:flex-end;">
      <button class="btn" onclick="cancelWorkspaceEdit()">Cancel</button>
      <button class="btn btn-primary" onclick="saveWorkspaceEdit()">Save workspace</button>
    </div>`;
}

function renderWorkspaces(){
  const card = document.getElementById('card-workspaces');
  if(!card) return;
  const body = document.getElementById('workspaces-body');
  const enabled = prefs().workspacesEnabled;
  const asked = !!localStorage.getItem(WORKSPACES_ASKED_KEY);
  document.getElementById('workspace-new-btn').style.display = enabled && !workspaces.editing ? '' : 'none';

  // Switched off: ask once whether to set it up, then stay out of the way.
  if(!enabled){
    card.style.display = asked ? 'none' : '';
    body.innerHTML = `
      <div class="workspace-intro">
        <div>
          <div class="setting-name">Open everything for a task in one click</div>
          <div class="setting-desc">${say('A workspace is a set of your sites and apps that open together, from here or from the island. Want to set one up?', 'A workspace is a set of your sites and apps that open together, from here or from the island. One click, zero excuses. Want to set one up?')}</div>
        </div>
        <div class="row-form" style="flex-shrink:0;">
          <button class="btn" onclick="declineWorkspaces()">Not now</button>
          <button class="btn btn-primary" onclick="startWorkspaceSetup()">Set up</button>
        </div>
      </div>`;
    return;
  }

  card.style.display = '';
  if(workspaces.editing){
    body.innerHTML = workspaceFormHtml();
    return;
  }
  if(!workspaces.list.length){
    body.innerHTML = `<div class="empty">${say('No workspaces yet. Use "New workspace" to make one, or switch this off in Settings &gt; Island.', 'No workspaces yet. Still opening tabs one by one like it’s 2010? Use "New workspace" to make one, or switch this off in Settings &gt; Island.')}</div>`;
    return;
  }
  body.innerHTML = `<div class="link-grid">${workspaces.list.map(w => {
    const names = workspaceLinks(w).map(l => l.name);
    return `
    <div class="workspace-tile">
      <div style="min-width:0;">
        <div class="setting-name">${esc(w.name)}</div>
        <div class="setting-desc" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(names.join(', ') || say('Nothing left to open', 'Nothing left to open. Empty shell, bro.'))}</div>
      </div>
      <div class="row-form">
        <button class="btn btn-primary" onclick="openWorkspace('${w.id}')">Open</button>
        <button class="btn" onclick="editWorkspace('${w.id}')">Edit</button>
        <button class="btn" onclick="deleteWorkspace('${w.id}')" aria-label="Delete ${esc(w.name)}">&times;</button>
      </div>
    </div>`; }).join('')}</div>`;
}

// What the island needs: nothing unless the feature is on.
function islandWorkspaces(){
  return prefs().workspacesEnabled ? workspaces.list.map(w => ({ id: w.id, name: w.name })) : [];
}

// The setup form lists Quick launch items, so keep it current.
hookRender('renderLinks', () => { if(workspaces.editing !== null || !prefs().workspacesEnabled) return; renderWorkspaces(); });

// Switching the feature on in Settings with nothing set up goes straight to the form.
function workspacesSwitched(){
  if(prefs().workspacesEnabled && !workspaces.list.length) workspaces.editing = 'new';
  if(!prefs().workspacesEnabled) workspaces.editing = null;
  renderWorkspaces();
}
