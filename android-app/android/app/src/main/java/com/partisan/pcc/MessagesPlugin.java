package com.partisan.pcc;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.TimeUnit;

/**
 * Messages for the app's pages (window.Capacitor.Plugins.Messages):
 *   setChannels({ channels: [{ topic, name }], deviceId, since })
 * keeps MessagesWorker's list up to date, and makes sure it runs (about every
 * 15 minutes, when there's a network) while there are channels.
 */
@CapacitorPlugin(name = "Messages")
public class MessagesPlugin extends Plugin {
    private static final String WORK = "pcc-messages-check";

    @PluginMethod
    public void setChannels(PluginCall call) {
        Context ctx = getContext();
        JSArray channels = call.getArray("channels", new JSArray());
        // Passed as text: a plain JS number can arrive in a form getLong() refuses.
        long since = 0;
        try { since = (long) Double.parseDouble(String.valueOf(call.getData().opt("since"))); } catch (Exception ignored) { }
        android.content.SharedPreferences prefs = ctx.getSharedPreferences(MessagesWorker.PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putString("channels", channels.toString())
                .putString("device", call.getString("deviceId", ""))
                // Never go back: the app has seen everything up to `since`.
                .putLong("since", Math.max(since, prefs.getLong("since", 0)))
                .apply();

        WorkManager wm = WorkManager.getInstance(ctx);
        if (channels.length() == 0) { wm.cancelUniqueWork(WORK); call.resolve(); return; }
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(MessagesWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req);
        call.resolve();
    }

    /** One check straight away (the periodic one won't run early). */
    @PluginMethod
    public void checkNow(PluginCall call) {
        WorkManager.getInstance(getContext()).enqueue(new androidx.work.OneTimeWorkRequest.Builder(MessagesWorker.class).build());
        call.resolve();
    }
}
