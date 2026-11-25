package app.nexote

import android.content.Context
import android.util.Base64
import androidx.core.content.edit
import java.security.SecureRandom

/** The theme the page reported last: its background and whether it is dark. */
data class PageTheme(val dark: Boolean, val color: Int)

/** The few things the app itself remembers: data folder, engine port, engine secret, page theme. */
class AppPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("nexote", Context.MODE_PRIVATE)

    /** Absolute path of the data folder, null until setup picked one. */
    var folder: String?
        get() = prefs.getString(KEY_FOLDER, null)
        set(value) = prefs.edit { putString(KEY_FOLDER, value) }

    // The page's origin includes the port, and localStorage/IndexedDB belong
    // to the origin: the engine has to come back on the same port every time.
    // The first bound port is kept for good; when it is busy on a later start
    // the engine's fallback port only serves that run.
    val port: Int
        get() = prefs.getInt(KEY_PORT, DEFAULT_PORT)

    fun keepFirstPort(bound: Int) {
        if (!prefs.contains(KEY_PORT)) prefs.edit { putInt(KEY_PORT, bound) }
    }

    // Any app on the phone can connect to 127.0.0.1; the engine only answers
    // requests carrying this secret in its cookie. Written synchronously so a
    // crash right after generating it can't leave the WebView with a cookie
    // the next start doesn't know.
    val secret: String by lazy {
        prefs.getString(KEY_SECRET, null) ?: newSecret().also { generated -> prefs.edit(commit = true) { putString(KEY_SECRET, generated) } }
    }

    // Kept so the next launch paints the page's background (and matching
    // bar icons) before the page has loaded. Null until a page sent one.
    val pageTheme: PageTheme?
        get() = if (prefs.contains(KEY_THEME_COLOR)) {
            PageTheme(prefs.getBoolean(KEY_THEME_DARK, false), prefs.getInt(KEY_THEME_COLOR, 0))
        } else {
            null
        }

    fun savePageTheme(theme: PageTheme) = prefs.edit {
        putBoolean(KEY_THEME_DARK, theme.dark)
        putInt(KEY_THEME_COLOR, theme.color)
    }

    private fun newSecret(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    private companion object {
        const val KEY_FOLDER = "folder"
        const val KEY_PORT = "port"
        const val KEY_SECRET = "secret"
        const val KEY_THEME_DARK = "themeDark"
        const val KEY_THEME_COLOR = "themeColor"
        const val DEFAULT_PORT = 39317
    }
}
