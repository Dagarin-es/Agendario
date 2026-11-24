package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/** Ha llegado la hora de un recordatorio. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String id = intent.getStringExtra("id");
        if (id == null) return;
        JSONObject r = ReminderStore.find(ctx, id);
        if (r == null) return; // ya hecho o borrado
        if (r.optLong("dueAt") > System.currentTimeMillis() + 60_000) { // lo han movido: se reprograma
            ReminderStore.schedule(ctx, r);
            return;
        }
        ReminderStore.markNotified(ctx, r);
        ReminderStore.notify(ctx, r);
        AppBadges.refreshOverdue(ctx); // ya está pasado de fecha: sube la bola
    }
}
