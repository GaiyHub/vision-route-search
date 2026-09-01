package com.watchdog.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.security.MessageDigest
import java.util.Base64

class EvaluationRequestStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    private fun request(id: String = "req-1", instruction: String = "现在几点？"): EvaluationRequestRecord {
        val base = "{\"schemaVersion\":1,\"requestId\":\"$id\",\"runId\":\"run-1\",\"sampleId\":\"sample-1\",\"instruction\":${org.json.JSONObject.quote(instruction)},\"timeoutMs\":180000,\"conversationMode\":\"ISOLATED\"}"
        val hash = MessageDigest.getInstance("SHA-256").digest(base.toByteArray()).joinToString("") { "%02x".format(it) }
        return EvaluationRequestRecord(1, id, hash, "run-1", "sample-1", instruction, 180000, "ISOLATED")
    }

    @Test fun `register is durable and idempotent`() {
        val root = temporary.newFolder("evaluation")
        val store = EvaluationRequestStore(root)
        val request = request()
        assertEquals(EvaluationRegistration.Accepted(false), store.register(request))
        assertEquals(EvaluationRegistration.Accepted(true), store.register(request))
        assertTrue(store.requestDirectory(request).resolve("request.json").exists())
        assertTrue(store.requestDirectory(request).resolve("status.json").readText().contains("ACCEPTED"))
        assertEquals(request, store.consumePending())
        assertEquals(null, store.consumePending())
        assertTrue(store.requestCancellation(request.requestId))
        assertEquals(request.requestId, store.consumePendingCancellation())
        assertEquals(null, store.consumePendingCancellation())
        store.writeStatus("{\"schemaVersion\":1,\"requestId\":\"req-1\",\"runId\":\"run-1\",\"sampleId\":\"sample-1\",\"state\":\"COMPLETED\",\"updatedAt\":\"2026-09-01T10:00:00.000Z\"}")
        assertFalse(root.resolve("active-request.json").exists())
    }

    @Test fun `decodes Base64URL payload without damaging UTF-8`() {
        val root = temporary.newFolder("evaluation")
        val store = EvaluationRequestStore(root)
        val request = request(instruction = "打开“设置”\\路径\n现在几点？")
        val json = "{\"schemaVersion\":1,\"requestId\":\"${request.requestId}\",\"runId\":\"${request.runId}\",\"sampleId\":\"${request.sampleId}\",\"instruction\":${org.json.JSONObject.quote(request.instruction)},\"timeoutMs\":${request.timeoutMs},\"conversationMode\":\"ISOLATED\",\"requestHash\":\"${request.requestHash}\"}"
        val payload = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        assertEquals(EvaluationRegistration.Accepted(false), store.registerPayload(payload))
        assertEquals(request, store.consumePending())
        assertEquals("INVALID_REQUEST", (store.registerPayload("%%%") as EvaluationRegistration.Rejected).code)
    }

    @Test fun `rejects hash conflict and concurrent request`() {
        val root = temporary.newFolder("evaluation")
        val store = EvaluationRequestStore(root)
        val first = request()
        store.register(first)
        assertEquals("IDEMPOTENCY_CONFLICT", (store.register(request(instruction = "日期是什么？")) as EvaluationRegistration.Rejected).code)
        assertEquals("RUN_ALREADY_ACTIVE", (store.register(request("req-2")) as EvaluationRegistration.Rejected).code)
        store.clearActive(first.requestId)
        assertFalse(root.resolve("active-request.json").exists())
        assertEquals(EvaluationRegistration.Accepted(false), store.register(request("req-2")))
    }
}
