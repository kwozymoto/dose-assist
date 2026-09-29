package nz.whendose.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the app tell the native side what NudgeService needs with the app
 * closed: the family key (to open sealed reminder times) and whether the
 * parent turned reminders off. Kept in this app's private storage, like the
 * app's own database.
 */
@CapacitorPlugin(name = "WhenDose")
public class WhenDosePlugin extends Plugin {

    @PluginMethod
    public void setSyncKey(PluginCall call) {
        SharedPreferences.Editor e = getContext().getSharedPreferences(Nudge.PREFS, Context.MODE_PRIVATE).edit();
        String key = call.getString("key");
        if (key == null || key.isEmpty()) e.remove(Nudge.KEY);
        else e.putString(Nudge.KEY, key);
        e.apply();
        call.resolve();
    }

    @PluginMethod
    public void setRemindersOff(PluginCall call) {
        getContext().getSharedPreferences(Nudge.PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(Nudge.OFF, Boolean.TRUE.equals(call.getBoolean("off", false)))
            .apply();
        call.resolve();
    }
}
