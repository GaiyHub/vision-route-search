package com.watchdog.agent

sealed class EvaluationIntentResult {
    data object Ignored : EvaluationIntentResult()
    data class Evaluated(val registration: EvaluationRegistration) : EvaluationIntentResult()
    data class Cancelled(val accepted: Boolean, val requestId: String?) : EvaluationIntentResult()
}

object EvaluationIntentGateway {
    const val ENTRY_COMPONENT = "com.watchdog.agent.EvaluationEntryActivity"
    const val ACTION_EVALUATE = "com.watchdog.agent.action.EVALUATE"
    const val ACTION_CANCEL = "com.watchdog.agent.action.CANCEL_EVALUATION"

    fun route(
        componentClassName: String?,
        action: String?,
        payload: String?,
        requestId: String?,
        store: EvaluationRequestStore,
        onRequestAvailable: () -> Unit = {},
        onCancellationAvailable: (String) -> Unit = {},
    ): EvaluationIntentResult {
        if (componentClassName != ENTRY_COMPONENT) return EvaluationIntentResult.Ignored
        return when (action) {
            ACTION_EVALUATE -> {
                val registration = if (payload == null) {
                    EvaluationRegistration.Rejected("INVALID_REQUEST", "缺少 payload")
                } else store.registerPayload(payload)
                if (registration is EvaluationRegistration.Accepted && !registration.duplicate) onRequestAvailable()
                EvaluationIntentResult.Evaluated(registration)
            }
            ACTION_CANCEL -> {
                val accepted = requestId != null && store.requestCancellation(requestId)
                if (accepted) onCancellationAvailable(requestId!!)
                EvaluationIntentResult.Cancelled(accepted, requestId)
            }
            else -> EvaluationIntentResult.Ignored
        }
    }
}
