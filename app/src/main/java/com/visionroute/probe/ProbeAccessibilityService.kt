package com.visionroute.probe

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import com.visionroute.probe.data.EventLogEntry
import com.visionroute.probe.service.RecorderSession
import java.io.IOException
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/**
 * 无障碍事件采集服务。通过静态 [instance] 与悬浮窗通信。
 * 只在 [RecorderSession.isCapturing] 为 true 时记录事件与截图。
 */
class ProbeAccessibilityService : AccessibilityService() {

    private val screenshotExecutor = Executors.newSingleThreadExecutor()

    override fun onServiceConnected() {
        super.onServiceConnected()
        instanceRef = WeakReference(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || !RecorderSession.isCapturing) return
        val entry = EventLogEntry.from(event)
        val seq = RecorderSession.appendEvent(entry)
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && seq > 0) {
            captureScreenshot(event.displayId, seq)
        }
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        if (RecorderSession.isCapturing) RecorderSession.stop()
        if (instanceRef?.get() === this) instanceRef = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (RecorderSession.isCapturing) RecorderSession.stop()
        if (instanceRef?.get() === this) instanceRef = null
        screenshotExecutor.shutdown()
        super.onDestroy()
    }

    private fun captureScreenshot(displayId: Int, eventSeq: Int) {
        try {
            takeScreenshot(
                displayId,
                screenshotExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(screenshot: ScreenshotResult) {
                        val buffer = screenshot.hardwareBuffer
                        val bitmap = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
                        if (bitmap == null) {
                            buffer.close()
                            return
                        }
                        val file = RecorderSession.screenshotFileFor(eventSeq, System.currentTimeMillis())
                        if (file != null) {
                            file.parentFile?.mkdirs()
                            try {
                                file.outputStream().use { out ->
                                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                                }
                                RecorderSession.recordScreenshot(eventSeq, file.name)
                            } catch (_: IOException) {
                                RecorderSession.recordScreenshotFailure(eventSeq, -1)
                            }
                        }
                        bitmap.recycle()
                        buffer.close()
                    }

                    override fun onFailure(errorCode: Int) {
                        RecorderSession.recordScreenshotFailure(eventSeq, errorCode)
                    }
                }
            )
        } catch (_: Exception) {
            RecorderSession.recordScreenshotFailure(eventSeq, -2)
        }
    }

    companion object {
        private var instanceRef: WeakReference<ProbeAccessibilityService>? = null

        val instance: ProbeAccessibilityService?
            get() = instanceRef?.get()

        /** 检测本服务是否已在系统无障碍设置中启用。 */
        fun isEnabled(context: Context): Boolean {
            val manager = context.getSystemService(AccessibilityManager::class.java)
                ?: return false
            val expected = ComponentName(context, ProbeAccessibilityService::class.java)
            return manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                .any { info ->
                    val serviceInfo = info.resolveInfo?.serviceInfo ?: return@any false
                    serviceInfo.packageName == expected.packageName &&
                        serviceInfo.name == expected.className
                }
        }
    }
}
