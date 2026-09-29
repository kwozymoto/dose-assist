package nz.whendose.app;

import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Receives Firebase messages. Passes each on to the app (which syncs at once
 * if it is running), and for a sync nudge also moves the reminder alarms
 * here, so it works with the app closed. Replaces the push plugin's own
 * service (see AndroidManifest.xml).
 */
public class NudgeService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        if (!"sync".equals(data.get("t"))) return;
        String sealed = data.get("n");
        if (sealed == null || sealed.isEmpty()) return;
        try {
            Nudge.apply(getApplicationContext(), sealed);
        } catch (Exception e) {
            Log.w("WhenDose", "reminder times from the other phone were not applied", e);
        }
    }
}
