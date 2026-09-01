package com.watchdog.agent

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Routes risk confirmation notification actions into JS. */
class RiskConfirmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val decision = when (intent.action) {
            DeftAgentService.ACTION_RISK_EXECUTE -> "execute"
            DeftAgentService.ACTION_RISK_REJECT -> "reject"
            else -> return
        }
        context.getSystemService(NotificationManager::class.java)
            .cancel(DeftAgentService.RISK_NOTIFICATION_ID)
        DeftAgentModule.notifyRiskDecision(decision)
        DeftAgentModule.notifyHeartbeat()
    }
}
