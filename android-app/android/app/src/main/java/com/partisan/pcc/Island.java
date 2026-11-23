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
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * The island on Android: one Live Update (Android 16's promoted ongoing
 * notification) for your classes. Phones with an island-style area show it
 * there; others show it pinned at the top of the notifications.
 *
 *   - from `lead` minutes before a class until it starts: "in 42 min", counting down
 *   - during the class: "now", with a progress bar and the time left
 *   - otherwise: nothing
 *
 * The app hands over the coming classes (IslandPlugin.setSchedule); this
 * class works out what to show at any moment and sets an alarm for the next
 * change, so it keeps going with the app closed. IslandReceiver runs it on
 * each alarm and after the phone restarts.
 */
final class Island {
    static final String CHANNEL = "island";
    static final int NOTIFICATION_ID = 4201;
    private static final String PREFS = "pcc-island";
    private static final long REFRESH_MS = 60 * 1000;   // the time left and the progress bar, every minute while something shows

    static final class Item {
        String title, room; long start, end;
    }

    static void save(Context ctx, String json, boolean enabled, int leadMinutes) {
        prefs(ctx).edit().putString("classes", json).putBoolean("enabled", enabled).putInt("lead", leadMinutes).apply();
    }

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static List<Item> load(Context ctx) {
        List<Item> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString("classes", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Item it = new Item();
                it.title = o.optString("title", "Class");
                it.room = o.optString("room", "");
                it.start = o.getLong("start");
                it.end = o.getLong("end");
                if (it.end > it.start) out.add(it);
            }
        } catch (Exception ignored) { }
        Collections.sort(out, (a, b) -> Long.compare(a.start, b.start));
        return out;
    }

    /** Show (or hide) what's right for now, and set the alarm for the next change. */
    static void refresh(Context ctx) {
        long now = System.currentTimeMillis();
        boolean enabled = prefs(ctx).getBoolean("enabled", true);
        long lead = prefs(ctx).getInt("lead", 60) * 60_000L;
        List<Item> items = enabled ? load(ctx) : new ArrayList<>();

        Item show = null;
        for (Item it : items) {
            if (now < it.end && now >= it.start - lead) { show = it; break; }   // the class on now, or the next one within the lead time
        }

        long next = Long.MAX_VALUE;
        if (show != null) {
            post(ctx, show, now);
            next = Math.min(now >= show.start ? show.end : show.start, now + REFRESH_MS);
        } else {
            NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
            for (Item it : items) if (it.start - lead > now) { next = it.start - lead; break; }
        }
        schedule(ctx, next == Long.MAX_VALUE ? 0 : next);
    }

    private static void post(Context ctx, Item it, long now) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Island: classes", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Your next class, about an hour before it starts and while it's on.");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        boolean on = now >= it.start;
        SimpleDateFormat clock = new SimpleDateFormat("h:mm a", Locale.getDefault());
        long mins = Math.max(1, Math.round(((on ? it.end : it.start) - now) / 60000.0));
        String room = it.room == null || it.room.isEmpty() ? "" : " · " + it.room;
        String text = on ? "Now · ends " + clock.format(new Date(it.end)) + room
                         : "In " + (mins >= 60 ? (mins / 60) + "h " + (mins % 60) + "m" : mins + " min") + " · " + clock.format(new Date(it.start)) + room;

        // Progress: through the class while it's on; through the lead-up before it.
        long from = on ? it.start : it.start - prefs(ctx).getInt("lead", 60) * 60_000L, to = on ? it.end : it.start;
        int pct = (int) Math.max(0, Math.min(100, (now - from) * 100 / Math.max(1, to - from)));
        List<NotificationCompat.ProgressStyle.Segment> segments = new ArrayList<>();
        segments.add(new NotificationCompat.ProgressStyle.Segment(100).setColor(Color.parseColor("#C9F26C")));
        NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle()
                .setProgressSegments(segments)
                .setProgress(pct)
                .setStyledByProgress(true);

        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_island)
                .setContentTitle(it.title)
                .setContentText(text)
                .setStyle(style)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setContentIntent(tap)
                .setShowWhen(false)
                .setRequestPromotedOngoing(true)
                // The island's capsule: just the time, e.g. "in 18m" before, "48m left" during.
                // (A running timer would hide the line with the room on some phones, so the text is
                // refreshed every minute instead.)
                .setShortCriticalText(on ? shortTime(mins) + " left" : "in " + shortTime(mins));

        try { NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build()); }
        catch (SecurityException e) { /* notifications not allowed; the app asks */ }
    }

    private static String shortTime(long mins) { return mins >= 60 ? (mins / 60) + "h " + (mins % 60) + "m" : mins + "m"; }

    private static void schedule(Context ctx, long at) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        Intent i = new Intent(ctx, IslandReceiver.class).setAction("com.partisan.pcc.ISLAND_REFRESH");
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.cancel(pi);
        if (at <= 0) return;
        // Inexact but allowed while the phone dozes; the countdown itself is exact, so a minute's slack is fine.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    static boolean promotedAllowed(Context ctx) {
        if (Build.VERSION.SDK_INT < 36) return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try { return nm.canPostPromotedNotifications(); } catch (Throwable t) { return false; }
    }
}
