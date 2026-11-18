package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;

/** Al colgar (estado IDLE), se envía la llamada a Agendario a los pocos segundos. */
public class PhoneStateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        if (!TelephonyManager.EXTRA_STATE_IDLE.equals(intent.getStringExtra(TelephonyManager.EXTRA_STATE))) return;
        if (!CallSync.prefs(ctx).getBoolean("enabled", false)) return;
        CallSync.now(ctx, 4);
    }
}
