package es.dagarin.agendario;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

/** Avisos de llamadas: al colgar con un contacto, tras una llamada con un número desconocido y durante la llamada. */
public final class CallNotify {
    static final String CHANNEL = "calls";
    static final String CHANNEL_INCALL = "incall";
    static final String KEY_NOTE = "note";
    static final int ONGOING_ID = 0xA9E0;
    private CallNotify() {}

    static void channel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Notas de llamadas", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Al colgar, para apuntar algo, crear un recordatorio o guardar un número desconocido");
            nm.createNotificationChannel(ch);
            NotificationChannel in = new NotificationChannel(CHANNEL_INCALL, "Anotar durante la llamada", NotificationManager.IMPORTANCE_LOW);
            in.setDescription("Notificación fija mientras hablas, para escribir notas");
            in.setShowBadge(false);
            nm.createNotificationChannel(in);
        }
    }

    static boolean allowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    private static int mutable() {
        return Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
    }

    /** Abrir una pantalla de Agendario («/contacts/…») desde un aviso. */
    static PendingIntent openPath(Context ctx, int req, String path) {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("agendarioPath", path);
        return PendingIntent.getActivity(ctx, req, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static NotificationCompat.Action dismiss(Context ctx, int id) {
        Intent i = new Intent(ctx, DismissReceiver.class).putExtra("notificationId", id);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id + 3, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // En Android Auto es «Marcar como leído»: cierra el aviso sin abrir nada
        return new NotificationCompat.Action.Builder(0, "No, gracias", pi)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build();
    }

    /**
     * Estilo de mensaje para que Android Auto lea el aviso en voz alta y deje contestar dictando.
     * En el móvil se ve como una conversación: «contacto» → texto.
     */
    static NotificationCompat.MessagingStyle carStyle(String sender, String message) {
        Person me = new Person.Builder().setName("Tú").setKey("me").build();
        Person who = new Person.Builder().setName(sender == null || sender.isEmpty() ? "Agendario" : sender).setKey("c:" + sender).build();
        return new NotificationCompat.MessagingStyle(me)
            .setGroupConversation(false)
            .addMessage(message, System.currentTimeMillis(), who);
    }

    static NotificationCompat.Action reply(Context ctx, int id, String label, Intent target) {
        return reply(ctx, id, label, target, "Escribir nota");
    }

    static NotificationCompat.Action reply(Context ctx, int id, String label, Intent target, String button) {
        RemoteInput input = new RemoteInput.Builder(KEY_NOTE).setLabel(label).build();
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id, target, PendingIntent.FLAG_UPDATE_CURRENT | mutable());
        return new NotificationCompat.Action.Builder(0, button, pi).addRemoteInput(input).setAllowGeneratedReplies(false)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY) // Android Auto: «Responder» por voz
            .setShowsUserInterface(false)
            .build();
    }

    private static void post(Context ctx, int id, Notification n) {
        try {
            NotificationManagerCompat.from(ctx).notify(id, n);
        } catch (SecurityException ignored) {
            // sin permiso de notificaciones
        }
    }

    /** Al colgar con un contacto. item: interactionId, contactId, contactName, type, durationSec */
    static void show(Context ctx, JSONObject item) {
        if (!allowed(ctx)) return;
        channel(ctx);
        String iid = item.optString("interactionId");
        String cid = item.optString("contactId");
        int id = iid.hashCode();
        int min = Math.max(1, Math.round(item.optInt("durationSec") / 60f));
        String title = "Llamada con " + item.optString("contactName") + " · " + min + " min";
        Intent r = new Intent(ctx, NoteReplyReceiver.class).putExtra("target", "call").putExtra("id", iid).putExtra("notificationId", id).putExtra("title", title);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText("¿Quieres apuntar algo o dejarte un recordatorio?")
            .setStyle(carStyle(item.optString("contactName"), "Llamada de " + min + " min. ¿Quieres apuntar algo de la llamada?"))
            .setContentIntent(openPath(ctx, id + 1, "/contacts/" + cid + "?call=" + iid))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .addAction(reply(ctx, id, "Nota de la llamada", r))
            .addAction(new NotificationCompat.Action(0, "Recordatorio", openPath(ctx, id + 2, "/contacts/" + cid + "?remind=1")))
            .addAction(dismiss(ctx, id));
        post(ctx, id, b.build());
    }

    private static String fmtNumber(String n) {
        String d = n.replaceAll("[^\\d+]", "");
        if (d.length() == 9) return d.substring(0, 3) + " " + d.substring(3, 5) + " " + d.substring(5, 7) + " " + d.substring(7);
        return n;
    }

    /** Tras una llamada de más de un minuto con un número que no es contacto. item: unknownCallId, number, durationSec */
    static void showUnknown(Context ctx, JSONObject item) {
        if (!allowed(ctx)) return;
        channel(ctx);
        String uid = item.optString("unknownCallId");
        int id = uid.hashCode();
        int min = Math.max(1, Math.round(item.optInt("durationSec") / 60f));
        String title = "Llamada con " + fmtNumber(item.optString("number")) + " · " + min + " min";
        Intent r = new Intent(ctx, NoteReplyReceiver.class).putExtra("target", "unknown").putExtra("id", uid).putExtra("notificationId", id).putExtra("title", title);
        PendingIntent save = openPath(ctx, id + 1, "/unknown-call/" + uid);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText("Este número no está en tu agenda. ¿Lo guardas?")
            .setStyle(carStyle(fmtNumber(item.optString("number")), "Llamada de " + min + " min con un número que no está en tu agenda. ¿Quieres apuntar algo?"))
            .setContentIntent(save)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .addAction(new NotificationCompat.Action(0, "Guardar", save))
            .addAction(reply(ctx, id, "Nota de la llamada", r))
            .addAction(dismiss(ctx, id));
        post(ctx, id, b.build());
    }

    /** Notificación fija durante la llamada: «Llamada con X · Anotar». */
    static Notification buildOngoing(Context ctx, String number, String name, boolean noted) {
        channel(ctx);
        String who = name != null && !name.isEmpty() ? name : (number != null ? fmtNumber(number) : "la llamada");
        String title = "Llamada con " + who;
        Intent r = new Intent(ctx, NoteReplyReceiver.class).putExtra("target", "incall").putExtra("number", number).putExtra("name", name)
            .putExtra("notificationId", ONGOING_ID).putExtra("title", title);
        RemoteInput input = new RemoteInput.Builder(KEY_NOTE).setLabel("Nota de la llamada").build();
        PendingIntent pi = PendingIntent.getBroadcast(ctx, ONGOING_ID, r, PendingIntent.FLAG_UPDATE_CURRENT | mutable());
        NotificationCompat.Action note = new NotificationCompat.Action.Builder(0, "Anotar", pi).addRemoteInput(input).setAllowGeneratedReplies(false).build();
        String pending = InCallNotes.peek(ctx);
        return new NotificationCompat.Builder(ctx, CHANNEL_INCALL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText(noted && !pending.isEmpty() ? "✓ " + pending.replace('\n', ' ') : "Toca «Anotar» para escribir mientras hablas")
            .setStyle(noted && !pending.isEmpty() ? new NotificationCompat.BigTextStyle().bigText("✓ " + pending) : null)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .addAction(note)
            .build();
    }

    static void ongoing(Context ctx, String number, String name, boolean noted) {
        if (!allowed(ctx)) return;
        post(ctx, ONGOING_ID, buildOngoing(ctx, number, name, noted));
    }

    static void cancelOngoing(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(ONGOING_ID);
    }

    static void done(Context ctx, int id, String title, String text) {
        channel(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note).setContentTitle(title).setContentText(text).setTimeoutAfter(4000).setAutoCancel(true);
        post(ctx, id, b.build());
    }
}
