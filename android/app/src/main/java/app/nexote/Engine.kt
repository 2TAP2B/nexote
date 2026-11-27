package app.nexote

import android.content.Context
import app.nexote.mobile.Mobile

/** The one way into the Go engine, for the activity and the background sync alike. */
object Engine {
    /**
     * Blocking: points the engine at this app and starts it on [folder] (a no-op returning the
     * running port when it already serves that folder in this process). Returns the bound port.
     * [ifIdle] (background work): an engine already running in this process is left alone, even on
     * another folder, since the open page may have just switched it there.
     */
    fun start(context: Context, prefs: AppPrefs, folder: String, port: Int = prefs.port, ifIdle: Boolean = false): Int {
        // Every start: the user may have installed or removed a CA certificate since the last one.
        Mobile.setHost(EngineHost(context.applicationContext))
        Mobile.setUserCAs(userCaPem())
        val bound = if (ifIdle) {
            Mobile.startIfIdle(folder, port.toLong(), prefs.secret)
        } else {
            Mobile.start(folder, port.toLong(), prefs.secret)
        }.toInt()
        prefs.keepFirstPort(bound)
        return bound
    }
}
