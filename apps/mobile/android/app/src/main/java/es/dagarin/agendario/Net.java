package es.dagarin.agendario;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Peticiones al servidor de Agendario desde segundo plano (con el servidor y la sesión guardados por la app). */
final class Net {
    private Net() {}

    static final class Res {
        final int code;
        final String body;
        Res(int code, String body) { this.code = code; this.body = body; }
        boolean ok() { return code >= 200 && code < 300; }
    }

    static boolean configured(Context ctx) {
        SharedPreferences p = CallSync.prefs(ctx);
        return !p.getString("server", "").isEmpty() && !p.getString("token", "").isEmpty();
    }

    /** path empieza por «/api/…». body null = sin cuerpo. */
    static Res request(Context ctx, String method, String path, String body, int timeoutMs) throws Exception {
        SharedPreferences p = CallSync.prefs(ctx);
        HttpURLConnection con = (HttpURLConnection) new URL(p.getString("server", "") + path).openConnection();
        con.setConnectTimeout(timeoutMs);
        con.setReadTimeout(timeoutMs * 2);
        con.setRequestMethod(method); // en Android, HttpURLConnection admite PATCH
        con.setRequestProperty("Authorization", "Bearer " + p.getString("token", ""));
        con.setRequestProperty("X-Agendario-Client", "app");
        if (body != null) {
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = con.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int code = con.getResponseCode();
        String text = "";
        try (InputStream in = code < 400 ? con.getInputStream() : con.getErrorStream()) {
            if (in != null) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                text = out.toString("UTF-8");
            }
        }
        return new Res(code, text);
    }
}
