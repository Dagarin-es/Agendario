package es.dagarin.agendario;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.CallLog;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Registro de llamadas → Agendario. Lee las llamadas nuevas del móvil y las envía al servidor
 * (POST /api/calls/import); el servidor solo guarda las de números que son contactos.
 */
public final class CallSync {
    static final String PREFS = "agendario_calls";
    private static final int BATCH = 500;

    private CallSync() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean hasPermission(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED;
    }

    /** Programa los avisos: al cambiar el registro de llamadas (casi al momento) y una revisión cada 2 horas. */
    static void schedule(Context ctx) {
        WorkManager wm = WorkManager.getInstance(ctx);
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(CallSyncWorker.class, 2, TimeUnit.HOURS).setConstraints(net).build();
        wm.enqueueUniquePeriodicWork("calls-periodic", ExistingPeriodicWorkPolicy.KEEP, periodic);
        watch(ctx);
    }

    /** Trabajo que salta cuando cambia el registro de llamadas (se vuelve a programar tras cada ejecución). */
    static void watch(Context ctx) {
        Constraints c = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .addContentUriTrigger(CallLog.Calls.CONTENT_URI, true)
            .setTriggerContentUpdateDelay(3, TimeUnit.SECONDS)
            .setTriggerContentMaxDelay(30, TimeUnit.SECONDS)
            .build();
        OneTimeWorkRequest w = new OneTimeWorkRequest.Builder(CallSyncWorker.class).setConstraints(c).addTag("watch").build();
        WorkManager.getInstance(ctx).enqueueUniqueWork("calls-watch", ExistingWorkPolicy.REPLACE, w);
    }

    /** Envío inmediato (al colgar o al pulsar «Sincronizar ahora»). */
    static void now(Context ctx, long delaySec) {
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest w = new OneTimeWorkRequest.Builder(CallSyncWorker.class).setConstraints(net).setInitialDelay(delaySec, TimeUnit.SECONDS).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork("calls-now", ExistingWorkPolicy.REPLACE, w);
    }

    static void cancel(Context ctx) {
        WorkManager wm = WorkManager.getInstance(ctx);
        wm.cancelUniqueWork("calls-periodic");
        wm.cancelUniqueWork("calls-watch");
        wm.cancelUniqueWork("calls-now");
    }

