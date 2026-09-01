package com.watchdog.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Freeze-safe bridge for text submitted from the focusable overlay editor. */
class OverlayTextInputReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_OVERLAY_TEXT_INPUT) return
        val requestId = intent.getStringExtra("requestId") ?: return
        val action = intent.getStringExtra("action") ?: return
        val text = intent.getStringExtra("text")
        DeftAgentModule.notifyOverlayTextInput(requestId, action, text)
        DeftAgentModule.notifyHeartbeat()
    }

    companion object {
        const val ACTION_OVERLAY_TEXT_INPUT = "tech.bedda.deft.OVERLAY_TEXT_INPUT"
    }
}
