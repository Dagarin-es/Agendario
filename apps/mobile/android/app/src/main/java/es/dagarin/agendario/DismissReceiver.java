package es.dagarin.agendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationManagerCompat;

/** «No, gracias»: cierra el aviso sin apuntar nada. */
public class DismissReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra("notificationId", 0));
    }
}
