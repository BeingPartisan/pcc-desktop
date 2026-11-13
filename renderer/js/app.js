init();
renderTodayAll();
if(prefs().startPage !== 'today') navigate(prefs().startPage); // chosen in Settings > Layout
loadAppearanceExtras(); // Windows accent colour and any custom logo / background image
loadCampus(); // shows the saved Digiicampus timetable, then refreshes it if signed in
loadInbox();  // shows saved mail, then checks for new mail now and every 15 minutes
autoBackupIfDue();
// Also check hourly, for when PCC is left running for days.
setInterval(autoBackupIfDue, 60 * 60 * 1000);
