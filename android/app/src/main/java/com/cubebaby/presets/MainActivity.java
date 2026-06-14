package com.cubebaby.presets;

import com.getcapacitor.BridgeActivity;

import com.cubebaby.presets.plugins.MidiPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(MidiPlugin.class);
    }
}
