package com.watchdog.agent

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Promise
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Keep-alive heartbeat + freeze-safe wakeup receiver for the agent task.
 *
 * MIUI/HyperOS freezes the process of an app the moment it is fully covered by
 * another app (the freeze is not recorded by Greezer, but every thread goes to
 * sleep and JS timers stop firing). Network packets, broadcasts, and alarms
 * thaw the process. The agent loop gets stuck while waiting on local timers
 * (setTimeout-based delays) because those timers can never fire in a frozen
 * process — MobileAgent avoids this because its loop is paced by continuous
 * network traffic to the VLM.
 *
 * This receiver serves two roles:
 *
 * 1. [ACTION_HEARTBEAT] — a self-rescheduling alarm chain: each broadcast
 *    delivery thaws the process for a moment and pushes a device event into
 *    the JS queue, giving the JS side a freeze-safe clock signal.
 * 2. [ACTION_WAKEUP] — one-shot alarms registered by `DeftAgentModule.waitFor`:
 *    when the alarm fires, the pending promise is resolved. The promise
 *    resolution is a native message into the JS queue, which wakes the JS
 *    thread's epoll — so an awaited JS delay completes even though JS timers
 *    are dead while frozen. This is the "native wait primitive" the agent
 *    loop's delayFn uses to survive freezing.
 */
class HeartbeatReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_HEARTBEAT = "tech.bedda.deft.HEARTBEAT"
        const val ACTION_WAKEUP = "tech.bedda.deft.WAKEUP"
        const val HEARTBEAT_INTERVAL_MS = 3_000L
        private const val REQUEST_CODE = 4242
        private const val WAKEUP_REQUEST_CODE_BASE = 5000
        private const val EXTRA_REQUEST_ID = "extra_wakeup_id"

        /** A promise guarded against double resolution (race loss, cancel). */
        private class WakeupRequest(val promise: Promise) {
            @Volatile
            private var done = false

            fun finish(value: Any?) {
                if (done) return
                done = true
                promise.resolve(value)
            }
        }

        private val wakeupRequests = ConcurrentHashMap<Int, WakeupRequest>()
        private val nextWakeupId = AtomicInteger(0)

        fun pendingIntent(context: Context): PendingIntent {
            val intent = Intent(context, HeartbeatReceiver::class.java).apply {
                action = ACTION_HEARTBEAT
            }
            return PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        /** Schedules the next heartbeat (also used to start the chain). */
        fun scheduleNext(context: Context) {
            val alarmManager = context.getSystemService(AlarmManager::class.java)
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + HEARTBEAT_INTERVAL_MS,
                pendingIntent(context)
            )
        }

        /** Cancels the heartbeat chain. */
        fun cancel(context: Context) {
            val alarmManager = context.getSystemService(AlarmManager::class.java)
            alarmManager.cancel(pendingIntent(context))
        }

        /**
         * Registers a one-shot wakeup: [promise] resolves when the alarm fires,
         * which also thaws the process if MIUI froze it. Used by the JS side's
         * freeze-safe delay primitive.
         */
        fun scheduleWakeup(context: Context, delayMs: Long, promise: Promise): Int {
            val requestId = nextWakeupId.incrementAndGet()
            wakeupRequests[requestId] = WakeupRequest(promise)
            val intent = Intent(context, HeartbeatReceiver::class.java).apply {
                action = ACTION_WAKEUP
                putExtra(EXTRA_REQUEST_ID, requestId)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                WAKEUP_REQUEST_CODE_BASE + requestId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val alarmManager = context.getSystemService(AlarmManager::class.java)
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + delayMs,
                pendingIntent
            )
            Log.d("HeartbeatReceiver", "wakeup scheduled id=$requestId delayMs=$delayMs")
            return requestId
        }

        /** Cancels a pending one-shot wakeup (e.g. after the fast path fired). */
        fun cancelWakeup(context: Context, requestId: Int) {
            wakeupRequests.remove(requestId)
            val intent = Intent(context, HeartbeatReceiver::class.java).apply {
                action = ACTION_WAKEUP
                putExtra(EXTRA_REQUEST_ID, requestId)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                WAKEUP_REQUEST_CODE_BASE + requestId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val alarmManager = context.getSystemService(AlarmManager::class.java)
            alarmManager.cancel(pendingIntent)
        }

        /** Resolves (as false) every pending wakeup — used when a task stops. */
        fun cancelAllWakeups() {
            wakeupRequests.values.forEach { it.finish(false) }
            wakeupRequests.clear()
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_WAKEUP -> {
                val requestId = intent.getIntExtra(EXTRA_REQUEST_ID, -1)
                val request = wakeupRequests.remove(requestId)
                if (request != null) {
                    Log.d("HeartbeatReceiver", "wakeup fired id=$requestId")
                    request.finish(true)
                }
            }
            "tech.bedda.deft.OVERLAY_STOP" -> {
                // Floating overlay Stop button tapped. The primary channel is
                // the onOverlayStop JS event emitted by AccessibilityControllerModule;
                // this broadcast exists to thaw a frozen process so that queued
                // event gets processed. Push a native event into the JS queue
                // to wake the JS thread's epoll (a thaw alone may not do it).
                Log.d("HeartbeatReceiver", "overlay stop requested")
                // Reliable stop path: resolve the JS stop waiter via the native
                // promise channel (same mechanism as waitFor, delivered even
                // while frozen), and record a fallback count for JS polling.
                DeftAgentModule.requestOverlayStop()
                DeftAgentModule.notifyHeartbeat()
            }
            else -> {
                // The broadcast delivery itself thaws a frozen process. The
                // alarm also wakes the process, but JS timers stay dead while
                // the app is fully covered (the JS thread's message pump never
                // gets scheduled again). Push a native event into the JS
                // queue: a native message wakes the JS thread's epoll, which a
                // thaw alone may not do. If JS receives this, the agent loop
                // can be paced by these events instead of setTimeout.
                Log.d("HeartbeatReceiver", "tick ts=" + System.currentTimeMillis())
                DeftAgentModule.notifyHeartbeat()
                scheduleNext(context)
            }
        }
    }
}
