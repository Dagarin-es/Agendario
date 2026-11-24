package es.dagarin.agendario;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

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

    // ---------- Adjuntos hechos o elegidos durante la llamada (📷 / 📎 en la burbuja) ----------
    // Se copian a la carpeta privada de la app y esperan, como la nota, a que la llamada llegue al servidor.

    static File dir(Context ctx) {
        File d = new File(ctx.getFilesDir(), "incall");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static synchronized void addFile(Context ctx, String number, File f, String name, String mime) {
        SharedPreferences p = CallSync.prefs(ctx);
        JSONArray list;
        try {
            list = key(number).equals(p.getString("inCallFilesKey", "")) ? new JSONArray(p.getString("inCallFiles", "[]")) : null;
        } catch (Exception e) {
            list = null;
        }
        if (list == null) {
            discardFiles(ctx); // los de otra llamada anterior que no llegaron a subirse
            list = new JSONArray();
        }
        try {
            list.put(new JSONObject().put("path", f.getAbsolutePath()).put("name", name).put("mime", mime));
        } catch (Exception ignored) {
            return;
        }
        p.edit()
            .putString("inCallFilesKey", key(number))
            .putString("inCallFiles", list.toString())
            .putLong("inCallFilesAt", System.currentTimeMillis())
            .apply();
    }

    static synchronized int fileCount(Context ctx) {
        try {
            return new JSONArray(CallSync.prefs(ctx).getString("inCallFiles", "[]")).length();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Adjuntos pendientes para ese número (sin borrarlos: se borran uno a uno al subirse). Caducan a las 24 h. */
    static synchronized JSONArray files(Context ctx, String number) {
        SharedPreferences p = CallSync.prefs(ctx);
        if (!key(number).equals(p.getString("inCallFilesKey", ""))) return null;
        if (System.currentTimeMillis() - p.getLong("inCallFilesAt", 0) > 24 * 3600_000L) {
            discardFiles(ctx);
            return null;
        }
        try {
            JSONArray a = new JSONArray(p.getString("inCallFiles", "[]"));
            return a.length() > 0 ? a : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Ya subido: se borra el fichero y su entrada. */
    static synchronized void removeFile(Context ctx, String path) {
        SharedPreferences p = CallSync.prefs(ctx);
        try {
            JSONArray in = new JSONArray(p.getString("inCallFiles", "[]"));
            JSONArray out = new JSONArray();
            for (int i = 0; i < in.length(); i++) if (!path.equals(in.optJSONObject(i).optString("path"))) out.put(in.optJSONObject(i));
            p.edit().putString("inCallFiles", out.toString()).apply();
        } catch (Exception ignored) {
            // nada
        }
        //noinspection ResultOfMethodCallIgnored
        new File(path).delete();
    }

    static synchronized void discardFiles(Context ctx) {
        File[] old = dir(ctx).listFiles();
        if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
            f.delete();
        CallSync.prefs(ctx).edit().remove("inCallFiles").remove("inCallFilesKey").remove("inCallFilesAt").apply();
    }
}
