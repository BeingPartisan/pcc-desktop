package com.partisan.pcc;

import android.content.Intent;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The island for the app's pages (window.Capacitor.Plugins.Island):
 *   setSchedule({ items, enabled, lead, hideHours })  what could show and when (see Island.java)
 *   status()     -> { notifications, promoted, hiddenUntil }
 *   hide({ hours })   put the island away (0: show it again now)
 *   takeDone()   -> { keys }  deadlines ticked "Done" on the notification since last asked
 *   openSettings()    opens PCC's notification settings
 */
@CapacitorPlugin(name = "Island")
public class IslandPlugin extends Plugin {

    @PluginMethod
    public void setSchedule(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        Island.save(getContext(), items.toString(), call.getBoolean("enabled", true), call.getInt("lead", 60), call.getInt("hideHours", 3));
        Island.refresh(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(status()); }

    private JSObject status() {
        JSObject out = new JSObject();
        out.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        out.put("promoted", Island.promotedAllowed(getContext()));
        long until = Island.prefs(getContext()).getLong("hiddenUntil", 0);
        out.put("hiddenUntil", until > System.currentTimeMillis() ? until : 0);
        return out;
    }

    @PluginMethod
    public void hide(PluginCall call) {
        Island.hide(getContext(), call.getInt("hours", 0));
        Island.refresh(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void takeDone(PluginCall call) {
        JSObject out = new JSObject();
        out.put("keys", new JSArray(Island.doneKeys(getContext())));
        Island.clearDone(getContext());
        call.resolve(out);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
