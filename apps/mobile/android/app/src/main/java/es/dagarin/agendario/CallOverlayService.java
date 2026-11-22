package es.dagarin.agendario;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Mientras dura una llamada: mantiene viva la burbuja de Agendario y muestra la notificación fija
 * «Llamada con X · Anotar». Se para al colgar.
 */
public class CallOverlayService extends Service {
    static void start(Context ctx, String number, String name) {
        Intent i = new Intent(ctx, CallOverlayService.class).putExtra("number", number).putExtra("name", name);
        try {
            ContextCompat.startForegroundService(ctx, i);
        } catch (Exception e) {
            // Android no deja arrancarlo ahora (restricciones de segundo plano): al menos, la notificación
            if (CallSync.prefs(ctx).getBoolean("ongoing", false)) CallNotify.ongoing(ctx, number, name, false);
        }
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, CallOverlayService.class));
        CallNotify.cancelOngoing(ctx);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String number = intent != null ? intent.getStringExtra("number") : null;
        String name = intent != null ? intent.getStringExtra("name") : null;
        Notification n = CallNotify.buildOngoing(this, number, name, !InCallNotes.peek(this).isEmpty());
        try {
            int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
            ServiceCompat.startForeground(this, CallNotify.ONGOING_ID, n, type);
        } catch (Exception e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
