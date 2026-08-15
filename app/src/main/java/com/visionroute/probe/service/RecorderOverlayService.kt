package com.visionroute.probe.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.visionroute.probe.MainActivity
import com.visionroute.probe.R
import com.visionroute.probe.ui.FloatingRecorderView

/**
 * 前台服务：负责悬浮录制窗的展示与生命周期。
 * 点击悬浮窗"开始/停止"真正控制 AccessibilityService 的采集。
 */
class RecorderOverlayService : Service() {

    private var overlay: FloatingRecorderView? = null
    private var scenarioId: String? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification(recording = false))
        when (intent?.action) {
            ACTION_START -> {
                val sid = intent.getStringExtra(EXTRA_SCENARIO_ID)
                if (sid == null) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                scenarioId = sid
                showOverlay(sid)
            }
            ACTION_STOP -> stopRecorder()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        overlay?.hide()
        overlay = null
        if (RecorderSession.isCapturing) {
            RecorderSession.stop()
        }
        super.onDestroy()
    }

    private fun showOverlay(sid: String) {
        if (overlay != null) return
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return
        }
        overlay = FloatingRecorderView(
            context = this,
            scenarioId = sid,
            onCaptureChanged = { recording ->
                NotificationManagerCompat.from(this).notify(
                    NOTIFICATION_ID,
                    buildNotification(recording)
                )
            },
            onStopped = { stopRecorder() }
        ).also { it.show() }
    }

    private fun stopRecorder() {
        if (RecorderSession.isCapturing) {
            RecorderSession.stop()
        }
        overlay?.hide()
        overlay = null
        scenarioId?.let { sid ->
            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(MainActivity.EXTRA_OPEN_SCENARIO, sid)
            }
            startActivity(intent)
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.recording_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.recording_channel_desc)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(recording: Boolean): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val text = if (recording) {
            getString(R.string.recording_notification_text)
        } else {
            getString(R.string.waiting_capture)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_record)
            .setContentTitle(getString(R.string.recording_notification_title))
            .setContentText(text)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "recording_overlay"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_START = "com.visionroute.probe.action.START"
        private const val ACTION_STOP = "com.visionroute.probe.action.STOP"
        private const val EXTRA_SCENARIO_ID = "scenario_id"

        fun start(context: Context, scenarioId: String) {
            val intent = Intent(context, RecorderOverlayService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_SCENARIO_ID, scenarioId)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, RecorderOverlayService::class.java).setAction(ACTION_STOP)
            )
        }
    }
}
