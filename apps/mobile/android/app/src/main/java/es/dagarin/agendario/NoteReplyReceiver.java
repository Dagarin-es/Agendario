package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Respuesta directa desde la notificación: guarda la nota en esa llamada. */
public class NoteReplyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Bundle res = RemoteInput.getResultsFromIntent(intent);
        if (res == null) return;
        CharSequence note = res.getCharSequence(CallNotify.KEY_NOTE);
        if (note == null || note.toString().trim().isEmpty()) return;
        String iid = intent.getStringExtra("interactionId");
        int nid = intent.getIntExtra("notificationId", 0);
        String title = intent.getStringExtra("title");
        PendingResult pr = goAsync();
        new Thread(() -> {
            boolean ok = false;
            try {
                SharedPreferences p = CallSync.prefs(ctx);
                HttpURLConnection con = (HttpURLConnection) new URL(p.getString("server", "") + "/api/interactions/" + iid).openConnection();
                con.setConnectTimeout(15000);
                con.setReadTimeout(20000);
                con.setRequestMethod("PATCH");
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                con.setRequestProperty("Authorization", "Bearer " + p.getString("token", ""));
                con.setRequestProperty("X-Agendario-Client", "app");
                try (OutputStream os = con.getOutputStream()) {
                    os.write(new JSONObject().put("notes", note.toString().trim()).toString().getBytes(StandardCharsets.UTF_8));
                }
                ok = con.getResponseCode() < 300;
            } catch (Exception ignored) {
                ok = false;
            }
            CallNotify.done(ctx, nid, title, ok ? "✓ Nota guardada" : "No se ha podido guardar la nota: ábrela en Agendario");
            pr.finish();
        }).start();
    }
}
