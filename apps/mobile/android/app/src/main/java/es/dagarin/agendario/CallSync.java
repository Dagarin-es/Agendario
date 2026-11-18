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
        int added = 0;
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
                if (res == null) return false;
                added += res.optInt("added", 0);
                since = last;
                p.edit().putLong("since", since).apply();
                if (calls.length() < BATCH) break;
            }
            p.edit().putLong("lastSyncAt", System.currentTimeMillis()).putInt("lastAdded", added).putString("lastError", "").apply();
            return true;
        } catch (Exception e) {
            p.edit().putString("lastError", String.valueOf(e.getMessage())).apply();
            return false;
        }
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
