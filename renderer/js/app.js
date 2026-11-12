init();
renderTodayAll();
loadCampus(); // shows the saved Digiicampus timetable, then refreshes it if signed in
autoBackupIfDue();
// Also check hourly, for when PCC is left running for days.
setInterval(autoBackupIfDue, 60 * 60 * 1000);
