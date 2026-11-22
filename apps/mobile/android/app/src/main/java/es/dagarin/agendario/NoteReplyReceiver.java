package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import org.json.JSONObject;

/**
 * Respuesta directa desde una notificación:
 *  - target «call»: nota de una llamada ya registrada (interactionId)
 *  - target «unknown»: nota de una llamada con un número desconocido (unknownCallId)
 *  - target «incall»: nota escrita durante la llamada; se guarda al colgar en esa llamada
 */
public class NoteReplyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Bundle res = RemoteInput.getResultsFromIntent(intent);
        if (res == null) return;
        CharSequence note = res.getCharSequence(CallNotify.KEY_NOTE);
        if (note == null || note.toString().trim().isEmpty()) return;
        String text = note.toString().trim();
        String target = intent.getStringExtra("target");
        int nid = intent.getIntExtra("notificationId", 0);
        String title = intent.getStringExtra("title");
        if ("incall".equals(target)) {
            InCallNotes.add(ctx, intent.getStringExtra("number"), text);
            CallNotify.ongoing(ctx, intent.getStringExtra("number"), intent.getStringExtra("name"), true);
            return;
        }
        String id = intent.getStringExtra("id");
        String path = "unknown".equals(target) ? "/api/unknown-calls/" + id : "/api/interactions/" + id;
        PendingResult pr = goAsync();
        new Thread(() -> {
            boolean ok;
            try {
                ok = Net.request(ctx, "PATCH", path, new JSONObject().put("notes", text).toString(), 15000).ok();
            } catch (Exception e) {
                ok = false;
            }
            CallNotify.done(ctx, nid, title, ok ? "✓ Nota guardada" : "No se ha podido guardar la nota: ábrela en Agendario");
            pr.finish();
        }).start();
    }
}
