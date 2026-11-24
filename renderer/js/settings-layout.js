/* ---------- Settings: layout and search ---------- */
// Dresses the Settings window in its newer look, without rewriting each page:
//   - the list on the left gets an icon per page, a search box, and you at the bottom
//   - each page gets a header (icon, title, one line) and its rows are grouped
//     into cards; a heading inside a page (h3.pane-subtitle) starts a new card
//   - typing in the search box shows the matching settings from every page,
//     still working in place
// The controls themselves are moved, not copied, so every id and handler stays as it was.

const SETTINGS_ICONS = {
  general: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  appearance: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 9.8C21 6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
  layout: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  island: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="8" cy="12" r="1.3"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  sounds: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  timetable: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  messages: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  performance: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/><circle cx="12" cy="14" r="1.2"/>',
  data: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  feedback: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6"/>',
  dev: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
};
const settingsIcon = (tab) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SETTINGS_ICONS[tab] || SETTINGS_ICONS.general}</svg>`;

(function dressSettings(){
  const nav = document.querySelector('.settings-nav');
  if(!nav || nav.dataset.dressed) return;
  nav.dataset.dressed = '1';

  // The list: icons, a search box under the title, and you at the bottom.
  nav.querySelectorAll('.settings-tab').forEach(tab => {
    const label = tab.innerHTML;
    tab.innerHTML = `<span class="settings-tab-icon">${settingsIcon(tab.dataset.tab)}</span><span class="settings-tab-label">${label}</span>`;
  });
  // The Feedback tab rewrites its own text ("Feedback (2)"); keep its icon when it does.
  const fb = document.getElementById('feedback-tab');
  if(fb){
    const label = fb.querySelector('.settings-tab-label');
    Object.defineProperty(fb, 'textContent', { configurable: true, get: () => label.textContent, set: (v) => { label.textContent = v; } });
  }
  nav.querySelector('.settings-title').insertAdjacentHTML('afterend', `
    <label class="settings-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="settings-search" type="text" placeholder="Search settings" autocomplete="off" spellcheck="false" aria-label="Search settings" /></label>`);
  const foot = document.getElementById('about-version-short');
  if(foot){
    foot.insertAdjacentHTML('beforebegin', `<button class="settings-me" onclick="showSettingsTab('general')" title="Your name and city are in General"><span class="settings-me-avatar" id="settings-me-avatar"></span><span class="settings-me-text"><b id="settings-me-name"></b></span></button>`);
    document.querySelector('.settings-me-text').appendChild(foot);
  }

  // Long pages are split into named cards: [card title, the first setting in it].
  const SECTIONS = {
    general: [['About you', 'Your name'], ['Handy stuff', 'Global shortcut'], ['Starting up', 'Start when I sign in']],
    appearance: [['Colours', 'Colour theme'], ['Size and motion', 'Density'], ['Make it yours', 'Logo']],
    layout: [['Today', 'Start page'], ['Pages', 'Pages']],
    island: [['Basics', 'Show the island'], ['Extras', 'Quick capture'], ['Desktop visualiser', 'Desktop visualiser']],
    performance: [['Right now', 'What PCC is using']],
    messages: [['Channels', 'Your channels'], ['Alerts', 'Windows notification'], ['Announcements', 'Send a message']],
    data: [['Your data', 'Export'], ['Danger zone', 'Reset all data']],
  };
  for(const [tab, list] of Object.entries(SECTIONS)){
    const pane = document.querySelector(`.settings-pane[data-tab="${tab}"]`);
    if(!pane) continue;
    for(const [heading, first] of list){
      const row = [...pane.children].find(el => (el.matches('.setting-row, .setting-block')) && (el.querySelector('.setting-name') || {}).textContent?.trim() === first);
      if(!row || (row.previousElementSibling && row.previousElementSibling.matches('h3.pane-subtitle'))) continue;
      row.insertAdjacentHTML('beforebegin', `<h3 class="pane-subtitle">${heading}</h3>`);
    }
  }
  // The music heading on the Island page says what it's about.
  document.querySelectorAll('.settings-pane[data-tab="island"] > h3.pane-subtitle').forEach(h => { if(h.textContent.trim() === 'Music') h.textContent = 'Island music'; });

  // Each page: a header, then cards.
  document.querySelectorAll('.settings-pane').forEach(pane => {
    const tab = pane.dataset.tab;
    const title = pane.querySelector(':scope > .pane-title');
    const intro = pane.querySelector(':scope > .pane-intro');
    const head = document.createElement('header');
    head.className = 'pane-head';
    head.innerHTML = `<span class="pane-head-icon">${settingsIcon(tab)}</span><div class="pane-head-text"></div>`;
    if(title) head.querySelector('.pane-head-text').appendChild(title);
    if(intro) head.querySelector('.pane-head-text').appendChild(intro);
    head.addEventListener('click', () => { if(document.getElementById('settings-body').classList.contains('searching')) { clearSettingsSearch(); showSettingsTab(tab); } });

    const children = [...pane.children];
    pane.prepend(head);
    let card = null;
    const newCard = (heading) => {
      card = document.createElement('div');
      card.className = 'settings-card';
      if(heading){ heading.classList.add('settings-card-title'); card.appendChild(heading); }
      pane.appendChild(card);
    };
    for(const el of children){
      if(el === title || el === intro) continue;
      if(el.matches('h3.pane-subtitle')){ newCard(el); continue; }
      if(!card) newCard(null);
      card.appendChild(el);
    }
  });
  document.querySelector('.settings-body').id = 'settings-body';
})();

