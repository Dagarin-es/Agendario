package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.telephony.TelephonyManager;
import org.json.JSONObject;

/**
 * Estado de las llamadas:
 *  - suena o se marca → tarjeta con las notas del contacto (si está activada);
 *  - en curso → burbuja y/o notificación «Anotar»;
 *  - al colgar → se quita todo y se envía la llamada a Agendario a los pocos segundos.
 */
public class PhoneStateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        SharedPreferences p = CallSync.prefs(ctx);
        if (!p.getBoolean("enabled", false)) return;
        Context app = ctx.getApplicationContext();
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        @SuppressWarnings("deprecation")
        String incoming = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
        boolean overlay = CallOverlay.enabled(app);
        boolean ongoing = p.getBoolean("ongoing", false);

        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
            if (incoming == null || incoming.isEmpty()) return; // llega dos veces: la buena trae el número
            if (incoming.equals(p.getString("callNumber", "")) && p.getBoolean("ringing", false)) return;
            p.edit().putBoolean("ringing", true).putBoolean("inCall", false).putString("callNumber", incoming).putString("callName", "").apply();
            if (overlay) lookupAndShow(app, incoming, false);
            return;
        }

        if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            if (p.getBoolean("inCall", false)) return; // repetido
            boolean wasRinging = p.getBoolean("ringing", false);
            String number = wasRinging ? p.getString("callNumber", "") : dialed(p);
            p.edit().putBoolean("inCall", true).putBoolean("ringing", false).putString("callNumber", number == null ? "" : number).apply();
            String name = p.getString("callName", "");
            if (overlay || ongoing) CallOverlayService.start(app, number, name);
            if (overlay) {
                if (wasRinging) CallOverlay.collapse(app);
                else if (number != null && !number.isEmpty()) lookupAndShow(app, number, true);
                else CallOverlay.inCall(app, null, null);
            } else if (ongoing && !wasRinging && number != null && !number.isEmpty()) lookupName(app, number);
            return;
        }

        if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            p.edit().putBoolean("inCall", false).putBoolean("ringing", false).remove("dialNumber").apply();
            CallOverlay.hideAll(app);
            CallOverlayService.stop(app);
            CallSync.now(ctx, 4);
        }
    }

    /** Número marcado: el de la app de teléfono (si dio permiso) o el último pulsado en Agendario (último minuto). */
    private static String dialed(SharedPreferences p) {
        if (System.currentTimeMillis() - p.getLong("dialAt", 0) < 90_000) return p.getString("dialNumber", "");
        return "";
    }

    static JSONObject lookup(Context app, String number) {
        if (!Net.configured(app)) return null;
        try {
            Net.Res r = Net.request(app, "GET", "/api/calls/lookup?number=" + Uri.encode(number), null, 4000);
            return r.ok() ? new JSONObject(r.body) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private void lookupAndShow(Context app, String number, boolean outgoing) {
        PendingResult pr = goAsync();
        new Thread(() -> {
            JSONObject res = lookup(app, number);
            SharedPreferences p = CallSync.prefs(app);
            String name = res != null ? res.optString("name") : "";
            p.edit().putString("callName", name).apply();
            if (res != null && !res.isNull("contactId") && !res.optString("contactId").isEmpty()) {
                CallOverlay.showCard(app, number, res, outgoing || p.getBoolean("inCall", false));
            } else if (outgoing || p.getBoolean("inCall", false)) {
                CallOverlay.inCall(app, number, name);
            }
            if (p.getBoolean("inCall", false) && p.getBoolean("ongoing", false) && !name.isEmpty()) CallOverlayService.start(app, number, name);
            pr.finish();
        }).start();
    }

    private void lookupName(Context app, String number) {
        PendingResult pr = goAsync();
        new Thread(() -> {
            JSONObject res = lookup(app, number);
            String name = res != null ? res.optString("name") : "";
            CallSync.prefs(app).edit().putString("callName", name).apply();
            if (!name.isEmpty() && CallSync.prefs(app).getBoolean("inCall", false)) CallOverlayService.start(app, number, name);
            pr.finish();
        }).start();
    }
}
