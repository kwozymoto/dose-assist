package nz.whendose.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * A nudge from the other linked phone, handled with the app closed: the new
 * reminder times, sealed with the family key (js/synccrypto.js, AES-256-GCM,
 * IV first). Opens them and hands them to the notifications plugin's own
 * scheduler, exactly as the app would (js/native.js toNative). Nothing is
 * logged, and nothing here decides what is allowed: the times were worked
 * out by the app on the other phone from the shared record.
 */
final class Nudge {

    static final String PREFS = "whendose";
    static final String KEY = "syncKey";
    static final String OFF = "remindersOff";

    private Nudge() {}

    static void apply(Context ctx, String sealed) throws Exception {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String key = p.getString(KEY, null);
        if (key == null || p.getBoolean(OFF, false)) return;

        byte[] k = Base64.decode(key, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        byte[] all = Base64.decode(sealed, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(k, "AES"), new GCMParameterSpec(128, all, 0, 12));
        String json = new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);

        JSONObject payload = new JSONObject(json);
        if (payload.optInt("v") != 1) return;
        JSONArray list = payload.getJSONArray("notices");
        List<LocalNotification> notices = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            notices.add(LocalNotification.Companion.buildNotificationFromJSObject(new JSObject(list.getJSONObject(i).toString())));
        }

        NotificationStorage storage = new NotificationStorage(ctx);
        LocalNotificationManager manager = new LocalNotificationManager(storage, null, ctx, CapConfig.loadDefault(ctx));
        // Every scheduled notification in this app is a reminder. When the
        // nudge holds the whole list, replace them all; otherwise update those
        // it holds and leave the rest until the app next opens.
        if (payload.optBoolean("complete", false)) manager.cancelAll();
        if (!notices.isEmpty()) {
            manager.schedule(null, notices);
            storage.appendNotifications(notices);
        }
    }
}
