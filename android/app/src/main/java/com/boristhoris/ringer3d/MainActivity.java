package com.boristhoris.ringer3d;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.google.android.gms.games.PlayGamesSdk;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugins register before the bridge starts.
        registerPlugin(PlayBillingPlugin.class);
        registerPlugin(AppLinksPlugin.class);
        // Play Games only when this build has its Console project id; otherwise the game keeps
        // achievements and bests on the device (src/services).
        if (!getString(R.string.game_services_project_id).isEmpty()) {
            PlayGamesSdk.initialize(this);
            registerPlugin(PlayGamesPlugin.class);
        }
        super.onCreate(savedInstanceState);
    }
}
