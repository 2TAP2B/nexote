package app.nexote

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.nexote.mobile.Mobile
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * The whole app: a native setup flow for the data folder, the Go engine
 * (gomobile, serving the API and the exported frontend on 127.0.0.1) and a
 * WebView showing it, plus the NexoteAndroid message bridge.
 */
class MainActivity : ComponentActivity() {

    private sealed interface Screen {
        data object Web : Screen
        data object Loading : Screen
        data class Setup(val folder: File, val note: String?) : Screen
        data class Error(val message: String) : Screen
    }

    private lateinit var prefs: AppPrefs
    private val engineHost by lazy { EngineHost(applicationContext) }
    private lateinit var root: FrameLayout
    private lateinit var webContainer: FrameLayout
    private lateinit var overlay: FrameLayout
    private var webView: WebView? = null
    private var screen: Screen = Screen.Loading

    // Mobile.start blocks while it opens the folder and binds the port; one
    // thread keeps the starts in order. Shared files are read on their own
    // thread so a slow start doesn't hold them up.
    private val engineThread = Executors.newSingleThreadExecutor()
    private val shareThread = Executors.newSingleThreadExecutor()
    private val downloadThread = Executors.newSingleThreadExecutor()
    // Only the newest start's result counts (an older one may be for the
    // folder the user just left).
    private var startGeneration = 0
    // The next successful start loads the page again even on the same
    // origin: the folder changed underneath it.
    private var reloadAfterStart = false
    // A folder switch is in flight: resumes must not start the old folder
    // meanwhile.
    private var switchingFolder = false
    // The port the engine runs on in this process. A folder switch asks for
    // it again so the origin stays even when the saved port was busy.
    private var runningPort: Int? = null

    // What the WebView has loaded; the cookie and the bridge are set up for it.
    private var loadedOrigin: String? = null
    private var bridgeOrigin: String? = null
    private var pageVisible = false
    // The page to come back to after the activity was recreated.
    private var restoreUrl: String? = null

    // Setup: the folder waiting for the storage permission.
    private var pendingFolder: File? = null
    private var awaitingAllFilesAccess = false

    // Bridge: the reply proxy of the current page's hello, and shares that
    // arrived before a page said hello.
    private var replyProxy: JavaScriptReplyProxy? = null
    private val pendingShares = ArrayDeque<String>()

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var mediaRequest: PermissionRequest? = null
    private var mediaResources: Map<String, String> = emptyMap()

    // The page's own theme (it can differ from the system's); null until a
    // page reported one on this or an earlier launch.
    private var pageTheme: PageTheme? = null

