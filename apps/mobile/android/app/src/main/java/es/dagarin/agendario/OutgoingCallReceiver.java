package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Número marcado desde la app de teléfono (para la tarjeta de notas al llamar). Necesita el permiso de llamadas salientes. */
public class OutgoingCallReceiver extends BroadcastReceiver {
    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context ctx, Intent intent) {
        if (!Intent.ACTION_NEW_OUTGOING_CALL.equals(intent.getAction())) return;
        String number = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER);
        if (number == null || number.isEmpty()) return;
        CallSync.prefs(ctx).edit().putString("dialNumber", number).putLong("dialAt", System.currentTimeMillis()).apply();
    }
}
