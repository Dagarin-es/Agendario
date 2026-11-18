package es.dagarin.agendario;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Envía las llamadas nuevas; si saltó por un cambio en el registro, vuelve a quedarse vigilando. */
public class CallSyncWorker extends Worker {
    public CallSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        boolean ok = CallSync.run(ctx);
        if (getTags().contains("watch") && CallSync.prefs(ctx).getBoolean("enabled", false)) CallSync.watch(ctx);
        return ok ? Result.success() : Result.retry();
    }
}
