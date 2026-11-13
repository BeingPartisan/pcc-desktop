/* ---------- Navigation (icon rail + pages) ---------- */
// The app is a set of pages; exactly one is shown at a time. Each rail
// button and each .page element carries the same data-page name.

const PAGES = {
  today: 'Today',
  inbox: 'Inbox',
  focus: 'Focus',
  study: 'Study',
  academics: 'Academics',
  money: 'Money',
  life: 'Life',
  launch: 'Launch',
  system: 'System',
};
// The pages currently on the rail, in rail order. Settings > Layout can
// hide and reorder them (see applyRailLayout in appearance.js).
let PAGE_ORDER = Object.keys(PAGES);

let currentPage = 'today';
const pagesVisited = { today: true };

function navigate(page){
  if(!PAGES[page]) return;
  if(!PAGE_ORDER.includes(page)) page = 'today'; // hidden pages fall back to Today
  const firstVisit = !pagesVisited[page];
  currentPage = page;
  pagesVisited[page] = true;

  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.rail-btn[data-page]').forEach(btn => {
    const on = btn.dataset.page === page;
    btn.classList.toggle('active', on);
    if(on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  document.getElementById('page-title').textContent = PAGES[page];
  document.querySelector('.scroll-area').scrollTop = 0;

  // Expensive work is deferred until its page is actually opened.
  if(page === 'launch' && firstVisit) loadGames(false);
  if(page === 'system') loadSystemVitals();
}

// Ctrl+1 … Ctrl+9 jump straight to a page.
document.addEventListener('keydown', e => {
  if(!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const n = Number(e.key);
  if(n >= 1 && n <= PAGE_ORDER.length){
    e.preventDefault();
    navigate(PAGE_ORDER[n - 1]);
  }
});
