package com.boristhoris.ringer3d;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugins register before the bridge starts.
        registerPlugin(PlayBillingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
