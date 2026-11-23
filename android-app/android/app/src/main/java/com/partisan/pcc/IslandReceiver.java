package com.partisan.pcc;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Runs the island at each change (an alarm set by Island) and after the phone restarts. */
public class IslandReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Island.refresh(context);
    }
}
