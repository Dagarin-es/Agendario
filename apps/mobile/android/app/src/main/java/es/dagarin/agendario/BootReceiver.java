package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Tras reiniciar el móvil, vuelve a programar la vigilancia del registro de llamadas. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (CallSync.prefs(ctx).getBoolean("enabled", false)) CallSync.schedule(ctx);
    }
}
