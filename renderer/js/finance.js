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
  renderFinanceCharts();
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

/* ---------- Spending charts ---------- */
// Two read-only views of the ledger, redrawn whenever it changes:
//   by category  - this month's spending split by tag
//   month by month - totals of archived months (financeHistory) plus this month

function renderFinanceCharts(){
  const catEl = document.getElementById('fin-category-chart');
  const monthEl = document.getElementById('fin-month-chart');
  if(!catEl || !monthEl) return;

  // By category
  const byTag = {};
  state.finances.forEach(f => { const t = f.tag || 'OTHER'; byTag[t] = (byTag[t] || 0) + f.amount; });
  const tags = Object.entries(byTag).sort((a, b) => b[1] - a[1]);
  const total = tags.reduce((sum, [, v]) => sum + v, 0);
  const max = tags.length ? tags[0][1] : 0;
  catEl.innerHTML = !tags.length ? '<div class="empty">Nothing spent yet this month.</div>' : tags.map(([tag, amount]) => `
    <div class="bar-row">
      <div class="bar-row-top">
        <span>${esc(tag.charAt(0) + tag.slice(1).toLowerCase())}</span>
        <span class="bar-row-value">₹${amount} <i>${Math.round(amount / total * 100)}%</i></span>
      </div>
      <div class="att-bar"><div class="att-bar-fill" style="width:${amount / max * 100}%; background:${colorForSubject(tag)}"></div></div>
    </div>`).join('');

  // Month by month: up to five archived months (oldest first), then this month
  const past = state.financeHistory.slice(0, 5).reverse().map(h => ({
    label: new Date(h.date).toLocaleDateString(undefined, { month: 'short' }), value: h.total, current: false,
  }));
  const months = [...past, { label: 'Now', value: total, current: true }];
  const monthMax = Math.max(1, ...months.map(m => m.value));
  const budget = state.settings.budget || 0;
  monthEl.innerHTML = `
    <div class="gpa-chart month-chart">
      ${months.map(m => `
        <div class="gpa-col ${m.current ? 'active' : ''} ${budget && m.value > budget ? 'over' : ''}" title="${budget && m.value > budget ? 'Over budget' : ''}">
          <span class="gpa-value">₹${m.value}</span>
          <span class="gpa-bar"><span style="height:${Math.max(3, m.value / monthMax * 100)}%"></span></span>
          <span class="gpa-label">${esc(m.label)}</span>
        </div>`).join('')}
    </div>
    <div class="att-meta" style="margin-top:8px;">${past.length ? (budget ? 'Months over your ₹' + budget + ' budget are shown in red.' : '') : 'Past months appear here after you start a new month.'}</div>`;
}
