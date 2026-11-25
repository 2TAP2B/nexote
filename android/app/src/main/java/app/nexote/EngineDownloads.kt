package app.nexote

import android.content.Context
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fetches a file from the engine (with the WebView's engine cookie) into the
 * cache folder that res/xml/file_paths.xml shares through the FileProvider.
 */
object EngineDownloads {
    private const val DIR = "shared"
    private const val OCTET_STREAM = "application/octet-stream"
    private val UNSAFE_NAME_CHARS = Regex("[^A-Za-z0-9._ -]")

    class Download(val file: File, val type: String)

    /** Blocking; throws on any failure. */
    fun fetch(context: Context, url: String, contentDisposition: String?, mimetype: String?): Download {
        val connection = URL(url).openConnection()
        if (connection !is HttpURLConnection) throw IOException("not an HTTP URL: $url")
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 30_000
            CookieManager.getInstance().getCookie(url)?.let { connection.setRequestProperty("Cookie", it) }
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) throw IOException("HTTP $status for $url")
            val disposition = connection.getHeaderField("Content-Disposition") ?: contentDisposition
            val responseType = connection.contentType?.substringBefore(';')?.trim()
            val name = safeName(URLUtil.guessFileName(url, disposition, responseType ?: mimetype))
            val type = listOf(mimetype, responseType).firstOrNull { !it.isNullOrBlank() && it != OCTET_STREAM }
                ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
                ?: OCTET_STREAM
            val dir = File(context.cacheDir, DIR)
            // Only the newest file stays; viewers keep files they still have open.
            dir.listFiles()?.forEach { it.delete() }
            if (!dir.isDirectory && !dir.mkdirs()) throw IOException("can't create $dir")
            val file = File(dir, name)
            connection.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
            return Download(file, type)
        } finally {
            connection.disconnect()
        }
    }

    // A name from a header must not leave the folder or hide itself.
    private fun safeName(name: String): String =
        name.replace(UNSAFE_NAME_CHARS, "_").trim().trimStart('.').ifEmpty { "file" }
}