    // Back goes to the page first; while it answers, more presses are
    // ignored. 0 = no question pending.
    private var pendingBack = 0
    private var backSequence = 0
    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() = onBack()
    }

    private val folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { onFolderPicked(it) }
    private val storagePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { onStoragePermission(it) }
    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { deliverFiles(it) }
    private val mediaPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { onMediaPermissions() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = AppPrefs(this)
        pageTheme = prefs.pageTheme
        applySystemBars()
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        webContainer = findViewById(R.id.web_container)
        overlay = findViewById(R.id.overlay)

        // Debug builds can be inspected over adb (chrome://inspect, CDP).
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        // Drawing edge to edge also means adjustResize no longer shrinks the
        // window for the keyboard: the ime inset does that here.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, backCallback)

        applyBackground()
        if (savedInstanceState != null) {
            restoreUrl = savedInstanceState.getString(STATE_URL)
            pendingFolder = savedInstanceState.getString(STATE_PENDING_FOLDER)?.let(::File)
            awaitingAllFilesAccess = savedInstanceState.getBoolean(STATE_AWAITING_ACCESS)
        } else {
            // A recreated activity already took this intent's share.
            handleShare(intent)
        }
        showScreen(Screen.Loading)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShare(intent)
    }

    // Also the first start: onResume follows onCreate. Android may have
    // killed the process (and the engine with it) while the app was away;
    // starting again is cheap when it still runs.
    override fun onResume() {
        super.onResume()
        if (awaitingAllFilesAccess) {
            awaitingAllFilesAccess = false
            val folder = pendingFolder
            if (folder != null) {
                if (StorageFolders.hasAccess(this)) {
                    useFolder(folder)
                } else {
                    pendingFolder = null
                    showScreen(Screen.Setup(folder, getString(R.string.setup_permission_denied)))
                }
                return
            }
        }
        if (screen !is Screen.Setup) ensureEngine()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // The activity isn't recreated for a dark mode switch (configChanges
        // uiMode): follow it by hand.
        applySystemBars()
        applyBackground()
        if (screen != Screen.Web) showScreen(screen)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView?.url?.let { outState.putString(STATE_URL, it) }
        pendingFolder?.let { outState.putString(STATE_PENDING_FOLDER, it.path) }
        outState.putBoolean(STATE_AWAITING_ACCESS, awaitingAllFilesAccess)
    }

    override fun onDestroy() {
        // The engine keeps running: it lives as long as the process, and a
        // new activity in the same process finds it with Mobile.start.
        engineThread.shutdown()
        shareThread.shutdown()
        downloadThread.shutdown()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    // ---- System bars and colors ----

    private val systemIsDark: Boolean
        get() = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES

    // The page's background once it reported its theme, else the system's.
    private fun pageBackground(): Int = pageTheme?.color ?: getColor(R.color.background)

    // Transparent bars over our own background (the root is padded by
    // them), so the icons contrast with that: the page's theme once known,
    // else the system's. The system's extra scrim behind three-button
    // navigation isn't needed on a solid background.
    private fun applySystemBars() {
        val style = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { pageTheme?.dark ?: systemIsDark }
        enableEdgeToEdge(style, style)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
    }

    // The page's background behind the page and the bars, so loading and
    // switching never flash.
    private fun applyBackground() {
        val color = pageBackground()
        window.setBackgroundDrawable(ColorDrawable(color))
        root.setBackgroundColor(color)
        webContainer.setBackgroundColor(color)
        webView?.setBackgroundColor(color)
        applyOverlayBackground()
    }

    // Loading leads into the page and wears its background; the setup and
    // error screens have system-themed text and keep the system's.
    private fun applyOverlayBackground() {
        overlay.setBackgroundColor(if (screen == Screen.Loading) pageBackground() else getColor(R.color.background))
    }

    // ---- Native screens ----

    private fun showScreen(next: Screen) {
        screen = next
        applyOverlayBackground()
        overlay.removeAllViews()
        val onTop = next != Screen.Web
        overlay.isVisible = onTop
        // Keep screen readers out of the page while a native screen covers it.
        webContainer.importantForAccessibility =
            if (onTop) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        when (next) {
            Screen.Web -> Unit
            Screen.Loading -> layoutInflater.inflate(R.layout.screen_loading, overlay, true)
            is Screen.Setup -> {
                val view = layoutInflater.inflate(R.layout.screen_setup, overlay, true)
                view.findViewById<TextView>(R.id.folder_path).text = next.folder.path
                val note = next.note ?: when {
                    StorageFolders.hasAccess(this) -> null
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> getString(R.string.setup_permission_all_files)
                    else -> getString(R.string.setup_permission_storage)
                }
                view.findViewById<TextView>(R.id.note).apply {
                    text = note
                    isVisible = note != null
                }
                view.findViewById<Button>(R.id.use_folder).setOnClickListener { useFolder(next.folder) }
                view.findViewById<Button>(R.id.choose_folder).setOnClickListener { pickFolder(next.folder) }
            }
            is Screen.Error -> {
                val view = layoutInflater.inflate(R.layout.screen_error, overlay, true)
                view.findViewById<TextView>(R.id.message).text = next.message
                view.findViewById<Button>(R.id.choose_folder).setOnClickListener { pickFolder(currentFolder()) }
            }
        }
    }

    // ---- Data folder ----

    private fun currentFolder(): File = prefs.folder?.let(::File) ?: StorageFolders.defaultFolder()

    private fun pickFolder(start: File) {
        try {
            folderPicker.launch(StorageFolders.pickerStart(start))
        } catch (e: ActivityNotFoundException) {
            folderProblem(getString(R.string.folder_unsupported), start)
        }
    }

    // Cancelling the picker keeps whatever was on screen.
    private fun onFolderPicked(uri: Uri?) {
        if (uri == null) return
        val folder = StorageFolders.fromTreeUri(uri)
        if (folder == null) {
            folderProblem(getString(R.string.folder_unsupported), currentFolder())
            return
        }
        useFolder(folder)
    }

    /** Takes [folder] as the data folder once it has permission and is writable, then (re)starts the engine. */
    private fun useFolder(folder: File) {
        pendingFolder = folder
        if (!StorageFolders.hasAccess(this)) {
            requestStorageAccess()
            return
        }
        engineThread.execute {
            val writable = StorageFolders.isWritable(folder)
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                pendingFolder = null
                if (!writable) {
                    folderProblem(getString(R.string.folder_not_writable, folder.path), folder)
                    return@runOnUiThread
                }
                switchFolder(folder, fromWeb = screen == Screen.Web)
            }
        }
    }

    // Over the page (the web asked for another folder) a dialog; elsewhere
    // the setup screen with the problem.
    private fun folderProblem(message: String, folder: File) {
        if (screen == Screen.Web) {
            AlertDialog.Builder(this)
                .setTitle(R.string.folder_error_title)
                .setMessage(message)
                .setPositiveButton(R.string.ok, null)
                .show()
        } else {
            showScreen(Screen.Setup(folder, message))
        }
    }

    private fun requestStorageAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        // The answer comes back in onResume.
        awaitingAllFilesAccess = true
        val appPage = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.fromParts("package", packageName, null))
        try {
            startActivity(appPage)
        } catch (e: ActivityNotFoundException) {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            } catch (e: ActivityNotFoundException) {
                awaitingAllFilesAccess = false
                val folder = pendingFolder ?: currentFolder()
                pendingFolder = null
                showScreen(Screen.Setup(folder, getString(R.string.setup_permission_denied)))
            }
        }
    }

    private fun onStoragePermission(granted: Boolean) {
        val folder = pendingFolder ?: return
        if (granted) {
            useFolder(folder)
        } else {
            pendingFolder = null
            showScreen(Screen.Setup(folder, getString(R.string.setup_permission_denied)))
        }
    }

    // ---- Engine ----

    // Starts the engine on [folder]; it only becomes the data folder once the
    // engine accepted it. On failure Mobile.start has gone back to the
    // previous folder, which stays saved.
    private fun switchFolder(folder: File, fromWeb: Boolean) {
        switchingFolder = true
        showScreen(Screen.Loading)
        val path = folder.absolutePath
        startEngine(path) { result ->
            switchingFolder = false
            result
                .onSuccess { bound ->
                    prefs.folder = path
                    reloadAfterStart = true
                    showWeb(bound)
                }
                .onFailure { e ->
                    val message = e.message ?: getString(R.string.error_unknown)
                    if (fromWeb && loadedOrigin != null) {
                        // The page asked; it stays, on the previous folder.
                        showScreen(Screen.Web)
                        folderProblem(message, folder)
                        ensureEngine()
                    } else {
                        showScreen(Screen.Setup(folder, message))
                    }
                }
        }
    }

    private fun ensureEngine() {
        if (switchingFolder) return
        val folder = prefs.folder
        if (folder == null || !StorageFolders.hasAccess(this)) {
            showScreen(Screen.Setup(folder?.let(::File) ?: StorageFolders.defaultFolder(), null))
            return
        }
        if (screen != Screen.Web) showScreen(Screen.Loading)
        startEngine(folder) { result ->
            result
                .onSuccess { bound -> showWeb(bound) }
                .onFailure { e -> showScreen(Screen.Error(e.message ?: getString(R.string.error_unknown))) }
        }
    }

    // [then] runs on the main thread, only for the newest start.
    private fun startEngine(folder: String, then: (Result<Int>) -> Unit) {
        val generation = ++startGeneration
        val port = runningPort ?: prefs.port
        val secret = prefs.secret
        engineThread.execute {
            val result = runCatching {
                // Every start: the activity (and with it the host) may be new, and the user may
                // have installed or removed a CA certificate since the last one.
                Mobile.setHost(engineHost)
                Mobile.setUserCAs(userCaPem())
                Mobile.start(folder, port.toLong(), secret).toInt()
            }
            runOnUiThread {
                if (isDestroyed || generation != startGeneration) return@runOnUiThread
                result.onSuccess { bound ->
                    runningPort = bound
                    prefs.keepFirstPort(bound)
                }
                then(result)
            }
        }
    }

    // ---- WebView ----

    private fun showWeb(port: Int) {
        val origin = "http://127.0.0.1:$port"
        val view = webView ?: createWebView().also {
            webView = it
            webContainer.addView(it)
        }
        if (origin == loadedOrigin && !reloadAfterStart) {
            // Still loading: onPageCommitVisible takes the loading screen away.
            if (pageVisible) showScreen(Screen.Web)
            return
        }
        val url = restoreUrl?.takeIf { it.startsWith("$origin/") && !reloadAfterStart } ?: "$origin/"
        restoreUrl = null
        reloadAfterStart = false
        loadedOrigin = origin
        pageVisible = false
        replyProxy = null
        attachBridge(view, origin)
        CookieManager.getInstance().run {
            setAcceptCookie(true)
            setCookie(origin, "$ENGINE_COOKIE=${prefs.secret}; Path=/; HttpOnly; SameSite=Strict") {
                flush()
                if (webView === view) view.loadUrl(url)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply {
        layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setBackgroundColor(pageBackground())
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.userAgentString = "${settings.userAgentString} NexoteAndroid/${BuildConfig.VERSION_NAME}"
        webViewClient = PageClient()
        webChromeClient = ChromeClient()
        setDownloadListener { url, _, contentDisposition, mimetype, _ -> openDownload(url, contentDisposition, mimetype) }
    }

    private fun isOwnOrigin(uri: Uri): Boolean =
        loadedOrigin != null && "${uri.scheme}://${uri.host}:${uri.port}" == loadedOrigin

    // Only schemes other apps are meant to handle; file:// would even throw
    // (FileUriExposedException).
    private fun openExternally(uri: Uri) {
        val opened = uri.scheme?.lowercase() in EXTERNAL_SCHEMES && try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
            true
        } catch (e: RuntimeException) {
            false
        }
        if (!opened) Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
    }

    // The WebView can't show what the page links to as a file (a PDF's
    // "Open"), and another app couldn't fetch it (no engine cookie): fetch it
    // here and hand it over through the FileProvider.
    private fun openDownload(url: String, contentDisposition: String?, mimetype: String?) {
        if (!isOwnOrigin(Uri.parse(url))) return
        downloadThread.execute {
            val download = try {
                EngineDownloads.fetch(this, url, contentDisposition, mimetype)
            } catch (e: Exception) {
                null
            }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                if (download == null) {
                    Toast.makeText(this, R.string.open_file_failed, Toast.LENGTH_SHORT).show()
                    return@runOnUiThread
                }
                val uri = FileProvider.getUriForFile(this, "$packageName.files", download.file)
                val view = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, download.type)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try {
                    startActivity(view)
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(this, R.string.no_app_for_file, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private inner class PageClient : WebViewClient() {
        // The app's own pages stay; links to anywhere else open in the browser
        // (or whichever app handles them).
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (!request.isForMainFrame || isOwnOrigin(url) || url.scheme == "blob" || url.scheme == "about") return false
            openExternally(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // The old page's reply proxy is dead; shares wait for the new hello.
            replyProxy = null
        }

        override fun onPageCommitVisible(view: WebView, url: String?) = pageShown()

        override fun onPageFinished(view: WebView, url: String?) = pageShown()

        // A crashed or killed renderer would otherwise take the app down:
        // drop this WebView and load the page in a fresh one.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view !== webView) return true
            restoreUrl = view.url
            webContainer.removeView(view)
            view.destroy()
            webView = null
            loadedOrigin = null
            bridgeOrigin = null
            replyProxy = null
            fileCallback?.onReceiveValue(null)
            fileCallback = null
            mediaRequest = null
            showScreen(Screen.Loading)
            ensureEngine()
            return true
        }
    }

    private fun pageShown() {
        pageVisible = true
        if (screen == Screen.Loading) showScreen(Screen.Web)
    }

    private inner class ChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val intent = params.createIntent().apply {
                // createIntent only uses the first accept type and ignores
                // `multiple`.
                val types = mimeTypes(params.acceptTypes)
                when (types.size) {
                    0 -> type = "*/*"
                    1 -> type = types[0]
                    else -> {
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                    }
                }
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            try {
                fileChooser.launch(intent)
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                callback.onReceiveValue(null)
            }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            if (!isOwnOrigin(request.origin)) {
                request.deny()
                return
            }
            val wanted = request.resources.mapNotNull { resource ->
                when (resource) {
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> resource to Manifest.permission.RECORD_AUDIO
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> resource to Manifest.permission.CAMERA
                    else -> null
                }
            }.toMap()
            if (wanted.isEmpty()) {
                request.deny()
                return
            }
            val missing = wanted.values.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }.distinct()
            if (missing.isEmpty()) {
                request.grant(wanted.keys.toTypedArray())
                return
            }
            mediaRequest?.deny()
            mediaRequest = request
            mediaResources = wanted
            mediaPermissions.launch(missing.toTypedArray())
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (request === mediaRequest) mediaRequest = null
        }
    }

    // accept="image/*,.pdf" → MIME types for the picker; extensions the
    // phone doesn't know are dropped.
    private fun mimeTypes(accept: Array<String>?): List<String> =
        accept.orEmpty()
            .flatMap { it.split(',') }
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .mapNotNull { if (it.startsWith('.')) MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.substring(1)) else it }
            .distinct()

    // The platform's parseResult only knows a single file; multiple picks
    // come as ClipData.
    private fun deliverFiles(result: ActivityResult) {
        val callback = fileCallback ?: return
        fileCallback = null
        val clip = result.data?.clipData
        val uris: Array<Uri>? = if (result.resultCode == RESULT_OK && clip != null && clip.itemCount > 0) {
            (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }.toTypedArray()
        } else {
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        }
        callback.onReceiveValue(uris)
    }

    private fun onMediaPermissions() {
        val request = mediaRequest ?: return
        mediaRequest = null
        val granted = mediaResources.filterValues { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }.keys
        if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
    }

    // ---- Bridge (NexoteAndroid) ----

    // Without WEB_MESSAGE_LISTENER (very old WebView) the app still works,
    // only sharing into Nexote and changing the folder from the page don't.
    private fun attachBridge(view: WebView, origin: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || bridgeOrigin == origin) return
        if (bridgeOrigin != null) WebViewCompat.removeWebMessageListener(view, BRIDGE_NAME)
        WebViewCompat.addWebMessageListener(view, BRIDGE_NAME, setOf(origin)) { _, message, _, isMainFrame, proxy ->
            if (isMainFrame) onBridgeMessage(message.data, proxy)
        }
        bridgeOrigin = origin
    }

    // Called on the main thread.
    private fun onBridgeMessage(data: String?, proxy: JavaScriptReplyProxy) {
        val message = data?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        when (message.optString("type")) {
            "hello" -> {
                replyProxy = proxy
                val info = JSONObject()
                    .put("type", "info")
                    .put("folder", prefs.folder.orEmpty())
                    .put("version", BuildConfig.VERSION_NAME)
                proxy.postMessage(info.toString())
                flushShares()
            }
            "chooseFolder" -> pickFolder(currentFolder())
            "theme" -> applyPageTheme(message)
        }
    }

    // {"type":"theme","dark":true,"color":"#1e1e21"}: the bars and the
    // background follow the page, now and (saved) from the next launch on.
    private fun applyPageTheme(message: JSONObject) {
        val dark = message.opt("dark")
        val color = message.optString("color")
        if (dark !is Boolean || !HEX_COLOR.matches(color)) return
        val theme = PageTheme(dark, Color.parseColor(color))
        if (theme == pageTheme) return
        pageTheme = theme
        prefs.savePageTheme(theme)
        applySystemBars()
        applyBackground()
    }

    private fun flushShares() {
        val proxy = replyProxy ?: return
        while (pendingShares.isNotEmpty()) proxy.postMessage(pendingShares.removeFirst())
    }

    private fun handleShare(intent: Intent?) {
        if (intent == null) return
        // Reopened from Recents: the original share was handled back then.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        // The activity is exported: any app can send extras that don't unparcel.
        val share = runCatching { Share.from(intent) }.getOrNull() ?: return
        shareThread.execute {
            // Nothing a share holds may take the app down (out of memory included).
            val message: String? = try {
                ShareReader.message(contentResolver, share)
            } catch (e: Throwable) {
                null
            }
            if (message == null) return@execute
            runOnUiThread {
                pendingShares.addLast(message)
                flushShares()
            }
        }
    }

    // ---- Back ----

    // Over the page, Back is the page's first: it closes an overlay or moves
    // its pager (window.__nexoteAndroidBack() returns true). Then the
    // WebView's history, then the system's default (leaving the app).
    private fun onBack() {
        val view = webView
        if (screen != Screen.Web || view == null) {
            systemBack()
            return
        }
        if (pendingBack != 0) return
        val token = ++backSequence
        pendingBack = token
        view.evaluateJavascript(PAGE_BACK_SCRIPT) { result -> finishBack(view, token, result == "true") }
        // A busy or hung page must not swallow Back for good.
        root.postDelayed({ finishBack(view, token, false) }, BACK_TIMEOUT_MS)
    }

    private fun finishBack(view: WebView, token: Int, handledByPage: Boolean) {
        if (pendingBack != token) return
        pendingBack = 0
        if (handledByPage || webView !== view || screen != Screen.Web) return
        if (view.canGoBack()) view.goBack() else systemBack()
    }

    private fun systemBack() {
        backCallback.isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        backCallback.isEnabled = true
    }

    private companion object {
        const val ENGINE_COOKIE = "nexote_engine"
        const val BRIDGE_NAME = "NexoteAndroid"
        const val STATE_URL = "url"
        const val STATE_PENDING_FOLDER = "pendingFolder"
        const val STATE_AWAITING_ACCESS = "awaitingAllFilesAccess"
        const val PAGE_BACK_SCRIPT = "window.__nexoteAndroidBack ? window.__nexoteAndroidBack() : false"
        const val BACK_TIMEOUT_MS = 1000L
        val HEX_COLOR = Regex("#[0-9a-fA-F]{6}")
        val EXTERNAL_SCHEMES = setOf("http", "https", "mailto", "tel", "geo")
    }
}
