/* ---------- Active Recall (Flashcards) ---------- */
let fcSession = [];
let fcHovered = false;
let fcIsLibrary = false;
let currentDeck = 'All';

function initFlashcards() {
  changeFcDeck('All');
}

function changeFcDeck(deck) {
  currentDeck = deck;
  fcSession = currentDeck === 'All'
    ? [...state.flashcards]
    : state.flashcards.filter(c => (c.deck || 'GEN').toUpperCase() === currentDeck);
  
  fcSession.sort(() => Math.random() - 0.5);
  currentFcIdx = 0;
  populateDeckDropdown();
  renderFlashcards();
}

function populateDeckDropdown() {
  const select = document.getElementById('fc-deck-select');
  const decks = [...new Set(state.flashcards.map(c => (c.deck || 'GEN').toUpperCase()))];
  let html = `<option value="All">All Decks</option>`;
  decks.forEach(d => { html += `<option value="${d}" ${currentDeck === d ? 'selected' : ''}>${esc(d)}</option>`; });
  select.innerHTML = html;
}

function renderFlashcards() {
  const termDisplay = document.getElementById('fc-term-display');
  const defDisplay = document.getElementById('fc-def-display');
  const metaDisplay = document.getElementById('fc-meta-display');
  const container = document.getElementById('fc-active');
  
  container.classList.remove('flipped');
  
  if (state.flashcards.length === 0) {
    termDisplay.textContent = "No cards yet";
    defDisplay.textContent = "Add your first card below.";
    metaDisplay.textContent = "";
    return;
  }
  
  if (fcSession.length === 0) {
    termDisplay.textContent = "All done";
    defDisplay.textContent = "You've been through this deck. Click to go again.";
    metaDisplay.textContent = "Click to go again";
    container.onclick = () => { changeFcDeck(currentDeck); container.onclick = () => container.classList.toggle('flipped'); };
    return;
  }

  container.onclick = () => container.classList.toggle('flipped');
  if (currentFcIdx >= fcSession.length) currentFcIdx = 0;
  
  const card = fcSession[currentFcIdx];
  termDisplay.textContent = card.term;
  defDisplay.textContent = card.def;
  metaDisplay.textContent = `${(card.deck||'GEN').toUpperCase()}  ·  ${fcSession.length} left  ·  Space to flip`;
}

function fcReview(gotIt) {
  if (fcSession.length === 0) return;
  const container = document.getElementById('fc-active');
  container.classList.remove('flipped');
  
  setTimeout(() => {
    if (gotIt) {
      fcSession.splice(currentFcIdx, 1);
      if (currentFcIdx >= fcSession.length) currentFcIdx = 0;
    } else {
      currentFcIdx = (currentFcIdx + 1) % fcSession.length;
    }
    renderFlashcards();
  }, 150);
}

function addFlashcard() {
  const deck = (document.getElementById('fc-new-deck').value.trim() || 'GEN').toUpperCase();
  const term = document.getElementById('fc-new-term').value.trim();
  const def = document.getElementById('fc-new-def').value.trim();
  if(!term || !def) return showToast('Enter both a term and a definition');
  
  const newCard = { id: uid(), deck, term, def };
  state.flashcards.push(newCard);
  Store.set('flashcards', state.flashcards);
  
  document.getElementById('fc-new-term').value = '';
  document.getElementById('fc-new-def').value = '';
  
  populateDeckDropdown();
  if(currentDeck === 'All' || currentDeck === deck) fcSession.push(newCard);
  
  renderFlashcards();
  if(fcIsLibrary) renderFcLibrary();
  showToast('Card added');
}

function toggleFcLibrary() {
  fcIsLibrary = !fcIsLibrary;
  document.getElementById('fc-study-view').style.display = fcIsLibrary ? 'none' : 'block';
  document.getElementById('fc-library-view').style.display = fcIsLibrary ? 'flex' : 'none';
  if(fcIsLibrary) renderFcLibrary();
}

function renderFcLibrary() {
  const view = document.getElementById('fc-library-view');
  if(state.flashcards.length === 0) {
    view.innerHTML = '<div class="empty">No cards yet.</div>'; return;
  }
  view.innerHTML = state.flashcards.map(c => `
    <div class="item-row" style="align-items:flex-start;">
      <div style="flex:1;">
        <div style="font-weight:600; font-size:13px;"><span class="pill" style="margin-right:6px;">${esc(c.deck||'GEN')}</span> ${esc(c.term)}</div>
        <div style="font-size:12px; color:var(--ink-dim); margin-top:4px;">${esc(c.def)}</div>
      </div>
      <button class="btn btn-icon btn-danger" style="border:none; padding:4px;" onclick="deleteFlashcard('${c.id}')">&times;</button>
    </div>
  `).join('');
}

function deleteFlashcard(id) {
  state.flashcards = state.flashcards.filter(c => c.id !== id);
  Store.set('flashcards', state.flashcards);
  fcSession = fcSession.filter(c => c.id !== id);
  populateDeckDropdown();
  renderFlashcards();
  if(fcIsLibrary) renderFcLibrary();
}

document.addEventListener('keydown', e => {
  if (fcHovered && !fcIsLibrary && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !isPaletteOpen) {
    if (e.code === 'Space') {
      e.preventDefault();
      const container = document.getElementById('fc-active');
      if(fcSession.length > 0) container.classList.toggle('flipped');
      else container.click(); 
    } else if (e.code === 'ArrowRight') {
      e.preventDefault(); fcReview(true);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault(); fcReview(false);
    }
  }
});
