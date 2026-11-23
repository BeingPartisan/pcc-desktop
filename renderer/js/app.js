// A first run is one with nothing saved yet; it gets the welcome (welcome.js).
if(!localStorage.getItem('settings') && !localStorage.getItem('tasks')) localStorage.setItem('__welcomePending', '1');
init();
renderTodayAll();
if(prefs().startPage !== 'today') navigate(prefs().startPage); // chosen in Settings > Layout
loadAppearanceExtras(); // Windows accent colour and any custom logo / background image
loadCampus(); // shows the saved Digiicampus timetable, then refreshes it if signed in
initQuotes();             // first quote, and a top-up from the internet if needed
configurePerformance();    // Settings > Performance, before the parts it governs start
configureIsland();         // creates the floating island if it's switched on
configureDesktop();       // draws the dashboard on the desktop if Desktop mode is on
configureMessages().then(() => setTimeout(syncAllCountdowns, 4000)); // listens on the message channels, then shares countdowns
renderCountdowns();
initFeedback();
renderWorkspaces();
checkWhatsNew();          // once per version, before the welcome marks this as a fresh install
if(localStorage.getItem(WELCOME_PENDING_KEY)) showWelcome();
loadInbox();  // shows saved mail, then checks for new mail now and every 15 minutes
autoBackupIfDue();
// Also check hourly, for when PCC is left running for days.
setInterval(autoBackupIfDue, 60 * 60 * 1000);
