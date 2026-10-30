package com.boristhoris.ringer3d;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Invite links, seen from the game as AppLinks (src/invite.ts): Android's share sheet, and the
 * https://ringer3d.modaxxx009.workers.dev/join?room=ABCD links that open the app (the
 * intent-filter in AndroidManifest.xml, verified by the site's /.well-known/assetlinks.json).
 */
@CapacitorPlugin(name = "AppLinks")
public class AppLinksPlugin extends Plugin {
    /** The link the app was started with, handed out once. */
    private String launch;

    @Override
    public void load() {
        Uri data = getActivity().getIntent() != null ? getActivity().getIntent().getData() : null;
        if (data != null) launch = data.toString();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        // The app was already running (singleTask): the link arrives here instead.
        if (intent == null || intent.getData() == null) return;
        JSObject e = new JSObject();
        e.put("url", intent.getData().toString());
        notifyListeners("link", e, true);
    }

    @PluginMethod
    public void launchUrl(PluginCall call) {
        JSObject out = new JSObject();
        out.put("url", launch);
        launch = null;
        call.resolve(out);
    }

    @PluginMethod
    public void share(PluginCall call) {
        String url = call.getString("url", "");
        String text = call.getString("text", "");
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "Ringer 3D"));
        send.putExtra(Intent.EXTRA_TEXT, text.isEmpty() ? url : text + " " + url);
        getActivity().startActivity(Intent.createChooser(send, call.getString("title", "Share")));
        call.resolve();
    }
}
