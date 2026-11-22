package es.dagarin.agendario;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MaterialYouPlugin.class);
        registerPlugin(CallLogPlugin.class);
        super.onCreate(savedInstanceState);
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
    }

    /** «Compartir» → Añadir idea de regalo: se pasa el texto/enlace a la web. Y abrir una ficha desde un aviso. */
    private void handleShare(Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra("agendarioPath");
        if (path != null) {
            intent.removeExtra("agendarioPath");
            JSObject o = new JSObject();
            o.put("path", path);
            MaterialYouPlugin.deliverOpen(o);
            return;
        }
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type != null && type.startsWith("image/")) {
            shareImage(intent);
            return;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) return;
        JSObject data = new JSObject();
        data.put("text", text);
        data.put("title", intent.getStringExtra(Intent.EXTRA_SUBJECT));
        MaterialYouPlugin.deliverShare(data);
    }

    /** «Compartir» una imagen desde la galería → foto o portada de un contacto (se reduce a 2048 px como mucho). */
    @SuppressWarnings("deprecation")
    private void shareImage(Intent intent) {
        android.net.Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        intent.setAction(null); // que no se vuelva a procesar al girar la pantalla
        if (uri == null) return;
        new Thread(() -> {
            try {
                android.content.ContentResolver cr = getContentResolver();
                android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                try (java.io.InputStream in = cr.openInputStream(uri)) { android.graphics.BitmapFactory.decodeStream(in, null, o); }
                int sample = 1;
                while (Math.max(o.outWidth, o.outHeight) / sample > 2048) sample *= 2;
                android.graphics.BitmapFactory.Options d = new android.graphics.BitmapFactory.Options();
                d.inSampleSize = sample;
                android.graphics.Bitmap bmp;
                try (java.io.InputStream in = cr.openInputStream(uri)) { bmp = android.graphics.BitmapFactory.decodeStream(in, null, d); }
                if (bmp == null) return;
                // Girar según los datos EXIF (fotos de la cámara)
                int rot = 0;
                try (java.io.InputStream in = cr.openInputStream(uri)) {
                    if (in != null) {
                        int or = new android.media.ExifInterface(in).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1);
                        rot = or == 6 ? 90 : or == 3 ? 180 : or == 8 ? 270 : 0;
                    }
                } catch (Exception ignored) {
                    // sin EXIF
                }
                if (rot != 0) {
                    android.graphics.Matrix m = new android.graphics.Matrix();
                    m.postRotate(rot);
                    bmp = android.graphics.Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
                }
                boolean png = bmp.hasAlpha();
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                bmp.compress(png ? android.graphics.Bitmap.CompressFormat.PNG : android.graphics.Bitmap.CompressFormat.JPEG, 90, out);
                String b64 = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
                JSObject data = new JSObject();
                data.put("image", "data:image/" + (png ? "png" : "jpeg") + ";base64," + b64);
                runOnUiThread(() -> MaterialYouPlugin.deliverShare(data));
            } catch (Exception ignored) {
                // imagen no legible
            }
        }).start();
    }
}
