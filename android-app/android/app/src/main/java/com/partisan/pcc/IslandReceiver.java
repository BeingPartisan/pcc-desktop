package com.partisan.pcc;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Runs the island at each change (an alarm set by Island), after the phone
 * restarts, and for the notification's buttons: "Done" on a deadline and
 * "Hide" for a few hours.
 */
public class IslandReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Island.ACTION_DONE.equals(action)) {
            String key = intent.getStringExtra("key");
            if (key != null) Island.markDone(context, key);
        } else if (Island.ACTION_HIDE.equals(action)) {
            Island.hide(context, Island.prefs(context).getInt("hideHours", 3));
        }
        Island.refresh(context);
    }
}
