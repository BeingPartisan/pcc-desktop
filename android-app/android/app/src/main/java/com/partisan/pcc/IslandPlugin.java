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
 *   setSchedule({ classes: [{ title, room, start, end }], enabled, lead })  hand over the coming classes
 *   status()        -> { notifications, promoted }  whether notifications and Live Updates are allowed
 *   openSettings()  opens PCC's notification settings
 */
@CapacitorPlugin(name = "Island")
public class IslandPlugin extends Plugin {

    @PluginMethod
    public void setSchedule(PluginCall call) {
        JSArray classes = call.getArray("classes", new JSArray());
        Island.save(getContext(), classes.toString(), call.getBoolean("enabled", true), call.getInt("lead", 60));
        Island.refresh(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(status()); }

    private JSObject status() {
        JSObject out = new JSObject();
        out.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        out.put("promoted", Island.promotedAllowed(getContext()));
        return out;
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
