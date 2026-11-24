/* ---------- Feedback ---------- */
// "Send feedback" lets anyone using PCC send a bug report or an idea to the
// developer. The report is encrypted and sent by the main process (see
// feedback.js there), which also keeps trying until it is confirmed.
//
// On the developer's own computer there is one more thing: a Feedback tab
// in Settings listing what has arrived.

const FEEDBACK_PROMPTS = {
  bug: 'What happened, and what did you expect?',
  idea: 'What would you like PCC to do?',
  other: 'What\'s on your mind?',
};
const FEEDBACK_PROMPTS_FUN = {
  bug: 'What broke, and what did you expect? Spill the tea.',
  idea: 'What should PCC do? Pitch it like Shark Tank.',
  other: 'What’s on your mind, bhai?',
};

const feedback = {
  type: 'bug',
  developer: false,   // this computer can read reports
  reports: [],        // newest first (developer only)
  done: new Set(),
  filter: 'open',
};

/* ----- Sending ----- */

function setFeedbackType(type){
  feedback.type = type;
  document.querySelectorAll('#feedback-type button').forEach(b => b.classList.toggle('active', b.dataset.value === type));
  document.getElementById('feedback-text-label').textContent = say(FEEDBACK_PROMPTS[type], FEEDBACK_PROMPTS_FUN[type]);
  document.getElementById('feedback-log').checked = type === 'bug' && document.getElementById('feedback-log').checked;
}

function openFeedback(){
  document.getElementById('feedback-name').value = state.settings.name || '';
  document.getElementById('feedback-overlay').classList.add('open');
  document.getElementById('feedback-text').focus();
}

function closeFeedback(){ document.getElementById('feedback-overlay').classList.remove('open'); }

async function sendFeedback(){
  const text = document.getElementById('feedback-text').value.trim();
  if(!text){ showToast(sayAny('Write a few words first', 'Write a few words first. Telepathy isn’t a feature yet.', 'Write a few words first, bro. Empty feedback is just vibes.')); return; }
  const button = document.getElementById('feedback-send-btn');
  button.disabled = true;
  try {
    const result = await window.pcc.feedbackSend({
      type: feedback.type, text,
      name: document.getElementById('feedback-name').value,
      includeLog: document.getElementById('feedback-log').checked,
    });
    if(!result.ok){ showToast(result.error || sayAny('Could not send', 'Could not send. Try again in a bit, your words matter.')); return; }
    document.getElementById('feedback-text').value = '';
    closeFeedback();
    showToast(result.sent
      ? sayAny('Sent. Thank you!', 'Sent. Thank you! Legend behaviour.', 'Sent. You’re basically on the dev team now.', 'Sent. Partisan owes you one.')
      : sayAny('Saved. It will be sent when you\'re back online.', 'Saved. It will be sent when you’re back online. Wi-Fi went for chai, it seems.'));
    showFeedbackPending(result.pending);
  } finally { button.disabled = false; }
}

// A quiet note in Settings > About while a report hasn't been confirmed yet.
function showFeedbackPending(count){
  document.getElementById('feedback-pending').textContent = count ? `${count} report${count === 1 ? '' : 's'} sent, waiting for confirmation that ${count === 1 ? 'it' : 'they'} arrived.` : '';
}

/* ----- Developer inbox ----- */

function setFeedbackFilter(filter){
  feedback.filter = filter;
  document.querySelectorAll('#feedback-filter button').forEach(b => b.classList.toggle('active', b.dataset.value === filter));
  renderFeedbackInbox();
}

async function toggleFeedbackDone(id){
  const done = !feedback.done.has(id);
  const result = await window.pcc.feedbackMark(id, done);
  if(!result.ok){ showToast(sayAny('Could not save that', 'Could not save that. Try once more, boss.')); return; }
  if(done) feedback.done.add(id); else feedback.done.delete(id);
  renderFeedbackInbox();
}

function renderFeedbackInbox(){
  const list = document.getElementById('feedback-list');
  const labels = { bug: 'Bug', idea: 'Idea', other: 'Other' };
  const shown = feedback.reports.filter(r => feedback.filter === 'all' || (feedback.filter === 'done') === feedback.done.has(r.id));
  const time = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: !use24Hour() });
  list.innerHTML = shown.length ? shown.map(r => `
    <div class="feedback-item ${feedback.done.has(r.id) ? 'done' : ''}">
      <div class="feedback-head">
        <span class="feedback-kind ${esc(r.type)}">${labels[r.type] || 'Other'}</span>
        <span style="flex:1; min-width:0;">${esc(r.name || 'No name')} · ${esc(time(r.sentAt))} · v${esc(r.version)} · ${esc(r.os)}</span>
        <button class="btn" onclick="toggleFeedbackDone('${esc(r.id)}')">${feedback.done.has(r.id) ? 'Reopen' : 'Done'}</button>
      </div>
      <div class="msg-body" style="white-space:pre-wrap;">${esc(r.text)}</div>
      ${r.log ? `<details><summary>Activity log</summary><pre>${esc(r.log)}</pre></details>` : ''}
    </div>`).join('')
    : `<div class="empty">${feedback.filter === 'open'
      ? say('Nothing open.', 'Nothing open. Zero bugs? Damn bro, you’re on fire.', 'Nothing open. Either PCC is perfect or nobody’s using it.')
      : say('Nothing here.', 'Nothing here. Just tumbleweeds.')}</div>`;
  const open = feedback.reports.filter(r => !feedback.done.has(r.id)).length;
  document.getElementById('feedback-tab').textContent = open ? `Feedback (${open})` : 'Feedback';
}

async function initFeedback(){
  if(!window.pcc || !window.pcc.feedbackStatus) return;
  const status = await window.pcc.feedbackStatus();
  showFeedbackPending(status.pending);
  feedback.developer = !!status.developer;
  if(!feedback.developer) return;
  const inbox = await window.pcc.feedbackList();
  feedback.reports = inbox.reports;
  feedback.done = new Set(inbox.done);
  document.getElementById('feedback-folder').textContent = inbox.folder;
  document.getElementById('feedback-tab').style.display = '';
  renderFeedbackInbox();
}

if(window.pcc && window.pcc.onFeedbackReceived){
  // A report arrived on the developer's computer: list it, and show it on the island like a message.
  window.pcc.onFeedbackReceived((report) => {
    if(feedback.reports.some(r => r.id === report.id)) return;
    feedback.reports.unshift(report);
    renderFeedbackInbox();
    const label = report.type === 'bug' ? 'Bug report' : report.type === 'idea' ? 'Idea' : 'Feedback';
    showToast(`${label} from ${report.name || 'someone'}`);
    addUnread({ id: report.id, channelId: '', channel: label, from: report.name || 'Someone', text: report.text, ts: report.sentAt });
    pushIsland();
  });
  window.pcc.onFeedbackDelivered((status) => {
    showFeedbackPending(status.pending);
    showToast(sayAny('Your feedback arrived. Thank you!', 'Your feedback arrived. Thank you, legend!', 'Your feedback arrived. The dev has been summoned.'));
  });
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && document.getElementById('feedback-overlay').classList.contains('open')) closeFeedback();
});
