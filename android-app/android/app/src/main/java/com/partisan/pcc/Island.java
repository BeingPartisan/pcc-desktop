package com.partisan.pcc;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The island on Android: one Live Update (Android 16's promoted ongoing
 * notification). Phones with an island-style area show it there; others show
 * it pinned at the top of the notifications.
 *
 * The app hands over what could show and when (IslandPlugin.setSchedule):
 *   class     from `lead` minutes before it until it ends; counts down, with a progress bar
 *   deadline  a deadline due today, from the morning                       (Done button)
 *   tomorrow  a deadline due tomorrow, from the evening before            (Done button)
 *   overdue   deadlines past their date, in the morning
 *   tasks     high-priority tasks, from a chosen time
 * Only one shows at a time: the one with the lowest `priority` (that order).
 * "Hide" puts the island away for a few hours; it comes back by itself.
 *
 * This class works out what to show at any moment and sets an alarm for the
 * next change, so it keeps going with the app closed. IslandReceiver runs it
 * on each alarm, after a restart, and for the notification's buttons.
 */
final class Island {
    static final String CHANNEL = "island";
    static final int NOTIFICATION_ID = 4201;
    static final String ACTION_REFRESH = "com.partisan.pcc.ISLAND_REFRESH";
    static final String ACTION_DONE = "com.partisan.pcc.ISLAND_DONE";
    static final String ACTION_HIDE = "com.partisan.pcc.ISLAND_HIDE";
    private static final String PREFS = "pcc-island";
    private static final long MINUTE = 60 * 1000;

    static final class Item {
        String kind, title, text, chip, room, key;
        long start, end;      // for a class: the class itself; otherwise: when it may show
        int priority;
    }

    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void save(Context ctx, String json, boolean enabled, int leadMinutes, int hideHours) {
        prefs(ctx).edit().putString("items", json).putBoolean("enabled", enabled).putInt("lead", leadMinutes).putInt("hideHours", hideHours).apply();
    }

