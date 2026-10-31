package com.boristhoris.ringer3d;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
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
        // Back (button or gesture) belongs to the game's own screens (src/ui/nav.ts): it closes the
        // open sheet or steps back a screen; on the home screen the app goes to the background.
        // If the page never loaded, back still leaves.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) {
                    moveTaskToBack(true);
                    return;
                }
                bridge.getWebView().evaluateJavascript("(window.ringerBack && window.ringerBack()) || 'exit'", (r) -> {
                    if (!"\"handled\"".equals(r)) moveTaskToBack(true);
                });
            }
        });
    }
}
