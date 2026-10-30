package com.boristhoris.ringer3d;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.AnnotatedData;
import com.google.android.gms.games.FriendsResolutionRequiredException;
import com.google.android.gms.games.GamesSignInClient;
import com.google.android.gms.games.LeaderboardsClient;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.SnapshotsClient;
import com.google.android.gms.games.achievement.Achievement;
import com.google.android.gms.games.achievement.AchievementBuffer;
import com.google.android.gms.games.leaderboard.LeaderboardScore;
import com.google.android.gms.games.leaderboard.LeaderboardVariant;
import com.google.android.gms.games.snapshot.Snapshot;
import com.google.android.gms.games.snapshot.SnapshotMetadataChange;
import com.google.android.gms.tasks.Task;
import java.nio.charset.StandardCharsets;

/**
 * Google Play Games Services (v2), seen from the game as PlayGames (src/services/playServices.ts):
 * sign-in, achievements, leaderboards and Saved Games. Only registered when the build carries a
 * Play Games project id (MainActivity), so without one the game keeps its device-only services.
 */
@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {
    private static final int SHOW_UI = 9001;

    private interface Then<T> {
        void run(T value) throws Exception;
    }

    /** Run then() on success; anything that fails rejects the call. */
    private <T> void await(PluginCall call, Task<T> task, Then<T> then) {
        task.addOnCompleteListener(t -> {
            try {
                if (!t.isSuccessful()) throw t.getException() != null ? t.getException() : new Exception("Play Games failed");
                then.run(t.getResult());
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage(), e);
            }
        });
    }

    private void resolvePlayer(PluginCall call) {
        await(call, PlayGames.getPlayersClient(getActivity()).getCurrentPlayer(), p -> {
            JSObject out = new JSObject();
            out.put("playerId", p.getPlayerId());
            out.put("displayName", p.getDisplayName());
            call.resolve(out);
        });
    }

    /** Play Games v2 signs in on launch; if that didn't happen, ask once. */
    @PluginMethod
    public void signIn(PluginCall call) {
        GamesSignInClient client = PlayGames.getGamesSignInClient(getActivity());
        await(call, client.isAuthenticated(), r -> {
            if (r.isAuthenticated()) {
                resolvePlayer(call);
                return;
            }
            await(call, client.signIn(), again -> {
                if (again.isAuthenticated()) resolvePlayer(call);
                else call.reject("Not signed in to Play Games", "signin");
            });
        });
    }

    @PluginMethod
    public void unlockAchievement(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        await(call, PlayGames.getAchievementsClient(getActivity()).unlockImmediate(id), v -> call.resolve());
    }

    @PluginMethod
    public void unlockedAchievements(PluginCall call) {
        await(call, PlayGames.getAchievementsClient(getActivity()).load(false), (AnnotatedData<AchievementBuffer> data) -> {
            JSArray ids = new JSArray();
            AchievementBuffer buf = data.get();
            if (buf != null) {
                try {
                    for (Achievement a : buf) if (a.getState() == Achievement.STATE_UNLOCKED) ids.put(a.getAchievementId());
                } finally {
                    buf.release();
                }
            }
            JSObject out = new JSObject();
            out.put("ids", ids);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void submitScore(PluginCall call) {
        String id = call.getString("leaderboardId");
        Double score = call.getDouble("score");
        if (id == null || score == null) {
            call.reject("leaderboardId and score are required");
            return;
        }
        await(call, PlayGames.getLeaderboardsClient(getActivity()).submitScoreImmediate(id, score.longValue()), r -> call.resolve());
    }

    @PluginMethod
    public void loadScores(PluginCall call) {
        String id = call.getString("leaderboardId");
        if (id == null) {
            call.reject("leaderboardId is required");
            return;
        }
        int collection = "FRIENDS".equals(call.getString("collection")) ? LeaderboardVariant.COLLECTION_FRIENDS : LeaderboardVariant.COLLECTION_PUBLIC;
        int count = Math.max(1, Math.min(25, call.getInt("count", 10)));
        LeaderboardsClient client = PlayGames.getLeaderboardsClient(getActivity());
        Task<AnnotatedData<LeaderboardsClient.LeaderboardScores>> task = call.getBoolean("centered", false)
            ? client.loadPlayerCenteredScores(id, LeaderboardVariant.TIME_SPAN_ALL_TIME, collection, count)
            : client.loadTopScores(id, LeaderboardVariant.TIME_SPAN_ALL_TIME, collection, count);
        task.addOnCompleteListener(t -> {
            JSArray rows = new JSArray();
            if (!t.isSuccessful()) {
                // Friends boards need the player's consent to share their friends list: none given, no rows.
                if (t.getException() instanceof FriendsResolutionRequiredException) {
                    JSObject out = new JSObject();
                    out.put("scores", rows);
                    call.resolve(out);
                } else call.reject(t.getException() == null ? "Play Games failed" : t.getException().getMessage());
                return;
            }
            LeaderboardsClient.LeaderboardScores scores = t.getResult().get();
            if (scores != null) {
                try {
                    for (LeaderboardScore s : scores.getScores()) {
                        JSObject r = new JSObject();
                        r.put("playerId", s.getScoreHolder() != null ? s.getScoreHolder().getPlayerId() : "");
                        r.put("displayName", s.getScoreHolderDisplayName());
                        r.put("rank", s.getRank());
                        r.put("score", s.getRawScore());
                        rows.put(r);
                    }
                } finally {
                    scores.release();
                }
            }
            JSObject out = new JSObject();
            out.put("scores", rows);
            call.resolve(out);
        });
    }

    /** Open a Saved Games slot, taking the newer copy when two devices disagree. */
    private void openSnapshot(PluginCall call, String name, Then<Snapshot> then) {
        await(call, PlayGames.getSnapshotsClient(getActivity()).open(name, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED), r -> {
            Snapshot s = r.isConflict() ? r.getConflict().getSnapshot() : r.getData();
            then.run(s);
        });
    }

    @PluginMethod
    public void loadSnapshot(PluginCall call) {
        String name = call.getString("name");
        if (name == null) {
            call.reject("name is required");
            return;
        }
        openSnapshot(call, name, s -> {
            byte[] bytes = s.getSnapshotContents().readFully();
            PlayGames.getSnapshotsClient(getActivity()).discardAndClose(s);
            JSObject out = new JSObject();
            out.put("data", bytes.length == 0 ? null : new String(bytes, StandardCharsets.UTF_8));
            call.resolve(out);
        });
    }

    @PluginMethod
    public void saveSnapshot(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || data == null) {
            call.reject("name and data are required");
            return;
        }
        openSnapshot(call, name, s -> {
            s.getSnapshotContents().writeBytes(data.getBytes(StandardCharsets.UTF_8));
            SnapshotMetadataChange meta = new SnapshotMetadataChange.Builder().setDescription(call.getString("description", "Ringer 3D")).build();
            await(call, PlayGames.getSnapshotsClient(getActivity()).commitAndClose(s, meta), m -> {
                JSObject out = new JSObject();
                out.put("ok", true);
                call.resolve(out);
            });
        });
    }

    /** Play Games' own achievements screen. */
    @PluginMethod
    public void showAchievements(PluginCall call) {
        await(call, PlayGames.getAchievementsClient(getActivity()).getAchievementsIntent(), intent -> {
            getActivity().startActivityForResult(intent, SHOW_UI);
            call.resolve();
        });
    }
}
