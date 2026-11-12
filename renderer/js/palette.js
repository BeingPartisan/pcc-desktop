/* ---------- Command Palette (Ctrl+K) ---------- */
let isPaletteOpen = false;
let paletteSelectionIdx = 0;
let filteredCommands = [];

const PALETTE_COMMANDS = [
  ...PAGE_ORDER.map((page, i) => ({ id: 'go-' + page, title: PAGES[page], hint: `Ctrl ${i + 1}`, cat: 'Go to', action: () => navigate(page) })),
  { id: 'focus', title: 'Start focus timer', cat: 'Actions', action: () => { navigate('focus'); if(!pomo.running) pomoToggle(); } },
  { id: 'tasks', title: 'Add task', cat: 'Actions', action: () => { navigate('focus'); document.getElementById('task-input').focus(); } },
  { id: 'notes', title: 'New note', cat: 'Actions', action: () => { navigate('study'); addNote(); } },
  { id: 'flashcard', title: 'Add flashcard', cat: 'Actions', action: () => { navigate('study'); document.getElementById('fc-new-term').focus(); } },
  { id: 'finance', title: 'Add expense', cat: 'Actions', action: () => { navigate('money'); document.getElementById('fin-name').focus(); } },
  { id: 'console', title: 'Open console', cat: 'Actions', action: () => openConsole() },
  { id: 'settings', title: 'Open settings', cat: 'Actions', action: () => openSettings() }
];

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); togglePalette();
  }
  if (isPaletteOpen && e.key === 'Escape') togglePalette();
});

function togglePalette() {
  isPaletteOpen = !isPaletteOpen;
  const overlay = document.getElementById('cmd-palette-overlay');
  const input = document.getElementById('cmd-input-large');
  if (isPaletteOpen) {
    overlay.classList.add('open');
    input.value = '';
    filterPalette();
    input.focus();
  } else {
    overlay.classList.remove('open');
  }
}

function filterPalette() {
  const query = document.getElementById('cmd-input-large').value.trim();
  const lowerQuery = query.toLowerCase();
  filteredCommands = [];

  if (lowerQuery.startsWith('/task ')) {
    let priority = 'med';
    let text = query.substring(6).trim();
    let lText = text.toLowerCase();
    
    if (lText.startsWith('high ')) { priority = 'high'; text = text.substring(5); }
    else if (lText.startsWith('med ')) { priority = 'med'; text = text.substring(4); }
    else if (lText.startsWith('low ')) { priority = 'low'; text = text.substring(4); }
    
    filteredCommands = [{ 
      id: 'quick-task', title: `Add ${priority} priority task: "${text}"`, cat: 'Quick add', action: () => silentAddTask(text, priority) 
    }];
  } else if (lowerQuery.startsWith('/note ')) {
    filteredCommands = [{ id: 'quick-note', title: `Save note: "${query.substring(6)}"`, cat: 'Quick add', action: () => silentAddNote(query.substring(6)) }];
  } else if (lowerQuery.startsWith('scc:')) {
    filteredCommands = [{ id: 'scc', title: `Search SCC Online for "${query.substring(4).trim()}"`, cat: 'Web', action: () => window.open(`https://www.scconline.com/Members/SearchResult.aspx?q=${encodeURIComponent(query.substring(4).trim())}`, '_blank') }];
  } else if (lowerQuery.startsWith('gh:')) {
    filteredCommands = [{ id: 'gh', title: `Search GitHub for "${query.substring(3).trim()}"`, cat: 'Web', action: () => window.open(`https://github.com/search?q=${encodeURIComponent(query.substring(3).trim())}`, '_blank') }];
  } else if (lowerQuery.startsWith('r:')) {
    filteredCommands = [{ id: 'scholar', title: `Search Google Scholar for "${query.substring(2).trim()}"`, cat: 'Web', action: () => window.open(`https://scholar.google.com/scholar?q=${encodeURIComponent(query.substring(2).trim())}`, '_blank') }];
  } else if (lowerQuery.startsWith('yt:')) {
    filteredCommands = [{ id: 'yt', title: `Search YouTube for "${query.substring(3).trim()}"`, cat: 'Web', action: () => window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query.substring(3).trim())}`, '_blank') }];
  } else {
    filteredCommands = PALETTE_COMMANDS.filter(c => c.title.toLowerCase().includes(lowerQuery) || c.cat.toLowerCase().includes(lowerQuery));
    if (query.length > 0) {
      filteredCommands.push({ id: 'search', title: `Search the web for "${query}"`, cat: 'Web', action: () => window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank') });
    }
  }
  
  paletteSelectionIdx = 0;
  renderPalette();
}

function renderPalette() {
  const container = document.getElementById('cmd-results');
  if (filteredCommands.length === 0) {
    container.innerHTML = '<div class="empty" style="padding:18px 14px;">Nothing matches. Press Enter to search the web.</div>';
    return;
  }
  
  const groups = {};
  filteredCommands.forEach((c, idx) => {
    if(!groups[c.cat]) groups[c.cat] = [];
    groups[c.cat].push({ ...c, globalIdx: idx });
  });

  let html = '';
  for (const [cat, items] of Object.entries(groups)) {
    html += `<div class="cmd-group-label">${esc(cat)}</div>`;
    items.forEach(c => {
      html += `
        <div class="cmd-item ${c.globalIdx === paletteSelectionIdx ? 'selected' : ''}" onclick="executePaletteCommand(${c.globalIdx})">
          <span>${esc(c.title)}</span>
          ${c.hint ? `<span class="cmd-hint">${esc(c.hint)}</span>` : ''}
        </div>
      `;
    });
  }
  container.innerHTML = html;
}

function handlePaletteKeys(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteSelectionIdx = (paletteSelectionIdx + 1) % filteredCommands.length; renderPalette(); } 
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSelectionIdx = (paletteSelectionIdx - 1 + filteredCommands.length) % filteredCommands.length; renderPalette(); } 
  else if (e.key === 'Enter') { e.preventDefault(); executePaletteCommand(paletteSelectionIdx); }
}

function executePaletteCommand(idx) {
  if (filteredCommands[idx]) { togglePalette(); filteredCommands[idx].action(); } 
  else {
    const val = document.getElementById('cmd-input-large').value.trim();
    if(val) { togglePalette(); window.open(`https://www.google.com/search?q=${encodeURIComponent(val)}`, '_blank'); }
  }
}

function silentAddTask(text, priority = 'med') {
  if(!text) return;
  state.tasks.unshift({id:uid(), text:text, done:false, priority:priority});
  Store.set('tasks', state.tasks);
  renderTasks(); showToast('Task added');
}

function silentAddNote(text) {
  if(!text) return;
  state.notes.unshift({id:uid(), title:'Quick Capture', body:text, updatedAt:Date.now()});
  Store.set('notes', state.notes);
  renderNotes(); showToast('Note saved');
}
