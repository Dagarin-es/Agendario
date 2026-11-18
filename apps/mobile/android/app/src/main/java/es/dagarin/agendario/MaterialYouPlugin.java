package es.dagarin.agendario;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Expone la paleta dinámica Material You (Android 12+) a la web. */
@CapacitorPlugin(name = "MaterialYou")
public class MaterialYouPlugin extends Plugin {
    private static final int[] TONES = {0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000};

    @PluginMethod
    public void getPalette(PluginCall call) {
        JSObject ret = new JSObject();
        Context ctx = getContext();
        int night = ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        ret.put("dark", night == Configuration.UI_MODE_NIGHT_YES);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            ret.put("available", false);
            call.resolve(ret);
            return;
        }
        ret.put("available", true);
        String[] groups = {"accent1", "accent2", "accent3", "neutral1", "neutral2"};
        for (String g : groups) {
            JSObject tones = new JSObject();
            for (int t : TONES) {
                int id = ctx.getResources().getIdentifier("system_" + g + "_" + t, "color", "android");
                if (id != 0) {
                    int c = ctx.getColor(id);
                    tones.put(String.valueOf(t), String.format("#%06X", 0xFFFFFF & c));
                }
            }
            ret.put(g, tones);
        }
        call.resolve(ret);
    }
}