    private static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US);
        f.setTimeZone(TimeZone.getDefault());
        return f.format(new Date(ms));
    }

    /** Lee y envía las llamadas posteriores a la última enviada. Devuelve false si hay que reintentar. */
    static synchronized boolean run(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean("enabled", false) || !hasPermission(ctx)) return true;
        String server = p.getString("server", "");
        String token = p.getString("token", "");
        if (server.isEmpty() || token.isEmpty()) return true;
        long since = p.getLong("since", System.currentTimeMillis());
        int added = 0, read = 0, unmatched = 0, skipped = 0;
        JSONObject lastItem = null;
        JSONObject lastUnknown = null;
        java.util.List<JSONObject> allItems = new java.util.ArrayList<>();
        try {
            while (true) {
                JSONArray calls = new JSONArray();
                long last = since;
                String[] cols = {CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION};
                try (Cursor cur = ctx.getContentResolver().query(CallLog.Calls.CONTENT_URI, cols, CallLog.Calls.DATE + " > ?", new String[] {String.valueOf(since)}, CallLog.Calls.DATE + " ASC")) {
                    if (cur == null) return true;
                    while (cur.moveToNext() && calls.length() < BATCH) {
                        String number = cur.getString(1);
                        int type = cur.getInt(2);
                        long date = cur.getLong(3);
                        last = date;
                        if (number == null || number.isEmpty()) continue;
                        String t;
                        if (type == CallLog.Calls.OUTGOING_TYPE) t = "out";
                        else if (type == CallLog.Calls.INCOMING_TYPE || type == CallLog.Calls.ANSWERED_EXTERNALLY_TYPE) t = "in";
                        else if (type == CallLog.Calls.MISSED_TYPE || type == CallLog.Calls.REJECTED_TYPE) t = "missed";
                        else continue;
                        JSONObject o = new JSONObject();
                        o.put("id", cur.getString(0) + "-" + date);
                        o.put("number", number);
                        o.put("type", t);
                        o.put("at", iso(date));
                        o.put("durationSec", Math.min(86400, cur.getInt(4)));
                        calls.put(o);
                    }
                }
                if (calls.length() == 0) {
                    if (last > since) p.edit().putLong("since", last).apply();
                    break;
                }
                JSONObject res = post(server + "/api/calls/import", token, new JSONObject().put("calls", calls).toString());
                if (res == null) {
                    p.edit().putString("lastError", "El servidor no ha aceptado el envío").apply();
                    return false;
                }
                read += calls.length();
                added += res.optInt("added", 0);
                unmatched += res.optInt("unmatched", 0);
                skipped += res.optInt("skipped", 0);
                JSONArray items = res.optJSONArray("items");
                if (items != null && items.length() > 0) lastItem = items.optJSONObject(items.length() - 1);
                if (items != null) for (int k = 0; k < items.length(); k++) allItems.add(items.optJSONObject(k));
                JSONArray unknown = res.optJSONArray("unknown");
                if (unknown != null && unknown.length() > 0) lastUnknown = unknown.optJSONObject(unknown.length() - 1);
                if (unknown != null) for (int k = 0; k < unknown.length(); k++) allItems.add(unknown.optJSONObject(k));
                since = last;
                p.edit().putLong("since", since).apply();
                if (calls.length() < BATCH) break;
            }
            // Nota escrita durante la llamada (burbuja o «Anotar»): se pega a la llamada más reciente con ese número
            String noted = null;
            for (int k = allItems.size() - 1; k >= 0 && noted == null; k--) {
                JSONObject it = allItems.get(k);
                String note = InCallNotes.take(ctx, it.optString("number"));
                if (note == null) continue;
                String path = it.has("unknownCallId") ? "/api/unknown-calls/" + it.optString("unknownCallId") : "/api/interactions/" + it.optString("interactionId");
                try {
                    if (Net.request(ctx, "PATCH", path, new JSONObject().put("notes", note).toString(), 15000).ok()) noted = it.optString("number");
                } catch (Exception e) {
                    InCallNotes.add(ctx, it.optString("number"), note); // se reintenta en el siguiente envío
                }
            }
            // Adjuntos hechos o elegidos durante la llamada: a la llamada más reciente con ese número
            for (int k = allItems.size() - 1; k >= 0; k--) {
                JSONObject it = allItems.get(k);
                JSONArray files = InCallNotes.files(ctx, it.optString("number"));
                if (files == null) continue;
                String path = (it.has("unknownCallId") ? "/api/unknown-calls/" + it.optString("unknownCallId") : "/api/interactions/" + it.optString("interactionId")) + "/attachments";
                for (int f = 0; f < files.length(); f++) {
                    JSONObject a = files.optJSONObject(f);
                    java.io.File file = new java.io.File(a.optString("path"));
                    if (!file.exists()) { InCallNotes.removeFile(ctx, a.optString("path")); continue; }
                    try {
                        Net.Res up = Net.upload(ctx, path, file, a.optString("name"), a.optString("mime", "application/octet-stream"));
                        // Subido, o rechazado por el servidor (tipo o tamaño no válidos): no se reintenta
                        if (up.ok() || (up.code >= 400 && up.code < 500 && up.code != 401)) InCallNotes.removeFile(ctx, a.optString("path"));
                    } catch (Exception e) {
                        // sin conexión: se reintenta en el siguiente envío
                    }
                }
                break;
            }
            // Aviso para apuntar algo: solo la última llamada, si es reciente, atendida y de más de 30 s
            if (lastItem != null && p.getBoolean("notify", true) && !"missed".equals(lastItem.optString("type")) && lastItem.optInt("durationSec") > 30 && recent(lastItem)) {
                if (noted != null && noted.equals(lastItem.optString("number"))) {
                    CallNotify.done(ctx, lastItem.optString("interactionId").hashCode(), "Llamada con " + lastItem.optString("contactName"), "✓ Nota guardada en la llamada");
                } else CallNotify.show(ctx, lastItem);
            }
            // Número desconocido de más de un minuto: «¿Lo guardas?»
            if (lastUnknown != null && p.getBoolean("unknownNotify", true) && recent(lastUnknown)) CallNotify.showUnknown(ctx, lastUnknown);
            p.edit().putLong("lastSyncAt", System.currentTimeMillis()).putInt("lastAdded", added).putInt("lastRead", read)
                .putInt("lastUnmatched", unmatched).putInt("lastSkipped", skipped).putString("lastError", "").apply();
            return true;
        } catch (Exception e) {
            p.edit().putString("lastError", String.valueOf(e.getMessage())).apply();
            return false;
        }
    }

    /** ¿Terminó hace menos de 15 minutos? (para no avisar de llamadas antiguas en la primera carga) */
    private static boolean recent(JSONObject item) {
        long callEnd = System.currentTimeMillis();
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US);
            Date at = f.parse(item.optString("at"));
            if (at != null) callEnd = at.getTime() + item.optInt("durationSec") * 1000L;
        } catch (Exception ignored) {
            // si no se entiende la fecha, se avisa igualmente
        }
        return System.currentTimeMillis() - callEnd < 15 * 60_000L;
    }

    private static JSONObject post(String url, String token, String body) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(30000);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("Content-Type", "application/json");
        con.setRequestProperty("Authorization", "Bearer " + token);
        con.setRequestProperty("X-Agendario-Client", "app");
        try (OutputStream os = con.getOutputStream()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
        }
        int code = con.getResponseCode();
        if (code == 401) {
            // Sesión caducada: se para hasta volver a entrar en la app
            throw new Exception("Sesión caducada: abre Agendario y vuelve a entrar");
        }
        if (code < 200 || code >= 300) return null;
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try (java.io.InputStream in = con.getInputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return new JSONObject(out.toString("UTF-8"));
    }
}
