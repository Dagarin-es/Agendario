package es.dagarin.agendario;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Recordatorios en el móvil: la app (o la revisión cada 2 horas) pasa la lista de pendientes y aquí se
 * programa una alarma para cada uno. Así avisa a su hora aunque no haya conexión en ese momento.
 */
final class ReminderStore {
    static final String CHANNEL = "reminders";
    private ReminderStore() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences("agendario_reminders", Context.MODE_PRIVATE);
    }

    static void channel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Recordatorios", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Llamar, escribir o anotar algo a la hora que elegiste");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    /** Lista nueva desde el servidor (JSON: id, kind, text, dueAt ms, contactId, contactName). */
    static synchronized void set(Context ctx, String json) {
        JSONArray list;
        try {
            list = new JSONArray(json);
        } catch (Exception e) {
            return;
        }
        SharedPreferences p = prefs(ctx);
        // Se cancelan las alarmas de los que ya no están (hechos o borrados)
        Set<String> now = new HashSet<>();
        for (int i = 0; i < list.length(); i++) now.add(list.optJSONObject(i).optString("id"));
        for (String old : p.getStringSet("ids", new HashSet<>())) if (!now.contains(old)) cancel(ctx, old);
        p.edit().putString("list", list.toString()).putStringSet("ids", now).apply();
        scheduleAll(ctx);
        schedulePeriodic(ctx);
    }

    static synchronized void scheduleAll(Context ctx) {
        SharedPreferences p = prefs(ctx);
        Set<String> notified = new HashSet<>(p.getStringSet("notified", new HashSet<>()));
        try {
            JSONArray list = new JSONArray(p.getString("list", "[]"));
            Set<String> keep = new HashSet<>();
            for (int i = 0; i < list.length(); i++) {
                JSONObject r = list.optJSONObject(i);
                String key = r.optString("id") + "@" + r.optLong("dueAt");
                keep.add(key);
                if (notified.contains(key)) continue; // ya avisado a esa hora
                schedule(ctx, r);
            }
            notified.retainAll(keep);
            p.edit().putStringSet("notified", notified).apply();
        } catch (Exception ignored) {
            // lista no válida
        }
    }

    static JSONObject find(Context ctx, String id) {
        try {
            JSONArray list = new JSONArray(prefs(ctx).getString("list", "[]"));
            for (int i = 0; i < list.length(); i++) if (id.equals(list.optJSONObject(i).optString("id"))) return list.optJSONObject(i);
        } catch (Exception ignored) {
            // nada
        }
        return null;
    }

    private static PendingIntent alarmIntent(Context ctx, String id, int flags) {
        Intent i = new Intent(ctx, ReminderReceiver.class).setAction("es.dagarin.agendario.REMINDER." + id).putExtra("id", id);
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context ctx, JSONObject r) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = Math.max(r.optLong("dueAt"), System.currentTimeMillis() + 2000); // vencidos: avisa ya
        PendingIntent pi = alarmIntent(ctx, r.optString("id"), PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void cancel(Context ctx, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, id, PendingIntent.FLAG_NO_CREATE);
        if (am != null && pi != null) am.cancel(pi);
        NotificationManagerCompat.from(ctx).cancel(id.hashCode());
    }

    static synchronized void markNotified(Context ctx, JSONObject r) {
        SharedPreferences p = prefs(ctx);
        Set<String> n = new HashSet<>(p.getStringSet("notified", new HashSet<>()));
        n.add(r.optString("id") + "@" + r.optLong("dueAt"));
        p.edit().putStringSet("notified", n).apply();
    }

    /** Quita uno de la lista local (hecho) */
    static synchronized void remove(Context ctx, String id) {
        SharedPreferences p = prefs(ctx);
        try {
            JSONArray list = new JSONArray(p.getString("list", "[]"));
            JSONArray out = new JSONArray();
            for (int i = 0; i < list.length(); i++) if (!id.equals(list.optJSONObject(i).optString("id"))) out.put(list.optJSONObject(i));
            p.edit().putString("list", out.toString()).apply();
        } catch (Exception ignored) {
            // nada
        }
        cancel(ctx, id);
    }

    /** Cambia la hora de uno (posponer) y lo vuelve a programar */
    static synchronized void move(Context ctx, String id, long dueAt) {
        SharedPreferences p = prefs(ctx);
        try {
            JSONArray list = new JSONArray(p.getString("list", "[]"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject r = list.optJSONObject(i);
                if (id.equals(r.optString("id"))) {
                    r.put("dueAt", dueAt);
                    schedule(ctx, r);
                }
            }
            p.edit().putString("list", list.toString()).apply();
        } catch (Exception ignored) {
            // nada
        }
    }

    /** Revisión cada 2 horas: trae los recordatorios creados desde la web. */
    static void schedulePeriodic(Context ctx) {
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest w = new PeriodicWorkRequest.Builder(ReminderSyncWorker.class, 2, TimeUnit.HOURS).setConstraints(net).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("reminders-periodic", ExistingPeriodicWorkPolicy.KEEP, w);
    }

    static final String[] LABELS = {"call", "Llamar", "email", "Enviar un correo", "message", "Enviar un mensaje", "note", "Anotar algo", "other", "Recordatorio"};
    static final String[] ICONS = {"call", "📞", "email", "✉️", "message", "💬", "note", "📝", "other", "⏰"};

    static String pick(String[] map, String kind) {
        for (int i = 0; i < map.length; i += 2) if (map[i].equals(kind)) return map[i + 1];
        return map[map.length - 1];
    }

    /** Aviso del recordatorio, con «Abrir», «Hecho» y «+1 hora». */
    static void notify(Context ctx, JSONObject r) {
        if (!CallNotify.allowed(ctx)) return;
        channel(ctx);
        String id = r.optString("id");
        int nid = id.hashCode();
        String kind = r.optString("kind");
        String who = r.optString("contactName");
        String title = pick(ICONS, kind) + " " + pick(LABELS, kind) + (who.isEmpty() ? "" : (kind.equals("other") || kind.equals("note") ? " · " : " a ") + who);
        String text = r.optString("text");
        String cid = r.optString("contactId");
        PendingIntent open = CallNotify.openPath(ctx, nid + 1, cid.isEmpty() ? "/upcoming?vista=recordatorios" : "/contacts/" + cid);
        Intent done = new Intent(ctx, ReminderActionReceiver.class).setAction("done").putExtra("id", id);
        Intent later = new Intent(ctx, ReminderActionReceiver.class).setAction("later").putExtra("id", id);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText(text.isEmpty() ? "Recordatorio de Agendario" : text)
            .setStyle(text.isEmpty() ? null : new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .addAction(new NotificationCompat.Action(0, cid.isEmpty() ? "Abrir" : "Abrir ficha", open))
            .addAction(new NotificationCompat.Action(0, "✓ Hecho", PendingIntent.getBroadcast(ctx, nid + 2, done, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)))
            .addAction(new NotificationCompat.Action(0, "+1 hora", PendingIntent.getBroadcast(ctx, nid + 3, later, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)));
        try {
            NotificationManagerCompat.from(ctx).notify(nid, b.build());
        } catch (SecurityException ignored) {
            // sin permiso
        }
    }
}
