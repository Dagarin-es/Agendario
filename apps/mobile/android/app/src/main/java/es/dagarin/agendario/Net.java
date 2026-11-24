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

    /** Sube un fichero (multipart, campo «file») a la ruta indicada. Hasta 25 MB: tiempo de espera largo. */
    static Res upload(Context ctx, String path, java.io.File file, String name, String mime) throws Exception {
        SharedPreferences p = CallSync.prefs(ctx);
        String boundary = "----agendario" + System.nanoTime();
        HttpURLConnection con = (HttpURLConnection) new URL(p.getString("server", "") + path).openConnection();
        con.setConnectTimeout(20000);
        con.setReadTimeout(180000);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setChunkedStreamingMode(64 * 1024);
        con.setRequestProperty("Authorization", "Bearer " + p.getString("token", ""));
        con.setRequestProperty("X-Agendario-Client", "app");
        con.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        String safe = name.replace("\"", "'").replace("\r", " ").replace("\n", " ");
        try (OutputStream os = con.getOutputStream(); InputStream in = new java.io.FileInputStream(file)) {
            os.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            os.write(name.getBytes(StandardCharsets.UTF_8));
            os.write(("\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + safe + "\"\r\nContent-Type: " + mime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            os.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        }
        int code = con.getResponseCode();
        try (InputStream in = code < 400 ? con.getInputStream() : con.getErrorStream()) {
            if (in != null) while (in.read() != -1) { /* vaciar */ }
        }
        return new Res(code, "");
    }
}
