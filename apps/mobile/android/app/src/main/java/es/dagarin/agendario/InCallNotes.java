package es.dagarin.agendario;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Notas escritas durante una llamada (burbuja o notificación «Anotar»). Aún no existe la llamada en el
 * servidor: se guardan aquí y, al colgar, CallSync las pega a esa llamada en cuanto el servidor la registra.
 */
final class InCallNotes {
    private InCallNotes() {}

    static String key(String number) {
        String d = number == null ? "" : number.replaceAll("\\D", "");
        return d.length() > 9 ? d.substring(d.length() - 9) : d;
    }

    static synchronized void add(Context ctx, String number, String text) {
        SharedPreferences p = CallSync.prefs(ctx);
        String prev = key(number).equals(p.getString("inCallKey", "")) ? p.getString("inCallNote", "") : "";
        p.edit()
            .putString("inCallKey", key(number))
            .putString("inCallNote", prev.isEmpty() ? text : prev + "\n" + text)
            .putLong("inCallAt", System.currentTimeMillis())
            .apply();
    }

    static synchronized String peek(Context ctx) {
        return CallSync.prefs(ctx).getString("inCallNote", "");
    }

    /** Nota pendiente para ese número (y la borra), o null. Caduca a las 24 h. */
    static synchronized String take(Context ctx, String number) {
        SharedPreferences p = CallSync.prefs(ctx);
        String note = p.getString("inCallNote", "");
        if (note.isEmpty()) return null;
        if (System.currentTimeMillis() - p.getLong("inCallAt", 0) > 24 * 3600_000L) {
            clear(ctx);
            return null;
        }
        if (!key(number).equals(p.getString("inCallKey", ""))) return null;
        clear(ctx);
        return note;
    }

    static synchronized void clear(Context ctx) {
        CallSync.prefs(ctx).edit().remove("inCallKey").remove("inCallNote").remove("inCallAt").apply();
    }
}
