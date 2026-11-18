package es.dagarin.agendario;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

/** Aviso al colgar: «Llamada con X · N min — ¿Quieres apuntar algo?» con respuesta directa y «Abrir ficha». */
public final class CallNotify {
    static final String CHANNEL = "calls";
    static final String KEY_NOTE = "note";
    private CallNotify() {}

    static void channel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Notas de llamadas", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Al colgar con un contacto, para apuntar algo sobre la llamada");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    static boolean allowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    /** item: interactionId, contactId, contactName, type, durationSec */
    static void show(Context ctx, JSONObject item) {
        if (!allowed(ctx)) return;
        channel(ctx);
        String iid = item.optString("interactionId");
        String cid = item.optString("contactId");
        int id = iid.hashCode();
        int min = Math.max(1, Math.round(item.optInt("durationSec") / 60f));
        String title = "Llamada con " + item.optString("contactName") + " · " + min + " min";

        RemoteInput input = new RemoteInput.Builder(KEY_NOTE).setLabel("Nota de la llamada").build();
        Intent reply = new Intent(ctx, NoteReplyReceiver.class).putExtra("interactionId", iid).putExtra("notificationId", id).putExtra("title", title);
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent replyPi = PendingIntent.getBroadcast(ctx, id, reply, PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        NotificationCompat.Action write = new NotificationCompat.Action.Builder(0, "Escribir nota", replyPi).addRemoteInput(input).setAllowGeneratedReplies(false).build();

        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("agendarioPath", "/contacts/" + cid + "?call=" + iid);
        PendingIntent openPi = PendingIntent.getActivity(ctx, id + 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText("¿Quieres apuntar algo?")
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .addAction(write)
            .addAction(new NotificationCompat.Action(0, "Abrir ficha", openPi));
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
            // sin permiso de notificaciones
        }
    }

    static void done(Context ctx, int id, String title, String text) {
        channel(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note).setContentTitle(title).setContentText(text).setTimeoutAfter(4000).setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
            // sin permiso
        }
    }
}
