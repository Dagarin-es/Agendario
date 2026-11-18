package es.dagarin.agendario;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import java.util.HashSet;
import java.util.List;
import android.content.Context;
import android.content.pm.PackageManager;
import com.getcapacitor.JSArray;
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

    private static final String[] ICON_THEMES = {"indigo", "ocean", "lagoon", "lavender", "clay", "graphite"};

    /** Cambia el icono del lanzador activando el activity-alias del tema (y desactivando los demás). */
    @PluginMethod
    public void setIcon(PluginCall call) {
        String theme = call.getString("theme", "indigo");
        boolean known = false;
        for (String t : ICON_THEMES) if (t.equals(theme)) known = true;
        if (!known) theme = "indigo";
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        String pkg = ctx.getPackageName();
        // Primero se activa el nuevo y luego se apagan los demás (nunca se queda sin icono)
        String[] order = new String[ICON_THEMES.length];
        order[0] = theme;
        int i = 1;
        for (String t : ICON_THEMES) if (!t.equals(theme)) order[i++] = t;
        for (String t : order) {
            ComponentName cn = new ComponentName(pkg, pkg + ".Icon" + Character.toUpperCase(t.charAt(0)) + t.substring(1));
            int want = t.equals(theme) ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
            int cur = pm.getComponentEnabledSetting(cn);
            boolean curEnabled = cur == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (cur == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && t.equals("indigo"));
            boolean wantEnabled = want == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
            if (curEnabled != wantEnabled) pm.setComponentEnabledSetting(cn, want, PackageManager.DONT_KILL_APP);
        }
        call.resolve();
    }

    /** Qué apps de la lista están instaladas (para ofrecer solo esas en Ajustes). */
    /** Apps de correo instaladas (las que atienden un enlace mailto:). */
    @PluginMethod
    public void mailApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"));
        List<ResolveInfo> list = Build.VERSION.SDK_INT >= 33
            ? pm.queryIntentActivities(i, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_ALL))
            : pm.queryIntentActivities(i, PackageManager.MATCH_ALL);
        JSArray apps = new JSArray();
        HashSet<String> seen = new HashSet<>();
        for (ResolveInfo r : list) {
            String pkg = r.activityInfo.packageName;
            if (!seen.add(pkg)) continue;
            JSObject o = new JSObject();
            o.put("package", pkg);
            o.put("label", String.valueOf(r.loadLabel(pm)));
            apps.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("apps", apps);
        call.resolve(ret);
    }

    /** Escribe un correo con la app indicada (o con la predeterminada / el selector si no se indica). */
    @PluginMethod
    public void openMail(PluginCall call) {
        String to = call.getString("to", "");
        String pkg = call.getString("package");
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(to, "@")));
        if (pkg != null && !pkg.isEmpty()) i.setPackage(pkg);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            if (pkg != null && !pkg.isEmpty()) {
                // La app ya no está: se abre la predeterminada
                try { i.setPackage(null); getContext().startActivity(i); call.resolve(); return; } catch (Exception ignored) {}
            }
            call.reject("No hay ninguna app de correo");
        }
    }

    @PluginMethod
    public void installedApps(PluginCall call) {
        JSObject ret = new JSObject();
        PackageManager pm = getContext().getPackageManager();
        try {
            JSArray list = call.getArray("packages");
            for (int i = 0; i < list.length(); i++) {
                String pkg = list.getString(i);
                boolean ok;
                try {
                    pm.getPackageInfo(pkg, 0);
                    ok = true;
                } catch (PackageManager.NameNotFoundException e) {
                    ok = false;
                }
                ret.put(pkg, ok);
            }
        } catch (Exception e) {
            call.reject("Lista de apps no válida");
            return;
        }
        call.resolve(ret);
    }

    // ----- «Compartir» desde otra app (Añadir idea de regalo) -----
    static JSObject pendingShare = null;
    static MaterialYouPlugin instance = null;

    @Override
    public void load() {
        instance = this;
    }

    static void deliverShare(JSObject data) {
        if (instance != null && instance.hasListeners("share")) instance.notifyListeners("share", data, true);
        else pendingShare = data;
    }

    static JSObject pendingOpen = null;

    static void deliverOpen(JSObject data) {
        if (instance != null && instance.hasListeners("open")) instance.notifyListeners("open", data, true);
        else pendingOpen = data;
    }

    @PluginMethod
    public void consumeOpen(PluginCall call) {
        JSObject r = pendingOpen != null ? pendingOpen : new JSObject();
        pendingOpen = null;
        call.resolve(r);
    }

    @PluginMethod
    public void consumeShare(PluginCall call) {
        JSObject r = pendingShare != null ? pendingShare : new JSObject();
        pendingShare = null;
        call.resolve(r);
    }
}
