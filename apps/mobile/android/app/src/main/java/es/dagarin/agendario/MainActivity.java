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

    /** «Compartir» → Añadir idea de regalo: se pasa el texto/enlace a la web. */
    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) return;
        JSObject data = new JSObject();
        data.put("text", text);
        data.put("title", intent.getStringExtra(Intent.EXTRA_SUBJECT));
        MaterialYouPlugin.deliverShare(data);
    }
}
