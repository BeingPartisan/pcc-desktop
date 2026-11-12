// --- Games Library ---

let gamesCache = [];

function formatBytes(bytes){
  if(!bytes) return '0 GB';
  const gb = bytes / (1024**3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes/(1024**2)).toFixed(0)} MB`;
}

function formatPlaytime(seconds){
  if(!seconds) return '0 hrs';
  const hrs = seconds / 3600;
  return hrs >= 1 ? `${hrs.toFixed(1)} hrs` : `${Math.round(seconds/60)} min`;
}

async function chooseGamesFolder(){
  const folder = await window.pcc.pickGamesFolder();
  if(folder){
    document.getElementById('games-folder-label').textContent = folder;
    loadGames();
  }
}

async function loadGamesFolderLabel(){
  const cfg = await window.pcc.getGamesConfig();
  document.getElementById('games-folder-label').textContent = cfg.gamesDir || 'No folder chosen yet.';
}

// force=true (the Refresh button) recomputes folder sizes instead of using
// the cached ones.
async function loadGames(force){
  const body = document.getElementById('games-body');
  body.innerHTML = '<div class="empty">Looking for games&hellip;</div>';
  try{
    gamesCache = await window.pcc.scanGames(!!force);
  } catch(e){
    gamesCache = [];
    console.error('Games scan failed', e);
  }
  renderGames();
}

function renderGames(){
  const body = document.getElementById('games-body');
  if(!gamesCache.length){
    body.innerHTML = '<div class="empty">No games found. Choose the folder that holds your games.</div>';
    return;
  }
  body.innerHTML = gamesCache.map(g => `
    <div class="game-tile">
      <div class="game-tile-icon">${g.icon ? `<img src="${g.icon}" />` : `<span class="link-avatar lg">${esc((g.name || '?').charAt(0).toUpperCase())}</span>`}</div>
      <div class="game-tile-body">
        <div class="game-tile-name" title="${esc(g.name)}">${esc(g.name)}</div>
        <div class="game-tile-meta"><span>${formatBytes(g.sizeBytes)}</span><span>${formatPlaytime(g.playtimeSeconds)}</span></div>
        <button class="btn btn-primary game-tile-launch" data-exe="${esc(g.exePath)}">Play</button>
      </div>
    </div>
  `).join('');

  body.querySelectorAll('.game-tile-launch').forEach(btn => {
    btn.addEventListener('click', async () => {
      const result = await window.pcc.launchGame(btn.dataset.exe);
      if(result && !result.ok) showToast('Could not launch game: ' + (result.error || 'unknown error'));
    });
  });
}

if(window.pcc && window.pcc.onGameSessionEnded){
  window.pcc.onGameSessionEnded(({ exePath, totalSeconds }) => {
    const game = gamesCache.find(g => g.exePath === exePath);
    if(game){
      game.playtimeSeconds = totalSeconds;
      renderGames();
    }
  });
}
