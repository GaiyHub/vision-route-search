package com.watchdog.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class EvaluationIntentGatewayTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun `ordinary launcher can never enter evaluation route`() {
        val store = EvaluationRequestStore(temporary.newFolder("evaluation"))
        val result = EvaluationIntentGateway.route(
            "com.watchdog.agent.MainActivity",
            EvaluationIntentGateway.ACTION_EVALUATE,
            "payload",
            null,
            store,
        )
        assertEquals(EvaluationIntentResult.Ignored, result)
        assertEquals(null, store.consumePending())
    }

    @Test fun `protected alias rejects missing payload without notifying RN`() {
        val store = EvaluationRequestStore(temporary.newFolder("evaluation"))
        var notifications = 0
        val result = EvaluationIntentGateway.route(
            EvaluationIntentGateway.ENTRY_COMPONENT,
            EvaluationIntentGateway.ACTION_EVALUATE,
            null,
            null,
            store,
            onRequestAvailable = { notifications++ },
        ) as EvaluationIntentResult.Evaluated
        assertEquals("INVALID_REQUEST", (result.registration as EvaluationRegistration.Rejected).code)
        assertEquals(0, notifications)
    }

    @Test fun `cancel only targets active request and is consumable once`() {
        val store = EvaluationRequestStore(temporary.newFolder("evaluation"))
        assertEquals(
            EvaluationIntentResult.Cancelled(false, "req-missing"),
            EvaluationIntentGateway.route(EvaluationIntentGateway.ENTRY_COMPONENT, EvaluationIntentGateway.ACTION_CANCEL, null, "req-missing", store),
        )
        assertTrue(store.consumePendingCancellation() == null)
    }
}
