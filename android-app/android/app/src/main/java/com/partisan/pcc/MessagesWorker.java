package com.partisan.pcc;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Checks your message channels for anything new while PCC is closed, and
 * shows it as a notification. Android runs this about every 15 minutes
 * (WorkManager); while the app is open, messages arrive straight away instead.
 * The channels and the last message seen come from the app (MessagesPlugin).
 * It reads the same relay as the app (ntfy.sh) and shows only real messages
 * (not focus status or countdown lists), and never our own.
 */
public class MessagesWorker extends Worker {
    static final String PREFS = "pcc-messages";
    static final String CHANNEL = "messages";

    public MessagesWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray channels = new JSONArray(prefs.getString("channels", "[]"));
            if (channels.length() == 0) return Result.success();
            String device = prefs.getString("device", "");
            long since = prefs.getLong("since", 0);
            Map<String, String> names = new HashMap<>();
            StringBuilder topics = new StringBuilder();
            for (int i = 0; i < channels.length(); i++) {
                JSONObject c = channels.getJSONObject(i);
                String topic = c.getString("topic");
                if (!topic.matches("pcc[a-z2-7]{16}")) continue;
                names.put(topic, c.optString("name", "Messages"));
                if (topics.length() > 0) topics.append(',');
                topics.append(topic);
            }
            if (topics.length() == 0) return Result.success();

            URL url = new URL("https://ntfy.sh/" + topics + "/json?poll=1&since=" + (since > 0 ? String.valueOf(since) : "1h"));
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            long newest = since;
            try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = in.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;
                    JSONObject event = new JSONObject(line);
                    if (!"message".equals(event.optString("event"))) continue;
                    long time = event.optLong("time", 0);
                    if (time <= since) continue;
                    newest = Math.max(newest, time);
                    JSONObject p;
                    try { p = new JSONObject(event.optString("message", "")); } catch (Exception e) { continue; }
                    if (p.optInt("v") != 1 || device.equals(p.optString("d"))) continue;
                    String kind = p.optString("k", "");
                    String text = p.optString("t", "");
                    if (text.isEmpty() || "status".equals(kind)) continue;
                    notify(ctx, event.optString("id"), p.optString("f", "Someone"), names.getOrDefault(event.optString("topic"), "Messages"), text);
                }
            } finally { conn.disconnect(); }
            prefs.edit().putLong("since", newest).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    private static void notify(Context ctx, String id, String from, String channel, String text) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Messages and nudges from your channels.");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_message)
                .setContentTitle(from + " · " + channel)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setGroup("pcc-messages")
                .setContentIntent(tap);
        try { NotificationManagerCompat.from(ctx).notify(("msg" + id).hashCode(), b.build()); }
        catch (SecurityException ignored) { }
    }
}
