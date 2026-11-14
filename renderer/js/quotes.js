/* ---------- Quotes ---------- */
// The quote shown on the Life page and on the island. Quotes come from a
// pool: a few built in (QUOTES in core.js), topped up from a free online
// source when "Fresh quotes" is on in Settings. The pool is saved, so the
// app still has variety offline. A new quote is shown on Shuffle and each
// time a focus session finishes, as a small reward for the work.
//
// Only short quotes are kept, because the island has one line to show them.

const QUOTE_MAX_CHARS = 110;
const QUOTE_POOL_MAX = 60;
const QUOTE_REFILL_BELOW = 12;                  // top up when fewer unseen quotes than this remain
const QUOTE_REFILL_EVERY_MS = 12 * 60 * 60 * 1000;

let quotePool = Store.get('quotePool', { fetchedAt: 0, items: [] }); // items: [{ text, author }]
let currentWidgetAuthor = '';
let quotesSeen = new Set();                     // texts shown this session, to avoid repeats

function allQuotes(){
  const builtIn = QUOTES.map(text => ({ text, author: '' }));
  return prefs().quotesOnline ? [...quotePool.items, ...builtIn] : builtIn;
}

// Picks a quote that hasn't been shown this session (starting over once all have).
function showNextQuote(){
  const all = allQuotes();
  let fresh = all.filter(q => !quotesSeen.has(q.text));
  if(!fresh.length){ quotesSeen = new Set(); fresh = all.filter(q => q.text !== currentWidgetQuote); }
  const pick = fresh[Math.floor(Math.random() * fresh.length)] || all[0];
  quotesSeen.add(pick.text);
  currentWidgetQuote = pick.text;
  currentWidgetAuthor = pick.author || '';
  updateAestheticWidget(); // also refreshes the island
  if(fresh.length < QUOTE_REFILL_BELOW) refillQuotes();
}

// Fetches a batch of quotes (in the main process, which isn't bound by the
// browser's cross-site rules) and adds the short ones to the pool.
async function refillQuotes(){
  if(!prefs().quotesOnline || !window.pcc || !window.pcc.fetchQuotes) return;
  try{
    const result = await window.pcc.fetchQuotes();
    if(!result.ok) return;
    const known = new Set(quotePool.items.map(q => q.text));
    const added = result.quotes.filter(q => q.text && q.text.length <= QUOTE_MAX_CHARS && !known.has(q.text));
    quotePool = { fetchedAt: Date.now(), items: [...added, ...quotePool.items].slice(0, QUOTE_POOL_MAX) };
    Store.set('quotePool', quotePool);
  } catch(e){
    console.error('Could not fetch quotes', e); // offline is fine; the saved pool carries on
  }
}

// At startup: show something straight away, then top up in the background if the pool is thin or old.
function initQuotes(){
  showNextQuote();
  if(quotePool.items.length < QUOTE_REFILL_BELOW || Date.now() - quotePool.fetchedAt > QUOTE_REFILL_EVERY_MS) refillQuotes();
}
