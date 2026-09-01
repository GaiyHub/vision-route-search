package com.watchdog.agent

import android.app.NotificationManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Build
import android.os.Looper
import android.util.Base64
import android.view.View
import android.webkit.CookieManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import com.watchdog.agent.shell.ShellExecutionResult
import com.watchdog.agent.shell.ShellRuntime

/**
 * Native module that allows JS to start, update, and stop the DeftAgentService foreground
 * notification from agentBridge.ts.
 */
class DeftAgentModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DeftAgentModule"

    companion object {
        @Volatile
        private var reactContextRef: ReactApplicationContext? = null

        /** JS-registered promise resolved when the floating overlay Stop is tapped. */
        @Volatile
        private var stopWaiter: Promise? = null

        /** Fallback counter for stop requests (polled by JS when the waiter is lost). */
        @Volatile
        private var overlayStopRequests = 0

        /** Pushes a native heartbeat event into the JS queue — wakes a frozen JS pump. */
        fun notifyHeartbeat() {
            val ctx = reactContextRef ?: return
            if (!ctx.hasActiveReactInstance()) return
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("agent-heartbeat", null)
        }

        fun notifyCompletionDecision(decision: String) {
            val ctx = reactContextRef ?: return
            if (!ctx.hasActiveReactInstance()) return
            val payload = Arguments.createMap().apply { putString("decision", decision) }
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("completion-decision", payload)
        }

        fun notifyOverlayTextInput(requestId: String, action: String, text: String?) {
            val ctx = reactContextRef ?: return
            if (!ctx.hasActiveReactInstance()) return
            val payload = Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("action", action)
                if (text != null) putString("text", text)
            }
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("overlay-text-input", payload)
        }

        fun notifyRiskDecision(decision: String) {
            val ctx = reactContextRef ?: return
            if (!ctx.hasActiveReactInstance()) return
            val payload = Arguments.createMap().apply { putString("decision", decision) }
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("risk-confirm-decision", payload)
        }

        fun notifyUserActionComplete() {
            val ctx = reactContextRef ?: return
            if (!ctx.hasActiveReactInstance()) return
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("user-action-complete", Arguments.createMap())
        }

        /**
         * Records a floating-overlay stop request. Called from the overlay-stop
         * broadcast (which is reliably delivered), so stopping never depends on
         * the RN device-event channel (unreliable while the app is backgrounded).
         */
        fun requestOverlayStop() {
            overlayStopRequests++
            val waiter = stopWaiter
            stopWaiter = null
            try {
                waiter?.resolve(true)
            } catch (_: Exception) {}
        }
    }

    init {
        reactContextRef = reactContext
    }

    /**
     * Freeze-safe delay: schedules an AlarmManager wakeup that resolves the
     * promise when it fires (the alarm also thaws the process if MIUI froze it).
     *
     * Fast path: a main-looper Handler resolves the promise at the exact delay
     * while the process is awake (the UI thread handles input even when the app
     * is backgrounded behind the overlay), so waits are no longer throttled to
     * MIUI's ~5s alarm granularity. The AlarmManager wakeup remains as a
     * fallback for deep sleep; the WakeupRequest guard prevents double resolve.
     */
    @ReactMethod
    fun waitFor(ms: Double, promise: Promise) {
        val delayMs = ms.toLong()
        val wakeupId = HeartbeatReceiver.scheduleWakeup(reactContext, delayMs, promise)
        Handler(Looper.getMainLooper()).postDelayed({
            HeartbeatReceiver.cancelWakeup(reactContext, wakeupId)
            try {
                promise.resolve(true)
            } catch (_: Exception) {}
        }, delayMs)
    }

    /**
     * Registers a pending promise that resolves when the floating overlay's
     * Stop button is tapped. Uses the same native→JS promise channel as
     * [waitFor], which is delivered reliably even while the app is frozen.
     * JS should re-register after each resolution.
     */
    @ReactMethod
    fun waitForOverlayStop(promise: Promise) {
        stopWaiter = promise
    }

    /** Returns and resets the number of pending overlay stop requests. */
    @ReactMethod
    fun takeOverlayStopRequests(promise: Promise) {
        promise.resolve(overlayStopRequests.also { overlayStopRequests = 0 })
    }

    @ReactMethod
    fun startService(taskDescription: String) {
        val intent = Intent(reactContext, DeftAgentService::class.java).apply {
            action = DeftAgentService.ACTION_START
            putExtra(DeftAgentService.EXTRA_DESCRIPTION, taskDescription)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    @ReactMethod
    fun updateNotification(taskDescription: String, stepCount: Int) {
        val intent = Intent(reactContext, DeftAgentService::class.java).apply {
            action = DeftAgentService.ACTION_UPDATE
            putExtra(DeftAgentService.EXTRA_DESCRIPTION, taskDescription)
            putExtra(DeftAgentService.EXTRA_STEP, stepCount)
        }
        reactContext.startService(intent)
    }

    @ReactMethod
    fun stopService() {
        val intent = Intent(reactContext, DeftAgentService::class.java).apply {
            action = DeftAgentService.ACTION_STOP
        }
        reactContext.startService(intent)
    }

    @ReactMethod
    fun completeTask(result: String, success: Boolean) {
        val intent = Intent(reactContext, DeftAgentService::class.java).apply {
            action = DeftAgentService.ACTION_COMPLETE
            putExtra(DeftAgentService.EXTRA_DESCRIPTION, result)
            putExtra(DeftAgentService.EXTRA_SUCCESS, success)
        }
        reactContext.startService(intent)
    }

    @ReactMethod
    fun showCompletionNotification(result: String) {
        val intent = Intent(reactContext, DeftAgentService::class.java).apply {
            action = DeftAgentService.ACTION_PENDING
            putExtra(DeftAgentService.EXTRA_RESULT, result)
        }
        reactContext.startService(intent)
    }

    @ReactMethod
    fun cancelPendingNotification() {
        reactContext.getSystemService(NotificationManager::class.java)
            .cancel(DeftAgentService.PENDING_NOTIFICATION_ID)
    }

    @ReactMethod
    fun showRiskConfirmNotification(action: String, risk: String) {
        val intent = Intent(reactContext, DeftAgentService::class.java).apply {
            setAction(DeftAgentService.ACTION_RISK_PENDING)
            putExtra(DeftAgentService.EXTRA_RISK_ACTION, action)
            putExtra(DeftAgentService.EXTRA_RISK_LEVEL, risk)
        }
        reactContext.startService(intent)
    }

    @ReactMethod
    fun cancelRiskConfirmNotification() {
        reactContext.getSystemService(NotificationManager::class.java)
            .cancel(DeftAgentService.RISK_NOTIFICATION_ID)
    }

    /** Execute a bounded command in the isolated shell sandbox. */
    @ReactMethod
    fun executeShell(
        command: String,
        timeoutMs: Double,
        privilege: String,
        confirmed: Boolean,
        promise: Promise,
    ) {
        ShellRuntime.executeAsync(
            reactContext,
            command,
            timeoutMs.toLong(),
            privilege,
            confirmed,
        ) { result ->
            try {
                promise.resolve(shellResultMap(result))
            } catch (_: Exception) {
                // Promise may already be invalidated while a long command was running.
            }
        }
    }

    /** Stop the currently running native shell process, if any. */
    @ReactMethod
    fun cancelShell() {
        ShellRuntime.cancelCurrent()
    }

    private fun shellResultMap(result: ShellExecutionResult) = Arguments.createMap().apply {
        putBoolean("ok", result.ok)
        putString("output", result.output)
        putInt("exit_code", result.exitCode)
        putDouble("duration_ms", result.durationMs.toDouble())
        putBoolean("timed_out", result.timedOut)
        putBoolean("truncated", result.truncated)
        putString("privilege", result.privilege)
        result.outputRef?.let { putString("output_ref", it) }
        result.error?.let { putString("error", it) }
        result.code?.let { putString("code", it) }
    }

    @ReactMethod
    fun getBrowserCookies(url: String, promise: Promise) {
        try {
            promise.resolve(CookieManager.getInstance().getCookie(url) ?: "")
        } catch (e: Exception) {
            promise.reject("ERR_BROWSER_COOKIES", e.message, e)
        }
    }

    @ReactMethod
    fun setBrowserCookies(url: String, cookies: ReadableArray, promise: Promise) {
        try {
            val manager = CookieManager.getInstance()
            val formatter = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("GMT")
            }
            var written = 0
            for (i in 0 until cookies.size()) {
                val cookie = cookies.getMap(i) ?: continue
                val name = cookie.getString("name") ?: continue
                val value = cookie.getString("value") ?: continue
                val parts = mutableListOf("$name=$value")
                parts += "Path=" + if (cookie.hasKey("path") && !cookie.isNull("path")) {
                    cookie.getString("path") ?: "/"
                } else "/"
                if (cookie.hasKey("domain") && !cookie.isNull("domain")) {
                    cookie.getString("domain")?.takeIf { it.isNotBlank() }?.let { parts += "Domain=$it" }
                }
                if (cookie.hasKey("secure") && cookie.getBoolean("secure")) parts += "Secure"
                if (cookie.hasKey("http_only") && cookie.getBoolean("http_only")) parts += "HttpOnly"
                if (cookie.hasKey("expires") && !cookie.isNull("expires")) {
                    parts += "Expires=" + formatter.format(Date((cookie.getDouble("expires") * 1000).toLong()))
                }
                manager.setCookie(url, parts.joinToString("; "))
                written++
            }
            manager.flush()
            promise.resolve(written)
        } catch (e: Exception) {
            promise.reject("ERR_BROWSER_COOKIES", e.message, e)
        }
    }

    @ReactMethod
    fun captureBrowserView(reactTag: Double, promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                val root = reactContext.currentActivity?.window?.decorView
                    ?: throw IllegalStateException("No active app window")
                val view = root.findViewById<View>(reactTag.toInt())
                    ?: throw IllegalArgumentException("Browser view not found")
                if (view.width <= 0 || view.height <= 0) {
                    throw IllegalStateException("Browser view has no layout size")
                }
                val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
                view.draw(Canvas(bitmap))
                val bytes = ByteArrayOutputStream().use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                    out.toByteArray()
                }
                bitmap.recycle()
                val dir = File(reactContext.cacheDir, "browser-screenshots").apply { mkdirs() }
                val file = File(dir, "browser-${System.currentTimeMillis()}.png")
                FileOutputStream(file).use { it.write(bytes) }
                promise.resolve(Arguments.createMap().apply {
                    putString("path", file.absolutePath)
                    putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    putString("mimeType", "image/png")
                })
            } catch (e: Exception) {
                promise.reject("ERR_BROWSER_CAPTURE", e.message, e)
            }
        }
    }
}