    private static List<Item> load(Context ctx) {
        List<Item> out = new ArrayList<>();
        Set<String> done = doneKeys(ctx);
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString("items", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Item it = new Item();
                it.kind = o.optString("kind", "class");
                it.title = o.optString("title", "");
                it.text = o.optString("text", "");
                it.chip = o.optString("chip", "");
                it.room = o.optString("room", "");
                it.key = o.optString("key", "");
                it.start = o.getLong("start");
                it.end = o.getLong("end");
                it.priority = o.optInt("priority", 9);
                if (it.end > it.start && (it.key.isEmpty() || !done.contains(it.key))) out.add(it);
            }
        } catch (Exception ignored) { }
        return out;
    }

    /** When an item may show: a class from `lead` minutes before it; anything else, its window. */
    private static long showsFrom(Item it, long lead) { return "class".equals(it.kind) ? it.start - lead : it.start; }

    /** Show (or hide) what's right for now, and set the alarm for the next change. */
    static void refresh(Context ctx) {
        long now = System.currentTimeMillis();
        SharedPreferences p = prefs(ctx);
        boolean enabled = p.getBoolean("enabled", true);
        long lead = p.getInt("lead", 60) * MINUTE;
        long hiddenUntil = p.getLong("hiddenUntil", 0);
        List<Item> items = enabled ? load(ctx) : new ArrayList<>();

        Item show = null;
        for (Item it : items) {
            if (now >= it.end || now < showsFrom(it, lead)) continue;
            if (show == null || it.priority < show.priority || (it.priority == show.priority && it.start < show.start)) show = it;
        }

        // The next moment something could change: an item starting or ending, the end of a hide.
        long next = Long.MAX_VALUE;
        for (Item it : items) {
            long from = showsFrom(it, lead);
            if (from > now) next = Math.min(next, from);
            if (it.end > now) next = Math.min(next, it.end);
            if ("class".equals(it.kind) && it.start > now) next = Math.min(next, it.start);
        }
        if (hiddenUntil > now) {
            NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
            next = Math.min(next, hiddenUntil);
        } else if (show != null) {
            post(ctx, show, now, lead);
            if ("class".equals(show.kind)) next = Math.min(next, now + MINUTE);   // the countdown moves every minute
        } else {
            NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
        }
        schedule(ctx, next == Long.MAX_VALUE ? 0 : next);
    }

    private static void post(Context ctx, Item it, long now, long lead) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Island", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Your next class, deadlines and tasks, at the top of the screen.");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_island)
                .setContentTitle(it.title)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(tap)
                .setShowWhen(false)
                .setRequestPromotedOngoing(true);

        if ("class".equals(it.kind)) {
            boolean on = now >= it.start;
            SimpleDateFormat clock = new SimpleDateFormat("h:mm a", Locale.getDefault());
            long mins = Math.max(1, Math.round(((on ? it.end : it.start) - now) / 60000.0));
            String room = it.room == null || it.room.isEmpty() ? "" : " · " + it.room;
            b.setContentText(on ? "Now · ends " + clock.format(new Date(it.end)) + room
                                : "In " + longTime(mins) + " · " + clock.format(new Date(it.start)) + room)
             .setCategory(NotificationCompat.CATEGORY_EVENT)
             // The capsule: just the time, e.g. "in 18m" before, "48m left" during, refreshed every minute.
             .setShortCriticalText(on ? shortTime(mins) + " left" : "in " + shortTime(mins));
            // Progress: through the class while it's on; through the lead-up before it.
            long from = on ? it.start : it.start - lead, to = on ? it.end : it.start;
            int pct = (int) Math.max(0, Math.min(100, (now - from) * 100 / Math.max(1, to - from)));
            List<NotificationCompat.ProgressStyle.Segment> segments = new ArrayList<>();
            segments.add(new NotificationCompat.ProgressStyle.Segment(100).setColor(Color.parseColor("#C9F26C")));
            b.setStyle(new NotificationCompat.ProgressStyle().setProgressSegments(segments).setProgress(pct).setStyledByProgress(true));
        } else {
            b.setContentText(it.text)
             .setStyle(new NotificationCompat.BigTextStyle().bigText(it.text))
             .setCategory(NotificationCompat.CATEGORY_REMINDER)
             .setShortCriticalText(it.chip);
            // A single deadline can be ticked off right here.
            if (!it.key.isEmpty()) b.addAction(0, "Done", broadcast(ctx, ACTION_DONE, it.key, 10));
        }
        int hours = prefs(ctx).getInt("hideHours", 3);
        b.addAction(0, "Hide " + hours + "h", broadcast(ctx, ACTION_HIDE, null, 11));

        try { NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build()); }
        catch (SecurityException e) { /* notifications not allowed; the app asks */ }
    }

    private static PendingIntent broadcast(Context ctx, String action, String key, int code) {
        Intent i = new Intent(ctx, IslandReceiver.class).setAction(action);
        if (key != null) i.putExtra("key", key);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /* ----- The buttons ----- */

    /** "Done" on a deadline: remembered here until the app collects it (IslandPlugin.takeDone) and ticks it off. */
    static void markDone(Context ctx, String key) {
        Set<String> done = doneKeys(ctx);
        done.add(key);
        prefs(ctx).edit().putString("done", new JSONArray(done).toString()).apply();
    }

    static Set<String> doneKeys(Context ctx) {
        Set<String> out = new HashSet<>();
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString("done", "[]"));
            for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
        } catch (Exception ignored) { }
        return out;
    }

    static void clearDone(Context ctx) { prefs(ctx).edit().putString("done", "[]").apply(); }

    /** "Hide": away for the chosen hours (0 shows it again now). */
    static void hide(Context ctx, int hours) {
        prefs(ctx).edit().putLong("hiddenUntil", hours > 0 ? System.currentTimeMillis() + hours * 3600_000L : 0).apply();
    }

    private static String shortTime(long mins) { return mins >= 60 ? (mins / 60) + "h " + (mins % 60) + "m" : mins + "m"; }
    private static String longTime(long mins) { return mins >= 60 ? (mins / 60) + "h " + (mins % 60) + "m" : mins + " min"; }

    private static void schedule(Context ctx, long at) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        Intent i = new Intent(ctx, IslandReceiver.class).setAction(ACTION_REFRESH);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.cancel(pi);
        if (at <= 0) return;
        // Inexact but allowed while the phone dozes; a minute's slack is fine here.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    static boolean promotedAllowed(Context ctx) {
        if (Build.VERSION.SDK_INT < 36) return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try { return nm.canPostPromotedNotifications(); } catch (Throwable t) { return false; }
    }
}
