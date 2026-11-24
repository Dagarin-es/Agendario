package es.dagarin.agendario;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Avisos que ponen la bola con el número sobre el icono de Agendario:
 *  - «Recordatorios pasados de fecha»: se actualiza solo (sin sonar) cada vez que cambia la lista o vence uno.
 *  - «Cumpleaños sin regalo»: a las 9:00 de cada día, los cumpleaños de los próximos 7 días (hoy incluido)
 *    sin regalo comprado ni regalado. Suena una vez por la mañana; durante el día solo se actualiza.
 * Cada aviso lleva setNumber(n) para que el lanzador muestre el número.
 */
final class AppBadges {
    static final String CHANNEL = "badges";
    static final int OVERDUE_ID = 0xA9E1;
    static final int BIRTHDAY_ID = 0xA9E2;
    private static final int REQ_DAILY = 0xA9E3;
    private AppBadges() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences("agendario_badges", Context.MODE_PRIVATE);
    }

    static void channel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Pendientes (bola en el icono)", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Recordatorios pasados de fecha y cumpleaños de esta semana sin regalo comprado");
            ch.setShowBadge(true);
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    private static boolean active(Context ctx, int id) {
        if (Build.VERSION.SDK_INT < 23) return false;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        for (StatusBarNotification n : nm.getActiveNotifications()) if (n.getId() == id) return true;
        return false;
    }

    // ---------- Recordatorios pasados de fecha ----------

    /** Vuelve a contar los vencidos de la lista local y pone, cambia o quita el aviso (sin sonar). */
    static void refreshOverdue(Context ctx) {
        List<String> lines = new ArrayList<>();
        try {
            JSONArray list = new JSONArray(ReminderStore.prefs(ctx).getString("list", "[]"));
            long now = System.currentTimeMillis();
            for (int i = 0; i < list.length(); i++) {
                JSONObject r = list.optJSONObject(i);
                if (r.optLong("dueAt") > now) continue;
                String who = r.optString("contactName");
                String text = r.optString("text");
                String what = ReminderStore.pick(ReminderStore.LABELS, r.optString("kind"));
                lines.add(what + (who.isEmpty() ? "" : " · " + who) + (text.isEmpty() ? "" : ": " + text));
            }
        } catch (Exception ignored) {
            // lista no válida
        }
        int n = lines.size();
        SharedPreferences p = prefs(ctx);
        if (n == 0) {
            NotificationManagerCompat.from(ctx).cancel(OVERDUE_ID);
            p.edit().putInt("overdue", 0).apply();
            return;
        }
        // Solo se vuelve a poner si cambia el número (si lo has quitado deslizando, no reaparece con el mismo)
        if (n == p.getInt("overdue", 0) && !active(ctx, OVERDUE_ID)) return;
        p.edit().putInt("overdue", n).apply();
        if (!CallNotify.allowed(ctx)) return;
        channel(ctx);
        String title = n == 1 ? "⏰ 1 recordatorio pasado de fecha" : "⏰ " + n + " recordatorios pasados de fecha";
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle().setBigContentTitle(title);
        for (int i = 0; i < Math.min(lines.size(), 6); i++) style.addLine(lines.get(i));
        if (lines.size() > 6) style.setSummaryText("y " + (lines.size() - 6) + " más");
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText(lines.get(0))
            .setStyle(style)
            .setNumber(n)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(CallNotify.openPath(ctx, OVERDUE_ID, "/reminders"))
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(OVERDUE_ID, b.build());
        } catch (SecurityException ignored) {
            // sin permiso
        }
    }

    // ---------- Cumpleaños sin regalo ----------

    /** Programa la revisión de las 9:00 de mañana (o de hoy, si aún no son las 9). */
    static void scheduleDaily(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 9);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1);
        Intent i = new Intent(ctx, DailyReceiver.class).setAction("es.dagarin.agendario.DAILY");
        PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ_DAILY, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pi);
        }
    }

    /** Próximas fechas (JSON de /api/upcoming) traídas por la app o por la revisión de las 9:00. */
    static void saveUpcoming(Context ctx, String json) {
        try {
            new JSONArray(json);
        } catch (Exception e) {
            return;
        }
        prefs(ctx).edit().putString("upcoming", json).apply();
    }

    private static String today() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getDefault());
        return f.format(new Date());
    }

    private static int daysUntil(String iso) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            long a = f.parse(today()).getTime();
            long b = f.parse(iso).getTime();
            return (int) Math.round((b - a) / 86_400_000.0);
        } catch (Exception e) {
            return 999;
        }
    }

    /** Cumpleaños de hoy a 6 días vista sin regalo comprado ni regalado. */
    static List<String> birthdaysWithoutGift(Context ctx) {
        List<String> out = new ArrayList<>();
        try {
            JSONArray list = new JSONArray(prefs(ctx).getString("upcoming", "[]"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject e = list.optJSONObject(i);
                if (!"birthday".equals(e.optString("kind"))) continue;
                String gift = e.optString("gift");
                if ("bought".equals(gift) || "given".equals(gift)) continue;
                int d = daysUntil(e.optString("date"));
                if (d < 0 || d > 6) continue;
                String when = d == 0 ? "hoy" : d == 1 ? "mañana" : "en " + d + " días";
                String ideas = e.optInt("openGiftIdeas") > 0 ? " (tienes " + e.optInt("openGiftIdeas") + (e.optInt("openGiftIdeas") == 1 ? " idea)" : " ideas)") : " (sin ideas)";
                out.add(e.optString("contactName") + " · " + when + ideas);
            }
        } catch (Exception ignored) {
            // nada guardado
        }
        return out;
    }

    /**
     * Pone o actualiza el aviso de cumpleaños sin regalo.
     * alert = true: el de las 9:00 (suena). false: solo actualiza o quita el que ya está.
     */
    static void refreshBirthdays(Context ctx, boolean alert) {
        List<String> lines = birthdaysWithoutGift(ctx);
        int n = lines.size();
        if (n == 0) {
            NotificationManagerCompat.from(ctx).cancel(BIRTHDAY_ID);
            return;
        }
        if (!alert && !active(ctx, BIRTHDAY_ID)) return;
        if (!CallNotify.allowed(ctx)) return;
        channel(ctx);
        String title = n == 1 ? "🎂 1 cumpleaños esta semana sin regalo" : "🎂 " + n + " cumpleaños esta semana sin regalo";
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle().setBigContentTitle(title);
        for (String l : lines) style.addLine(l);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText(lines.get(0))
            .setStyle(style)
            .setNumber(n)
            .setOnlyAlertOnce(!alert)
            .setSilent(!alert)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(CallNotify.openPath(ctx, BIRTHDAY_ID, "/gifts"))
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(BIRTHDAY_ID, b.build());
        } catch (SecurityException ignored) {
            // sin permiso
        }
    }

    /** Revisión de las 9:00: trae las próximas fechas (si no hay conexión, usa las últimas guardadas). */
    public static class DailyReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            scheduleDaily(ctx); // la de mañana
            PendingResult pr = goAsync();
            new Thread(() -> {
                try {
                    if (Net.configured(ctx)) {
                        Net.Res res = Net.request(ctx, "GET", "/api/upcoming?days=8", null, 15000);
                        if (res.ok()) saveUpcoming(ctx, res.body);
                    }
                } catch (Exception ignored) {
                    // sin conexión: se usa lo guardado
                }
                refreshBirthdays(ctx, true);
                refreshOverdue(ctx);
                pr.finish();
            }).start();
        }
    }
}
