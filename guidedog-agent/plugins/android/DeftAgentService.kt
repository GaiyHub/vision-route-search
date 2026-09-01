package com.watchdog.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps the JS thread alive when the user backgrounds Deft
 * while an agent task is running. The notification is updated as the agent steps forward.
 *
 * On task completion, the ongoing notification is replaced by a dismissable result
 * notification so the user knows what happened without reopening the app.
 */
class DeftAgentService : Service() {

    companion object {
        const val ACTION_START    = "tech.bedda.deft.START_AGENT"
        const val ACTION_STOP     = "tech.bedda.deft.STOP_AGENT"
        const val ACTION_UPDATE   = "tech.bedda.deft.UPDATE_AGENT"
        const val ACTION_COMPLETE = "tech.bedda.deft.COMPLETE_AGENT"
        const val ACTION_PENDING  = "tech.bedda.deft.PENDING_AGENT"
        const val ACTION_CONFIRM_COMPLETE = "tech.bedda.deft.CONFIRM_COMPLETE"
        const val ACTION_REJECT_COMPLETE  = "tech.bedda.deft.REJECT_COMPLETE"
        const val ACTION_SUPPLEMENT_COMPLETE = "tech.bedda.deft.SUPPLEMENT_COMPLETE"
        const val ACTION_RISK_PENDING  = "tech.bedda.deft.RISK_PENDING_AGENT"
        const val ACTION_RISK_EXECUTE  = "tech.bedda.deft.RISK_EXECUTE"
        const val ACTION_RISK_REJECT   = "tech.bedda.deft.RISK_REJECT"
        const val EXTRA_DESCRIPTION = "taskDescription"
        const val EXTRA_STEP        = "stepCount"
        const val EXTRA_SUCCESS     = "taskSuccess"
        const val EXTRA_RESULT      = "completionResult"
        const val EXTRA_RISK_ACTION = "riskAction"
        const val EXTRA_RISK_LEVEL  = "riskLevel"
        const val NOTIFICATION_ID        = 42
        const val RESULT_NOTIFICATION_ID = 43
        const val PENDING_NOTIFICATION_ID = 44
        const val RISK_NOTIFICATION_ID = 45
        const val CHANNEL_ID        = "deft_agent_channel"
        const val CHANNEL_ID_RESULT = "deft_result_channel"
        const val CHANNEL_ID_PENDING = "deft_pending_channel"
        const val CHANNEL_ID_RISK = "deft_risk_channel"
        const val COMPLETION_CONFIRM_TIMEOUT_MS = 60_000L
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val description = intent.getStringExtra(EXTRA_DESCRIPTION) ?: ""
                createNotificationChannel()
                val notification = buildRunningNotification(description, 0)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            }
            ACTION_UPDATE -> {
                val description = intent.getStringExtra(EXTRA_DESCRIPTION) ?: ""
                val step = intent.getIntExtra(EXTRA_STEP, 0)
                val manager = getSystemService(NotificationManager::class.java)
                manager.notify(NOTIFICATION_ID, buildRunningNotification(description, step))
            }
            ACTION_COMPLETE -> {
                val description = intent.getStringExtra(EXTRA_DESCRIPTION) ?: ""
                val success = intent.getBooleanExtra(EXTRA_SUCCESS, true)
                // Stop the ongoing foreground notification first.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                // Show a dismissable result notification.
                createResultNotificationChannel()
                val manager = getSystemService(NotificationManager::class.java)
                manager.notify(RESULT_NOTIFICATION_ID, buildResultNotification(description, success))
                stopSelf()
            }
            ACTION_PENDING -> {
                val result = intent.getStringExtra(EXTRA_RESULT) ?: ""
                createPendingChannel()
                getSystemService(NotificationManager::class.java)
                    .notify(PENDING_NOTIFICATION_ID, buildPendingConfirmationNotification(result))
            }
            ACTION_RISK_PENDING -> {
                val action = intent.getStringExtra(EXTRA_RISK_ACTION) ?: ""
                val risk = intent.getStringExtra(EXTRA_RISK_LEVEL) ?: "high"
                createRiskChannel()
                getSystemService(NotificationManager::class.java)
                    .notify(RISK_NOTIFICATION_ID, buildRiskConfirmationNotification(action, risk))
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

    private fun createResultNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID_RESULT,
                "Deft Task Results",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notifies when a background agent task finishes"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun createPendingChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID_PENDING,
                "任务完成确认",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Agent 判定任务完成时请求用户确认"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun createRiskChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID_RISK,
                "高风险操作确认",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Agent 执行高风险操作前请求用户确认"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildRunningNotification(taskDescription: String, stepCount: Int): Notification {
        val shortDesc = if (taskDescription.length > 60) "${taskDescription.take(60)}…" else taskDescription
        val subtitle = if (stepCount > 0) "Step $stepCount — $shortDesc" else shortDesc

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val builder = Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("豆泡正在运行")
                .setContentText(subtitle)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
            // FOREGROUND_SERVICE_IMMEDIATE was added in API 31 (Android 12 / S).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            }
            builder.build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("豆泡正在运行")
                .setContentText(subtitle)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        }
    }

    /** Binary fallback for the primary three-choice completion dialog. */
    private fun buildPendingConfirmationNotification(result: String): Notification {
        val shortResult = if (result.length > 120) "${result.take(120)}…" else result
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = PendingIntent.getActivity(
            this, 2, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val confirmIntent = PendingIntent.getBroadcast(
            this, 3,
            Intent(this, CompletionReceiver::class.java).apply { action = ACTION_CONFIRM_COMPLETE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val rejectIntent = PendingIntent.getBroadcast(
            this, 4,
            Intent(this, CompletionReceiver::class.java).apply { action = ACTION_REJECT_COMPLETE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID_PENDING)
                .setContentTitle("任务完成确认")
                .setContentText("豆泡认为任务已完成，请确认")
                .setStyle(Notification.BigTextStyle().bigText("豆泡认为任务已完成：\n$shortResult"))
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentIntent(contentIntent)
                .addAction(android.R.drawable.ic_menu_save, "完成", confirmIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "继续", rejectIntent)
                .setAutoCancel(true)
                .setTimeoutAfter(COMPLETION_CONFIRM_TIMEOUT_MS)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("任务完成确认")
                .setContentText("豆泡认为任务已完成，请确认")
                .setStyle(Notification.BigTextStyle().bigText("豆泡认为任务已完成：\n$shortResult"))
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentIntent(contentIntent)
                .addAction(android.R.drawable.ic_menu_save, "完成", confirmIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "继续", rejectIntent)
                .setAutoCancel(true)
                .build()
        }
    }

    private fun buildRiskConfirmationNotification(action: String, risk: String): Notification {
        val shortAction = if (action.length > 120) "${action.take(120)}…" else action
        val riskText = when (risk) {
            "high" -> "高风险"
            "medium" -> "中风险"
            else -> "低风险"
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = PendingIntent.getActivity(
            this, 5, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val executeIntent = PendingIntent.getBroadcast(
            this, 6,
            Intent(this, RiskConfirmReceiver::class.java).apply { setAction(ACTION_RISK_EXECUTE) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val rejectIntent = PendingIntent.getBroadcast(
            this, 7,
            Intent(this, RiskConfirmReceiver::class.java).apply { setAction(ACTION_RISK_REJECT) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID_RISK)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("需要你的确认（$riskText）")
            .setContentText(shortAction)
            .setStyle(Notification.BigTextStyle().bigText("豆泡即将执行（$riskText）：\n$shortAction"))
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentIntent(contentIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "拒绝", rejectIntent)
            .addAction(android.R.drawable.ic_menu_save, "执行", executeIntent)
            .setAutoCancel(true)
            .build()
    }

    private fun buildResultNotification(result: String, success: Boolean): Notification {
        val shortResult = if (result.length > 80) "${result.take(80)}…" else result
        val title = if (success) "完成" else "Task failed"
        val icon = if (success) android.R.drawable.ic_dialog_info else android.R.drawable.ic_dialog_alert

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 1, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID_RESULT)
                .setContentTitle(title)
                .setContentText(shortResult)
                .setSmallIcon(icon)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle(title)
                .setContentText(shortResult)
                .setSmallIcon(icon)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build()
        }
    }
}
