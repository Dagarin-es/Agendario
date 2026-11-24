package es.dagarin.agendario;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;

/**
 * Pantalla transparente que abre la cámara (📷) o el selector de archivos del sistema (📎) desde la burbuja
 * de notas durante una llamada. La burbuja es una ventana superpuesta y no puede abrir esos selectores ella misma.
 * Lo elegido se copia a la carpeta privada de la app (InCallNotes) y se sube a la llamada al colgar.
 * La foto usa la cámara del propio móvil (ACTION_IMAGE_CAPTURE): Agendario no necesita el permiso de cámara.
 */
public class AttachActivity extends Activity {
    static final String EXTRA_MODE = "mode";
    static final String EXTRA_NUMBER = "number";
    private static final int REQ_CAMERA = 1;
    private static final int REQ_FILE = 2;
    static final long MAX_BYTES = 25L * 1024 * 1024;
    static final String[] MIMES = {
        "image/*", "application/pdf", "text/plain", "text/csv", "text/comma-separated-values", "audio/*",
        "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.presentation",
    };

    private String number;
    private String photoPath;

    static void start(Context ctx, String mode, String number) {
        Intent i = new Intent(ctx, AttachActivity.class)
            .putExtra(EXTRA_MODE, mode)
            .putExtra(EXTRA_NUMBER, number == null ? "" : number)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        number = getIntent().getStringExtra(EXTRA_NUMBER);
        if (saved != null) {
            // Android puede cerrar esta pantalla mientras la cámara está abierta: se recupera al volver
            photoPath = saved.getString("photo");
            number = saved.getString("number", number);
            return;
        }
        String mode = getIntent().getStringExtra(EXTRA_MODE);
        try {
            if ("camera".equals(mode)) openCamera();
            else openPicker();
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay ninguna app para eso en el móvil", Toast.LENGTH_SHORT).show();
            back();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("photo", photoPath);
        out.putString("number", number);
    }

    private void openCamera() {
        File dir = new File(getCacheDir(), "incall");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File f = new File(dir, "foto-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date()) + ".jpg");
        photoPath = f.getAbsolutePath();
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.setClipData(ClipData.newRawUri("", uri));
        startActivityForResult(i, REQ_CAMERA);
    }

    private void openPicker() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, MIMES)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(i, REQ_FILE);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        int added = 0;
        if (res == RESULT_OK) {
            if (req == REQ_CAMERA && photoPath != null) {
                File tmp = new File(photoPath);
                if (tmp.length() > 0) {
                    File dest = new File(InCallNotes.dir(this), UUID.randomUUID() + ".jpg");
                    if (tmp.renameTo(dest) || copy(Uri.fromFile(tmp), dest)) {
                        InCallNotes.addFile(this, number, dest, tmp.getName(), "image/jpeg");
                        added++;
                    }
                }
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            } else if (req == REQ_FILE && data != null) {
                if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    for (int k = 0; k < clip.getItemCount(); k++) added += take(clip.getItemAt(k).getUri());
                } else if (data.getData() != null) {
                    added += take(data.getData());
                }
            }
        }
        if (added > 0) {
            int total = InCallNotes.fileCount(this);
            Toast.makeText(this, "📎 " + total + (total == 1 ? " adjunto" : " adjuntos") + ": se añadirán a la llamada al colgar", Toast.LENGTH_SHORT).show();
        }
        back();
    }

    /** Copia un archivo elegido a la carpeta privada. 1 si se ha añadido. */
    private int take(Uri uri) {
        String name = "archivo";
        long size = -1;
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                if (!c.isNull(0)) name = c.getString(0);
                if (!c.isNull(1)) size = c.getLong(1);
            }
        } catch (Exception ignored) {
            // sin nombre: se queda «archivo»
        }
        if (size > MAX_BYTES) {
            Toast.makeText(this, "«" + name + "» pasa de 25 MB: no se adjunta", Toast.LENGTH_LONG).show();
            return 0;
        }
        String mime = getContentResolver().getType(uri);
        if (mime == null) {
            String ext = MimeTypeMap.getFileExtensionFromUrl(name);
            mime = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase(Locale.ROOT));
        }
        File dest = new File(InCallNotes.dir(this), UUID.randomUUID().toString());
        if (!copy(uri, dest)) return 0;
        if (dest.length() > MAX_BYTES) {
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            Toast.makeText(this, "«" + name + "» pasa de 25 MB: no se adjunta", Toast.LENGTH_LONG).show();
            return 0;
        }
        InCallNotes.addFile(this, number, dest, name, mime == null ? "application/octet-stream" : mime);
        return 1;
    }

    private boolean copy(Uri from, File to) {
        try (InputStream in = getContentResolver().openInputStream(from); OutputStream out = new FileOutputStream(to)) {
            if (in == null) return false;
            byte[] buf = new byte[64 * 1024];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new java.io.IOException("demasiado grande");
                out.write(buf, 0, n);
            }
            return true;
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            to.delete();
            return false;
        }
    }

    /** Vuelve a la llamada y reabre el cuadro de la nota (con lo que se estaba escribiendo). */
    private void back() {
        Context app = getApplicationContext();
        finish();
        overridePendingTransition(0, 0);
        CallOverlay.reopenEditor(app);
    }
}