function renderSettingsMe(){
  const name = (state.settings && state.settings.name) || 'You';
  const n = document.getElementById('settings-me-name');
  if(n) n.textContent = name;
  const a = document.getElementById('settings-me-avatar');
  if(a) a.textContent = name.trim().charAt(0).toUpperCase() || '?';
}
renderSettingsMe();

/* ----- Search ----- */

function clearSettingsSearch(){
  const input = document.getElementById('settings-search');
  if(input) input.value = '';
  runSettingsSearch('');
}

function runSettingsSearch(query){
  const q = query.trim().toLowerCase();
  const body = document.getElementById('settings-body');
  body.classList.toggle('searching', !!q);
  const things = body.querySelectorAll('.settings-card .setting-row, .settings-card .setting-block');
  let found = 0;
  things.forEach(el => {
    const hit = !q || el.textContent.toLowerCase().includes(q);
    el.classList.toggle('search-miss', !hit);
    if(q && hit && el.offsetParent !== null) found++;
  });
  body.querySelectorAll('.settings-card').forEach(card => {
    const any = !q || [...card.querySelectorAll('.setting-row, .setting-block')].some(el => !el.classList.contains('search-miss'))
      || (card.querySelector('.settings-card-title') || {}).textContent?.toLowerCase().includes(q);
    if(q && any && card.querySelector('.settings-card-title') && card.querySelector('.settings-card-title').textContent.toLowerCase().includes(q))
      card.querySelectorAll('.search-miss').forEach(el => el.classList.remove('search-miss'));   // the heading matched: show the whole card
    card.classList.toggle('search-miss', !any);
  });
  body.querySelectorAll('.settings-pane').forEach(pane => {
    const tabHidden = document.querySelector(`.settings-tab[data-tab="${pane.dataset.tab}"]`);
    const shown = tabHidden && tabHidden.style.display !== 'none';
    const any = shown && [...pane.querySelectorAll('.settings-card')].some(c => !c.classList.contains('search-miss'));
    pane.classList.toggle('search-hit', !!q && any);
  });
  let empty = document.getElementById('settings-search-empty');
  if(!empty){ body.insertAdjacentHTML('beforeend', '<div id="settings-search-empty"></div>'); empty = document.getElementById('settings-search-empty'); }
  const anyPane = body.querySelector('.settings-pane.search-hit');
  empty.hidden = !q || !!anyPane;
  empty.innerHTML = `<b>Nothing called “${esc(query.trim())}” in here.</b><span>Try “music”, “theme”, “battery” or “sync”.</span>`;
  if(q) body.scrollTop = 0;
}

document.getElementById('settings-search')?.addEventListener('input', (e) => runSettingsSearch(e.target.value));
document.getElementById('settings-search')?.addEventListener('keydown', (e) => { if(e.key === 'Escape' && e.target.value){ e.stopPropagation(); clearSettingsSearch(); } });

// Picking a page from the list leaves the search.
const settingsShowTab = showSettingsTab;
showSettingsTab = function(tab){
  if(document.getElementById('settings-body')?.classList.contains('searching')) clearSettingsSearch();
  settingsShowTab(tab);
  renderSettingsMe();
};
