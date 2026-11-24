package es.dagarin.agendario;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;

/** Cada 2 horas: trae del servidor los recordatorios pendientes (también los creados desde la web). */
public class ReminderSyncWorker extends Worker {
    public ReminderSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        if (!Net.configured(ctx)) return Result.success();
        try {
            Net.Res res = Net.request(ctx, "GET", "/api/reminders", null, 15000);
            if (!res.ok()) return res.code == 401 ? Result.success() : Result.retry();
            JSONArray in = new JSONArray(res.body);
            JSONArray out = new JSONArray();
            java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", java.util.Locale.US);
            for (int i = 0; i < in.length(); i++) {
                JSONObject r = in.optJSONObject(i);
                // Enlazado con Todoist y con los avisos del móvil apagados: avisa Todoist, no Agendario
                if (!r.optBoolean("phoneAlert", true)) continue;
                JSONObject c = r.optJSONObject("contact");
                java.util.Date due = f.parse(r.optString("dueAt").replace("Z", "+00:00"));
                out.put(new JSONObject()
                    .put("id", r.optString("id")).put("kind", r.optString("kind")).put("text", r.optString("text"))
                    .put("dueAt", due != null ? due.getTime() : System.currentTimeMillis())
                    .put("contactId", r.isNull("contactId") ? "" : r.optString("contactId"))
                    .put("contactName", c != null ? c.optString("displayName") : ""));
            }
            ReminderStore.set(ctx, out.toString());
            // Próximas fechas: el aviso de cumpleaños sin regalo se actualiza (sin sonar)
            try {
                Net.Res up = Net.request(ctx, "GET", "/api/upcoming?days=8", null, 15000);
                if (up.ok()) { AppBadges.saveUpcoming(ctx, up.body); AppBadges.refreshBirthdays(ctx, false); }
            } catch (Exception ignored) {
                // se queda con lo guardado
            }
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }
}
