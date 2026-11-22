package es.dagarin.agendario;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Tarjeta flotante de Agendario durante las llamadas (permiso «Mostrar sobre otras apps»):
 *  - al sonar o marcar: nombre, últimas notas y recordatorios del contacto;
 *  - durante la llamada: una burbuja que, al tocarla, abre un cuadro para escribir una nota.
 * La nota se guarda en el móvil y CallSync la pega a la llamada al colgar.
 */
final class CallOverlay {
    private static final Handler ui = new Handler(Looper.getMainLooper());
    private static View card;
    private static View bubble;
    private static View editor;
    private static String number;
    private static String name = "";
    private CallOverlay() {}

    static boolean canDraw(Context ctx) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx);
    }

    static boolean enabled(Context ctx) {
        return CallSync.prefs(ctx).getBoolean("overlay", false) && canDraw(ctx);
    }

    private static int dp(Context ctx, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.getResources().getDisplayMetrics()));
    }

    private static boolean dark(Context ctx) {
        return (ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private static WindowManager wm(Context ctx) {
        return (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
    }

    private static WindowManager.LayoutParams params(boolean focusable, int gravity, int width) {
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED;
        if (!focusable) flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(width, WindowManager.LayoutParams.WRAP_CONTENT, type, flags, PixelFormat.TRANSLUCENT);
        lp.gravity = gravity;
        if (focusable) lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE;
        return lp;
    }

    private static GradientDrawable panel(Context ctx) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(dark(ctx) ? 0xF21E1B2E : 0xF7FFFFFF);
        g.setCornerRadius(dp(ctx, 22));
        g.setStroke(dp(ctx, 1), dark(ctx) ? 0x33FFFFFF : 0x1A312E81);
        return g;
    }

    private static TextView text(Context ctx, String s, float sp, boolean bold, int color) {
        TextView t = new TextView(ctx);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private static Button button(Context ctx, String s, boolean primary) {
        Button b = new Button(ctx);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(ctx, 18));
        g.setColor(primary ? 0xFF4338CA : (dark(ctx) ? 0x22FFFFFF : 0x14312E81));
        b.setBackground(g);
        b.setTextColor(primary ? 0xFFFFFFFF : (dark(ctx) ? 0xFFE0E7FF : 0xFF312E81));
        b.setPadding(dp(ctx, 16), 0, dp(ctx, 16), 0);
        b.setMinHeight(dp(ctx, 40));
        b.setMinimumHeight(dp(ctx, 40));
        return b;
    }

    private static void remove(Context ctx, View v) {
        if (v == null) return;
        try {
            wm(ctx).removeView(v);
        } catch (Exception ignored) {
            // ya quitada
        }
    }

    /** Tarjeta con las notas del contacto. lookup = respuesta de /api/calls/lookup */
    static void showCard(Context app, String num, JSONObject lookup, boolean collapseLater) {
        ui.post(() -> {
            if (!enabled(app)) return;
            number = num;
            name = lookup.optString("name");
            remove(app, card);
            card = null;
            int fg = dark(app) ? 0xFFF1F5F9 : 0xFF0F172A;
            int muted = dark(app) ? 0xFFA5B4FC : 0xFF64748B;
            LinearLayout box = new LinearLayout(app);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setBackground(panel(app));
            int pad = dp(app, 16);
            box.setPadding(pad, pad, pad, dp(app, 12));
            box.setElevation(dp(app, 8));

            LinearLayout head = new LinearLayout(app);
            head.setGravity(Gravity.CENTER_VERTICAL);
            ImageView icon = new ImageView(app);
            icon.setImageResource(R.mipmap.ic_launcher_round);
            head.addView(icon, new LinearLayout.LayoutParams(dp(app, 28), dp(app, 28)));
            LinearLayout who = new LinearLayout(app);
            who.setOrientation(LinearLayout.VERTICAL);
            who.setPadding(dp(app, 10), 0, 0, 0);
            who.addView(text(app, name, 17, true, fg));
            String sub = lookup.optString("subtitle");
            if (!sub.isEmpty()) who.addView(text(app, sub, 13, false, muted));
            head.addView(who, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            box.addView(head);

            JSONArray rem = lookup.optJSONArray("reminders");
            if (rem != null && rem.length() > 0) {
                TextView h = text(app, "⏰ Pendiente", 12, true, 0xFFB45309);
                h.setPadding(0, dp(app, 12), 0, dp(app, 2));
                box.addView(h);
                for (int i = 0; i < rem.length(); i++) {
                    JSONObject r = rem.optJSONObject(i);
                    String t = ReminderStore.pick(ReminderStore.LABELS, r.optString("kind"));
                    if (!r.optString("text").isEmpty()) t += " · " + r.optString("text");
                    TextView line = text(app, "• " + t, 14, false, fg);
                    line.setMaxLines(2);
                    line.setEllipsize(TextUtils.TruncateAt.END);
                    box.addView(line);
                }
            }
            JSONArray notes = lookup.optJSONArray("notes");
            TextView nh = text(app, notes != null && notes.length() > 0 ? "📝 Últimas anotaciones" : "📝 Sin anotaciones todavía", 12, true, muted);
            nh.setPadding(0, dp(app, 12), 0, dp(app, 2));
            box.addView(nh);
            if (notes != null) {
                SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US);
                SimpleDateFormat out = new SimpleDateFormat("d MMM", new Locale("es", "ES"));
                for (int i = 0; i < notes.length(); i++) {
                    JSONObject n = notes.optJSONObject(i);
                    String when = "";
                    try {
                        Date d = in.parse(n.optString("at").replace("Z", "+00:00"));
                        if (d != null) when = out.format(d) + " · ";
                    } catch (Exception ignored) {
                        // sin fecha
                    }
                    TextView line = text(app, when + n.optString("text").replace('\n', ' '), 14, false, fg);
                    line.setMaxLines(3);
                    line.setEllipsize(TextUtils.TruncateAt.END);
                    line.setPadding(0, dp(app, 2), 0, dp(app, 2));
                    box.addView(line);
                }
            }
            LinearLayout actions = new LinearLayout(app);
            actions.setGravity(Gravity.END);
            actions.setPadding(0, dp(app, 10), 0, 0);
            Button close = button(app, "Ocultar", false);
            Button write = button(app, "📝 Anotar", true);
            close.setOnClickListener(v -> collapse(app));
            write.setOnClickListener(v -> openEditor(app));
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(app, 40));
            blp.setMarginStart(dp(app, 8));
            actions.addView(close, blp);
            actions.addView(write, blp);
            box.addView(actions);

            WindowManager.LayoutParams lp = params(false, Gravity.TOP | Gravity.CENTER_HORIZONTAL, WindowManager.LayoutParams.MATCH_PARENT);
            lp.y = dp(app, 56);
            lp.horizontalMargin = 0.03f;
            try {
                wm(app).addView(box, lp);
                card = box;
            } catch (Exception e) {
                card = null;
            }
            if (collapseLater) ui.postDelayed(() -> { if (card == box) collapse(app); }, 12_000);
        });
    }

    /** Durante la llamada: burbuja pequeña en el lateral. */
    static void collapse(Context app) {
        ui.post(() -> {
            remove(app, card);
            card = null;
            showBubble(app);
        });
    }

    /** Llamada en curso: quita la tarjeta y deja la burbuja (también si no había tarjeta, p. ej. número desconocido). */
    static void inCall(Context app, String num, String who) {
        ui.post(() -> {
            if (!enabled(app)) return;
            if (num != null) number = num;
            if (who != null && !who.isEmpty()) name = who;
            if (card == null && editor == null) showBubble(app);
        });
    }

    @SuppressLint("ClickableViewAccessibility")
    private static void showBubble(Context app) {
        if (bubble != null || !enabled(app)) return;
        ImageView b = new ImageView(app);
        b.setImageResource(R.mipmap.ic_launcher_round);
        b.setElevation(dp(app, 6));
        b.setContentDescription("Anotar en Agendario");
        int size = dp(app, 52);
        WindowManager.LayoutParams lp = params(false, Gravity.TOP | Gravity.END, size);
        lp.height = size;
        lp.x = dp(app, 6);
        lp.y = dp(app, 180);
        final float[] start = new float[3];
        b.setOnTouchListener((v, e) -> {
            switch (e.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    start[0] = e.getRawY();
                    start[1] = lp.y;
                    start[2] = 0;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dy = e.getRawY() - start[0];
                    if (Math.abs(dy) > dp(app, 6)) start[2] = 1;
                    lp.y = Math.max(0, (int) (start[1] + dy));
                    try { wm(app).updateViewLayout(v, lp); } catch (Exception ignored) { /* quitada */ }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (start[2] == 0) openEditor(app);
                    return true;
                default:
                    return false;
            }
        });
        try {
            wm(app).addView(b, lp);
            bubble = b;
        } catch (Exception e) {
            bubble = null;
        }
    }

    /** Cuadro para escribir la nota (con teclado). */
    static void openEditor(Context app) {
        ui.post(() -> {
            remove(app, card);
            card = null;
            remove(app, bubble);
            bubble = null;
            remove(app, editor);
            int fg = dark(app) ? 0xFFF1F5F9 : 0xFF0F172A;
            LinearLayout box = new LinearLayout(app);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setBackground(panel(app));
            int pad = dp(app, 16);
            box.setPadding(pad, pad, pad, dp(app, 12));
            box.setElevation(dp(app, 8));
            box.addView(text(app, "📝 Nota · " + (name.isEmpty() ? (number != null ? number : "llamada") : name), 15, true, fg));
            String prev = InCallNotes.peek(app);
            if (!prev.isEmpty()) {
                TextView p = text(app, "✓ " + prev.replace('\n', ' '), 13, false, 0xFF059669);
                p.setMaxLines(3);
                p.setEllipsize(TextUtils.TruncateAt.END);
                p.setPadding(0, dp(app, 6), 0, 0);
                box.addView(p);
            }
            EditText et = new EditText(app);
            et.setHint("¿Qué quieres apuntar?");
            et.setTextColor(fg);
            et.setHintTextColor(dark(app) ? 0x88FFFFFF : 0x88475569);
            et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            et.setMinLines(3);
            et.setMaxLines(6);
            et.setGravity(Gravity.TOP | Gravity.START);
            LinearLayout.LayoutParams elp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            elp.topMargin = dp(app, 8);
            box.addView(et, elp);
            LinearLayout actions = new LinearLayout(app);
            actions.setGravity(Gravity.END);
            actions.setPadding(0, dp(app, 8), 0, 0);
            Button cancel = button(app, "Cancelar", false);
            Button save = button(app, "Guardar", true);
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(app, 40));
            blp.setMarginStart(dp(app, 8));
            actions.addView(cancel, blp);
            actions.addView(save, blp);
            box.addView(actions);
            cancel.setOnClickListener(v -> closeEditor(app, et));
            save.setOnClickListener(v -> {
                String t = et.getText().toString().trim();
                if (!t.isEmpty()) {
                    InCallNotes.add(app, number, t);
                    Toast.makeText(app, "Nota guardada: se añadirá a la llamada al colgar", Toast.LENGTH_SHORT).show();
                    if (CallSync.prefs(app).getBoolean("ongoing", false)) CallNotify.ongoing(app, number, name, true);
                }
                closeEditor(app, et);
            });
            WindowManager.LayoutParams lp = params(true, Gravity.TOP | Gravity.CENTER_HORIZONTAL, WindowManager.LayoutParams.MATCH_PARENT);
            lp.y = dp(app, 56);
            lp.horizontalMargin = 0.03f;
            try {
                wm(app).addView(box, lp);
                editor = box;
                et.requestFocus();
                ui.postDelayed(() -> {
                    InputMethodManager im = (InputMethodManager) app.getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (im != null) im.showSoftInput(et, InputMethodManager.SHOW_IMPLICIT);
                }, 150);
            } catch (Exception e) {
                editor = null;
            }
        });
    }

    private static void closeEditor(Context app, EditText et) {
        InputMethodManager im = (InputMethodManager) app.getSystemService(Context.INPUT_METHOD_SERVICE);
        if (im != null) im.hideSoftInputFromWindow(et.getWindowToken(), 0);
        remove(app, editor);
        editor = null;
        if (CallSync.prefs(app).getBoolean("inCall", false)) showBubble(app);
    }

    /** Al colgar: se quita todo. */
    static void hideAll(Context app) {
        ui.post(() -> {
            remove(app, card);
            remove(app, bubble);
            // El editor se deja abierto si se está escribiendo: se cierra al guardar o cancelar
            card = null;
            bubble = null;
        });
    }
}
