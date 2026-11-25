package app.nexote

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream

/** What another app shared with Nexote (ACTION_SEND / ACTION_SEND_MULTIPLE). */
class Share(val text: String?, val subject: String?, val streams: List<Uri>) {
    companion object {
        fun from(intent: Intent): Share? {
            val streams = when (intent.action) {
                Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
                Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
                else -> return null
            }
            return Share(
                text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
                subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString(),
                streams = streams,
            )
        }
    }
}

/** Turns a [Share] into the bridge's "share" message, reading the shared images. */
object ShareReader {
    private const val MAX_FILES = 10
    // Same limit as the engine's image upload.
    private const val MAX_FILE_BYTES = 20L * 1024 * 1024
    // All files of one share together: base64, the JSON string and
    // postMessage each copy them again, which mustn't exhaust the heap.
    private const val MAX_SHARE_BYTES = 25L * 1024 * 1024

    /** Blocking (reads every file); null when nothing usable was shared. */
    fun message(resolver: ContentResolver, share: Share): String? {
        val files = JSONArray()
        var budget = MAX_SHARE_BYTES
        for (uri in share.streams) {
            if (files.length() >= MAX_FILES || budget <= 0) break
            // Files beyond the budget are skipped; smaller ones after them may still fit.
            val (file, size) = readImage(resolver, uri, minOf(MAX_FILE_BYTES, budget)) ?: continue
            files.put(file)
            budget -= size
        }
        if (share.text.isNullOrEmpty() && share.subject.isNullOrEmpty() && files.length() == 0) return null
        return JSONObject().apply {
            put("type", "share")
            if (!share.text.isNullOrEmpty()) put("text", share.text)
            if (!share.subject.isNullOrEmpty()) put("subject", share.subject)
            if (files.length() > 0) put("files", files)
        }.toString()
    }

    // The image as the bridge's file object, plus its size in bytes.
    private fun readImage(resolver: ContentResolver, uri: Uri, limit: Long): Pair<JSONObject, Int>? {
        // file:// URIs could point into this app's private storage (the
        // engine secret); a sender can only hand over content it may grant.
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) return null
        var name: String? = null
        var size: Long? = null
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    if (!cursor.isNull(0)) name = cursor.getString(0)
                    if (!cursor.isNull(1)) size = cursor.getLong(1)
                }
            }
        }
        val type = runCatching { resolver.getType(uri) }.getOrNull() ?: name?.let(::typeFromName)
        // The page attaches shared files as images.
        if (type == null || !type.startsWith("image/")) return null
        if ((size ?: 0L) > limit) return null
        val bytes = runCatching { resolver.openInputStream(uri)?.use { readLimited(it, limit) } }.getOrNull() ?: return null
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(type) ?: "jpg"
        val file = JSONObject().apply {
            put("name", name ?: "image.$extension")
            put("type", type)
            put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
        return file to bytes.size
    }

    private fun typeFromName(name: String): String? =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())

    // The provider's SIZE can be missing or wrong; stop reading past the limit.
    private fun readLimited(input: InputStream, limit: Long): ByteArray? {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > limit) return null
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }
}
