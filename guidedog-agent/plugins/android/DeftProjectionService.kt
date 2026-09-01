package com.watchdog.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.beddatech.accessibilitycontroller.MediaProjectionBridge

/**
 * MediaProjection foreground service — the MobileAgent pattern.
 *
 * After the system projection dialog resolves, the accessibility controller
 * module hands the grant to this service via [ACTION_START]; the service then
 * starts with foregroundServiceType="mediaProjection" and calls
 * getMediaProjection() in service context. MIUI/HyperOS rejects projection
 * tokens created inside the Activity's onActivityResult callback stack
 * ("SecurityException: Failed to create MediaProjection").
 *
 * The service (and the projection session) stays alive for the whole task:
 * an active projection session anchors the process against OEM background
 * freezing while the app runs behind the floating window. It is stopped by
 * [ACTION_STOP] when the task finishes.
 */
class DeftProjectionService : Service() {

    companion object {
        /** Mirrors AccessibilityControllerModule's hand-off contract. */
        const val ACTION_START = "tech.bedda.deft.action.PROCESS_PROJECTION"
        const val ACTION_STOP  = "tech.bedda.deft.STOP_PROJECTION"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val NOTIFICATION_ID   = 42
        const val CHANNEL_ID        = "deft_agent_channel"
        private const val TAG = "DeftProjectionService"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                Log.d(TAG, "ACTION_START received")
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                @Suppress("DEPRECATION")
                val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }
                if (resultData == null) {
                    Log.e(TAG, "No MediaProjection result data")
                    MediaProjectionBridge.deliver(null)
                    stopSelf()
                    return START_NOT_STICKY
                }
                try {
                    createNotificationChannel()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startForeground(
                            NOTIFICATION_ID,
                            buildNotification(),
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, buildNotification())
                    }
                    val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                    val projection = mgr.getMediaProjection(resultCode, resultData)
                    Log.d(TAG, "getMediaProjection OK: $projection")
                    // Stay running for the whole task — the active projection
                    // session anchors the process against OEM freezing.
                    MediaProjectionBridge.deliver(projection)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to create MediaProjection: ${e.message}", e)
                    MediaProjectionBridge.deliver(null)
                    stopSelf()
                }
                return START_NOT_STICKY
            }
            ACTION_STOP -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Deft Agent",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows while the Deft agent is running a task"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val builder = Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("豆泡正在运行")
                .setContentText("正在录制屏幕以执行任务")
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            }
            builder.build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("豆泡正在运行")
                .setContentText("正在录制屏幕以执行任务")
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        }
    }
}
