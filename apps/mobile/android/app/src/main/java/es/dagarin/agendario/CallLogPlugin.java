package es.dagarin.agendario;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Registro de llamadas: activar, primera carga, estado y ajuste de batería. */
@CapacitorPlugin(
    name = "CallLog",
    permissions = { @Permission(alias = "calls", strings = { Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE }) }
)
public class CallLogPlugin extends Plugin {

    private JSObject status() {
        Context ctx = getContext();
        SharedPreferences p = CallSync.prefs(ctx);
        JSObject r = new JSObject();
        r.put("enabled", p.getBoolean("enabled", false));
        r.put("permission", CallSync.hasPermission(ctx));
        r.put("lastSyncAt", p.getLong("lastSyncAt", 0));
        r.put("lastAdded", p.getInt("lastAdded", 0));
        r.put("lastError", p.getString("lastError", ""));
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        r.put("batteryOptimized", pm != null && !pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        return r;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    /** Servidor y token para enviar en segundo plano (se llama al abrir la app y al entrar). */
    @PluginMethod
    public void configure(PluginCall call) {
        CallSync.prefs(getContext()).edit()
            .putString("server", call.getString("server", ""))
            .putString("token", call.getString("token", ""))
            .apply();
        if (CallSync.prefs(getContext()).getBoolean("enabled", false)) CallSync.schedule(getContext());
        call.resolve(status());
    }

    /** Activar: since = milisegundos desde los que importar (0 = todo lo que guarde el móvil). */
    @PluginMethod
    public void enable(PluginCall call) {
        if (getPermissionState("calls") != PermissionState.GRANTED) {
            requestPermissionForAlias("calls", call, "permsDone");
            return;
        }
        doEnable(call);
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        if (getPermissionState("calls") == PermissionState.GRANTED) doEnable(call);
        else call.reject("Sin permiso para leer el registro de llamadas");
    }

    private void doEnable(PluginCall call) {
        Double since = call.getDouble("since");
        CallSync.prefs(getContext()).edit()
            .putBoolean("enabled", true)
            .putLong("since", since == null ? System.currentTimeMillis() : since.longValue())
            .apply();
        CallSync.schedule(getContext());
        CallSync.now(getContext(), 0);
        call.resolve(status());
    }

    @PluginMethod
    public void disable(PluginCall call) {
        CallSync.prefs(getContext()).edit().putBoolean("enabled", false).apply();
        CallSync.cancel(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void syncNow(PluginCall call) {
        CallSync.now(getContext(), 0);
        call.resolve(status());
    }

    /** Pide a Android que no corte Agendario en segundo plano. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        }
        call.resolve();
    }
}
