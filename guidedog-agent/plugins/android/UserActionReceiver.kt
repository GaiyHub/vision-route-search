package com.watchdog.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Wakes JS and resolves a manual user-action gate completed on the overlay. */
class UserActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "tech.bedda.deft.USER_ACTION_COMPLETE") return
        DeftAgentModule.notifyUserActionComplete()
        DeftAgentModule.notifyHeartbeat()
    }
}
