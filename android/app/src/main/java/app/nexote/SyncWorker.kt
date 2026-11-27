package app.nexote

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import app.nexote.mobile.Mobile
import java.util.concurrent.TimeUnit

/**
 * Syncs with the paired server while the app is closed: starts the engine on the saved folder
 * (or finds it running in this process) and waits for one sync.
 */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val prefs = AppPrefs(applicationContext)
        val folder = prefs.folder
        if (folder == null || !StorageFolders.hasAccess(applicationContext)) return Result.success()
        try {
            // Never paired (or unpaired): no reason to start the engine at all.
            if (EngineHost(applicationContext).loadSecret(PAIRING_SECRET).isEmpty()) return Result.success()
            Engine.start(applicationContext, prefs, folder, ifIdle = true)
            // Returns at once when the pairing was revoked meanwhile.
            Mobile.syncNowWait(SYNC_TIMEOUT_SECONDS)
        } catch (e: Exception) {
            // No retry: a broken server would be hammered; the next period tries again anyway.
            Log.w(TAG, "background sync failed", e)
        }
        return Result.success()
    }

    companion object {
        private const val TAG = "NexoteSync"
        // The engine's name for the server connection in the host's secret store.
        private const val PAIRING_SECRET = "sync"
        private const val WORK_NAME = "sync"
        // Well inside WorkManager's 10-minute limit for one run.
        private const val SYNC_TIMEOUT_SECONDS = 240L

        /** Every 15 minutes (WorkManager's minimum) with a network; KEEP leaves a scheduled one alone. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
