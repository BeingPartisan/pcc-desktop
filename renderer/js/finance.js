/* ---------- Finance Tracker (Bug Fixed) ---------- */
function updateBudget(val) {
  // Ensure we don't accidentally set a 0 or negative budget
  let b = parseInt(val);
  state.settings.budget = (isNaN(b) || b <= 0) ? 1 : b; 
  Store.set('settings', state.settings);
  renderFinances();
}

function addFinance() {
  const name = document.getElementById('fin-name').value.trim();
  const amount = parseInt(document.getElementById('fin-amt').value);
  const type = document.getElementById('fin-type').value;
  const tag = document.getElementById('fin-tag').value;
  
  // Bug fix: strictly prevent zero or negative expenses
  if(!name || isNaN(amount) || amount <= 0) return showToast('Enter a name and an amount above zero');
  
  state.finances.push({ id: uid(), name, amount, type, tag });
  Store.set('finances', state.finances);
  
  document.getElementById('fin-name').value = '';
  document.getElementById('fin-amt').value = '';
  renderFinances();
}

function deleteFinance(id) {
  state.finances = state.finances.filter(f => f.id !== id);
  Store.set('finances', state.finances);
  renderFinances();
}

function renderFinances() {
  document.getElementById('fin-budget-input').value = state.settings.budget;

  let totalBurn = 0;
  state.finances.forEach(f => totalBurn += f.amount);

  let budget = state.settings.budget || 1; 
  
  // Bug fix: Mathematically clamp the percentage so it never goes below 0 or above 100
  let pct = Math.max(0, Math.min(100, (totalBurn / budget) * 100));
  
  let bar = document.getElementById('fin-budget-bar');
  bar.style.width = pct + '%';
  
  if (pct <= 50) bar.style.background = 'var(--accent)';
  else if (pct <= 85) bar.style.background = 'var(--amber)';
  else bar.style.background = 'var(--red)';

  document.getElementById('fin-spent-text').textContent = `₹${totalBurn} spent`;
  
  // Visual fix: Show red "over budget" text if you go negative
  let rem = budget - totalBurn;
  let remEl = document.getElementById('fin-rem-text');
  
  if(rem >= 0) {
    remEl.textContent = `₹${rem} remaining`;
    remEl.style.color = 'var(--ink)';
  } else {
    remEl.textContent = `₹${Math.abs(rem)} over budget`;
    remEl.style.color = 'var(--red)';
  }

  const list = document.getElementById('fin-list');
  if (state.finances.length === 0) {
    list.innerHTML = '<div class="empty">No spending recorded this month.</div>';
    return;
  }

  let groups = {};
  state.finances.forEach(f => {
    let t = f.tag || 'OTHER';
    if(!groups[t]) groups[t] = [];
    groups[t].push(f);
  });

  let html = '';
  for(let tag in groups) {
    html += `<div class="cmd-group-label">${esc(tag.charAt(0) + tag.slice(1).toLowerCase())}</div>`;
    groups[tag].forEach(f => {
      const typeLabel = f.type === 'sub' ? '<span class="pill" style="margin-left:8px;">Monthly</span>' : '';
      const amountClass = f.type === 'sub' ? 'finance-amt' : 'finance-amt expense';
      html += `
        <div class="item-row" style="padding: 6px 12px; margin-bottom: 4px;">
          <div style="flex:1; display:flex; align-items:center;">
            <span class="txt" style="font-weight:500; font-size:13px;">${esc(f.name)}</span>
            ${typeLabel}
          </div>
          <span class="${amountClass}">₹${f.amount}</span>
          <button class="btn btn-icon btn-danger" style="border:none; padding:4px; margin-left:8px;" onclick="deleteFinance('${f.id}')">&times;</button>
        </div>
      `;
    });
  }
  list.innerHTML = html;
}

function toggleFinanceHistory() {
  finViewMode = finViewMode === 'main' ? 'history' : 'main';
  document.getElementById('fin-main-view').style.display = finViewMode === 'main' ? 'block' : 'none';
  document.getElementById('fin-history-view').style.display = finViewMode === 'history' ? 'flex' : 'none';
  if(finViewMode === 'history') renderFinanceHistory();
}

function renderFinanceHistory() {
  let el = document.getElementById('fin-history-list');
  if(state.financeHistory.length === 0) {
    el.innerHTML = '<div class="empty">No past months yet.</div>';
    return;
  }
  
  let grandTotal = 0;
  let html = '';
  
  state.financeHistory.forEach(h => {
    grandTotal += h.total;
    let d = new Date(h.date);
    let monthStr = d.toLocaleDateString(undefined, {month:'long', year:'numeric'});
    html += `
      <div class="item-row" style="flex-direction:column; align-items:flex-start; gap:4px; margin-bottom:6px;">
        <div style="display:flex; justify-content:space-between; width:100%;">
          <span style="font-weight:500;">${monthStr}</span>
          <span class="finance-amt">₹${h.total}</span>
        </div>
        <div style="font-size:11px; color:var(--ink-dim);">${h.items.length} items archived</div>
      </div>
    `;
  });
  
  html = `<div style="margin-bottom:12px; font-size:13px; border-bottom: 1px solid var(--line); padding-bottom: 8px;">
            <span style="color:var(--ink-dim);">Total across past months</span> 
            <span class="finance-amt" style="font-size:15px; float:right;">₹${grandTotal}</span>
          </div>` + html;
          
  el.innerHTML = html;
}

function cycleMonth() {
  if(!confirm("Archive this month and start a new one? Subscriptions carry over; one-off expenses are cleared.")) return;
  
  let totalBurn = 0;
  state.finances.forEach(f => totalBurn += f.amount);

  state.financeHistory.unshift({
    id: uid(),
    date: new Date().toISOString(),
    total: totalBurn,
    items: [...state.finances]
  });

  // Wipe one-offs, keep subs
  state.finances = state.finances.filter(f => f.type === 'sub');
  
  Store.set('finances', state.finances);
  Store.set('financeHistory', state.financeHistory);
  
  renderFinances();
  if(finViewMode === 'history') renderFinanceHistory();
  showToast('Month archived. Subscriptions carried over.');
}
