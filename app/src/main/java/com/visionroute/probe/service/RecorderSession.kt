package com.visionroute.probe.service

import android.content.Context
import com.visionroute.probe.data.EventLogEntry
import com.visionroute.probe.data.ProbeStorage
import com.visionroute.probe.data.RecordingSummary
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.IOException

/**
 * 全局录制会话。AccessibilityService 与悬浮窗通过它协调开始/停止/追加。
 * 所有操作在主线程串行执行，额外的同步仅用于截图回调线程的安全。
 */
object RecorderSession {

    private val lock = Any()
    private var appContext: Context? = null
    private var writer: BufferedWriter? = null
    private var screenshotsDir: File? = null

    var scenarioId: String? = null
        private set
    var recordingId: String? = null
        private set
    var isCapturing: Boolean = false
        private set
    var startedAt: Long = 0L
        private set
    var eventCount: Int = 0
        private set

    fun start(context: Context, scenarioId: String): Boolean = synchronized(lock) {
        if (isCapturing) return true
        val (_, recordingId) = ProbeStorage.createRecording(context, scenarioId)
        this.appContext = context.applicationContext
        this.scenarioId = scenarioId
        this.recordingId = recordingId
        this.startedAt = System.currentTimeMillis()
        this.eventCount = 0
        this.writer = ProbeStorage.openEventWriter(context, scenarioId, recordingId)
        this.screenshotsDir = ProbeStorage.screenshotsDir(context, scenarioId, recordingId).apply { mkdirs() }
        this.isCapturing = true
        true
    }

    /** 追加一条事件，返回该事件的序号；写入失败返回 0。 */
    fun appendEvent(entry: EventLogEntry): Int = synchronized(lock) {
        val w = writer ?: return 0
        val seq = eventCount + 1
        try {
            w.write(entry.toJson(seq).toString())
            w.newLine()
            w.flush()
            eventCount = seq
            seq
        } catch (_: IOException) {
            0
        }
    }

    /** 为指定事件序号生成截图文件路径（截图回调线程中调用）。 */
    fun screenshotFileFor(eventSeq: Int, timestamp: Long): File? = synchronized(lock) {
        if (!isCapturing) return null
        screenshotsDir?.let { File(it, "%03d_%d.png".format(eventSeq, timestamp)) }
    }

    /** 截图保存成功后记录事件序号 <-> 文件名关联。 */
    fun recordScreenshot(eventSeq: Int, fileName: String) {
        synchronized(lock) {
            if (!isCapturing) return
            val ctx = appContext ?: return
            val sid = scenarioId ?: return
            val rid = recordingId ?: return
            ProbeStorage.appendScreenshotIndex(ctx, sid, rid, eventSeq, fileName)
        }
    }

    /** 截图失败时写入事件日志（不中断录制）。 */
    fun recordScreenshotFailure(refSeq: Int, errorCode: Int) {
        synchronized(lock) {
            val w = writer ?: return
            try {
                val json = JSONObject().apply {
                    put("kind", "screenshot_error")
                    put("eventTime", System.currentTimeMillis())
                    put("ref_seq", refSeq)
                    put("error_code", errorCode)
                }
                w.write(json.toString())
                w.newLine()
                w.flush()
            } catch (_: IOException) {
            }
        }
    }

    /** 停止录制并返回摘要；未在录制时返回 null。 */
    fun stop(): RecordingSummary? = synchronized(lock) {
        if (!isCapturing) return null
        val ctx = appContext ?: return null
        val sid = scenarioId ?: return null
        val rid = recordingId ?: return null
        val start = startedAt
        val count = eventCount
        try {
            writer?.close()
        } catch (_: IOException) {
        }
        val shotCount = screenshotsDir?.listFiles()?.filter { it.isFile }?.size ?: 0
        ProbeStorage.finishRecording(ctx, sid, rid, start, count, shotCount)
        writer = null
        screenshotsDir = null
        appContext = null
        scenarioId = null
        recordingId = null
        startedAt = 0L
        eventCount = 0
        isCapturing = false
        RecordingSummary(sid, rid, start, System.currentTimeMillis(), count, shotCount)
    }
}
