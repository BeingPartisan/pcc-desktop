package com.partisan.pcc;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // PCC's own native pieces, available to the pages as window.Capacitor.Plugins.<name>
        registerPlugin(CampusPlugin.class);
        registerPlugin(IslandPlugin.class);
        registerPlugin(MessagesPlugin.class);
        registerPlugin(MailPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
