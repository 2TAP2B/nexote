package app.nexote

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import java.io.File

/**
 * The engine works on plain file paths, so the folder picked in the system's
 * document picker has to be turned back into one, and the app needs
 * permission to use shared storage directly.
 */
object StorageFolders {
    private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

    // getExternalStorageDirectory is deprecated for apps under scoped
    // storage; with all-files access (or legacy storage) it is the real path.
    @Suppress("DEPRECATION")
    private val primaryRoot: File
        get() = Environment.getExternalStorageDirectory()

    fun defaultFolder(): File = File(primaryRoot, "Documents/Nexote")

    fun hasAccess(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }

    /**
     * Maps a tree picked with ACTION_OPEN_DOCUMENT_TREE to its path. Only the
     * external storage provider's trees are real folders ("primary:Documents/
     * Notes", "1234-ABCD:Notes" for an SD card); cloud and app providers give
     * null.
     */
    fun fromTreeUri(uri: Uri): File? {
        if (uri.authority != EXTERNAL_STORAGE_AUTHORITY) return null
        val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull() ?: return null
        val volume = documentId.substringBefore(':', missingDelimiterValue = "")
        val path = documentId.substringAfter(':', missingDelimiterValue = "")
        val base = when (volume) {
            "" -> return null
            "primary" -> primaryRoot
            // Some versions offer the Documents folder as its own root.
            "home" -> File(primaryRoot, Environment.DIRECTORY_DOCUMENTS)
            else -> File("/storage", volume)
        }
        return if (path.isEmpty()) base else File(base, path)
    }

    /**
     * Where the folder picker should open: the folder itself, or its closest
     * existing parent (the picker can't show a folder that isn't there yet).
     */
    fun pickerStart(folder: File): Uri? {
        val root = primaryRoot.absolutePath
        var dir: File? = folder.absoluteFile
        while (dir != null && !dir.isDirectory) dir = dir.parentFile
        val path = dir?.absolutePath ?: return null
        if (path != root && !path.startsWith("$root/")) return null
        val relative = path.removePrefix(root).trimStart('/')
        return DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE_AUTHORITY, "primary:$relative")
    }

    /** Creates the folder if needed and proves that files can be written there. Blocking. */
    fun isWritable(folder: File): Boolean {
        if (!folder.isDirectory && !folder.mkdirs()) return false
        return runCatching {
            val probe = File.createTempFile(".nexote-", ".tmp", folder)
            try {
                probe.writeText("nexote")
            } finally {
                probe.delete()
            }
        }.isSuccess
    }
}
