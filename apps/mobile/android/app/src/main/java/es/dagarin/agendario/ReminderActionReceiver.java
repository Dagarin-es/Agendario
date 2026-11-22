package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationManagerCompat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

/** «✓ Hecho» y «+1 hora» desde el aviso del recordatorio. */
public class ReminderActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String id = intent.getStringExtra("id");
        if (id == null) return;
        boolean done = "done".equals(intent.getAction());
        NotificationManagerCompat.from(ctx).cancel(id.hashCode());
        long later = System.currentTimeMillis() + 3600_000L;
        if (done) ReminderStore.remove(ctx, id);
        else ReminderStore.move(ctx, id, later);
        PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                if (done) body.put("done", true);
                else {
                    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                    f.setTimeZone(TimeZone.getTimeZone("UTC"));
                    body.put("dueAt", f.format(new Date(later)));
                }
                Net.request(ctx, "PATCH", "/api/reminders/" + id, body.toString(), 15000);
            } catch (Exception ignored) {
                // sin conexión: el cambio local ya está hecho; en la web se verá al sincronizar a mano
            }
            pr.finish();
        }).start();
    }
}
