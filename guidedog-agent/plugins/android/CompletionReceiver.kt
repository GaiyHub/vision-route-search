package com.watchdog.agent

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Routes completion decisions from the floating overlay (and legacy notification) into JS. */
class CompletionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val decision = when (intent.action) {
            DeftAgentService.ACTION_CONFIRM_COMPLETE -> "complete"
            DeftAgentService.ACTION_REJECT_COMPLETE -> "reject"
            DeftAgentService.ACTION_SUPPLEMENT_COMPLETE -> "supplement"
            else -> return
        }
        context.getSystemService(NotificationManager::class.java)
            .cancel(DeftAgentService.PENDING_NOTIFICATION_ID)
        DeftAgentModule.notifyCompletionDecision(decision)
        DeftAgentModule.notifyHeartbeat()
    }
}
