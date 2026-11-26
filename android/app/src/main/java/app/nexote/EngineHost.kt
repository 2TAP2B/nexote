package app.nexote

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.core.content.edit
import app.nexote.mobile.Host
import java.security.KeyStore
import java.security.cert.Certificate
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The engine's host: secrets (the server connection) encrypted with an AES-GCM key that never
 * leaves the AndroidKeyStore, stored in a private preferences file. Not in the data folder: that
 * one is user-visible and other sync tools may copy it. Backups exclude app data altogether
 * (data_extraction_rules.xml), and the key couldn't be restored on another device anyway.
 *
 * Go calls in from its own threads, hence the synchronized methods.
 */
class EngineHost(context: Context) : Host {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    override fun loadSecret(name: String): String {
        val stored = prefs.getString(name, null) ?: return ""
        val key = existingKey()
        val bytes = runCatching { Base64.decode(stored, Base64.NO_WRAP) }.getOrNull()
        if (key == null || bytes == null || bytes.size <= IV_BYTES) return dropUnreadable(name)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        // The name is authenticated too, so one secret can't be passed off as another.
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        return try {
            String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
        } catch (e: AEADBadTagException) {
            dropUnreadable(name)
        }
    }

    @Synchronized
    override fun saveSecret(name: String, value: String) {
        if (value.isEmpty()) {
            prefs.edit(commit = true) { remove(name) }
            return
        }
        // The keystore picks a fresh random IV for every encryption.
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: newKey())
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        // Synchronously: the engine treats a returned save as done.
        val saved = prefs.edit().putString(name, Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()
        check(saved) { "could not write the app's secret store" }
    }

    override fun deviceName(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty().trim().replaceFirstChar { it.titlecase() }
        val model = Build.MODEL.orEmpty().trim()
        return when {
            model.isEmpty() -> manufacturer.ifEmpty { DEFAULT_DEVICE_NAME }
            manufacturer.isEmpty() || model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }
    }

    // A value its key can't open (the key is gone, e.g. the keystore was cleared, or the value is
    // damaged) will never open again; forgetting it lets the user simply pair again.
    private fun dropUnreadable(name: String): String {
        Log.w(TAG, "dropping the unreadable secret \"$name\"")
        prefs.edit(commit = true) { remove(name) }
        return ""
    }

    private fun existingKey(): SecretKey? {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return store.getKey(KEY_ALIAS, null) as? SecretKey
    }

    private fun newKey(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val TAG = "NexoteHost"
        const val PREFS = "nexote-secrets"
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "nexote-secrets"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        const val DEFAULT_DEVICE_NAME = "Android device"
    }
}

/**
 * The CA certificates the user installed (Settings › Security › Encryption & credentials) as one
 * PEM bundle, for the engine to trust when it talks to a server: self-hosted servers often use a
 * private CA. "" when there are none or the store can't be read.
 */
fun userCaPem(): String = try {
    val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
    store.aliases().toList()
        .filter { it.startsWith("user:") }
        .mapNotNull { store.getCertificate(it) }
        .joinToString("") { pem(it) }
} catch (e: Exception) {
    Log.w("NexoteHost", "reading the user CA certificates", e)
    ""
}

private fun pem(certificate: Certificate): String =
    "-----BEGIN CERTIFICATE-----\n" +
        Base64.encodeToString(certificate.encoded, Base64.DEFAULT) +
        "-----END CERTIFICATE-----\n"
