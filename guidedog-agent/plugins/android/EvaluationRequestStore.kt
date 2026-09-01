package com.watchdog.agent

import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.Base64

data class EvaluationRequestRecord(
    val schemaVersion: Int,
    val requestId: String,
    val requestHash: String,
    val runId: String,
    val sampleId: String,
    val instruction: String,
    val timeoutMs: Long,
    val conversationMode: String,
)

sealed class EvaluationRegistration {
    data class Accepted(val duplicate: Boolean) : EvaluationRegistration()
    data class Rejected(val code: String, val message: String) : EvaluationRegistration()
}

class EvaluationRequestStore(private val evaluationRoot: File) {
    companion object {
        private val ID_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
        private val HASH_PATTERN = Regex("^[a-f0-9]{64}$")
        private const val MAX_INSTRUCTION_BYTES = 32 * 1024
        private const val MAX_PAYLOAD_BYTES = 64 * 1024
        private const val MIN_TIMEOUT_MS = 1_000L
        private const val MAX_TIMEOUT_MS = 30 * 60 * 1_000L
    }

    @Synchronized
    fun registerPayload(payload: String): EvaluationRegistration {
        val request = try {
            decodePayload(payload)
        } catch (error: IllegalArgumentException) {
            return EvaluationRegistration.Rejected("INVALID_REQUEST", error.message ?: "payload 无效")
        }
        return register(request)
    }

    @Synchronized
    fun register(request: EvaluationRequestRecord): EvaluationRegistration {
        validate(request)?.let { return it }
        val requestDirectory = requestDirectory(request)
        val requestFile = File(requestDirectory, "request.json")
        if (requestFile.exists()) {
            val storedHash = JSONObject(requestFile.readText()).getString("requestHash")
            return if (storedHash == request.requestHash) {
                EvaluationRegistration.Accepted(duplicate = true)
            } else {
                EvaluationRegistration.Rejected("IDEMPOTENCY_CONFLICT", "requestId 已绑定到不同请求")
            }
        }

        val activeFile = File(evaluationRoot, "active-request.json")
        if (activeFile.exists()) {
            val activeId = JSONObject(activeFile.readText()).getString("requestId")
            if (activeId != request.requestId) {
                return EvaluationRegistration.Rejected("RUN_ALREADY_ACTIVE", "已有评测任务运行中")
            }
        }

        requestDirectory.mkdirs()
        atomicWrite(requestFile, requestJson(request).toString(2) + "\n")
        atomicWrite(File(requestDirectory, "status.json"), acceptedStatusJson(request).toString(2) + "\n")
        atomicWrite(activeFile, JSONObject().put("requestId", request.requestId).toString() + "\n")
        atomicWrite(File(evaluationRoot, "pending-request.json"), requestJson(request).toString() + "\n")
        return EvaluationRegistration.Accepted(duplicate = false)
    }

    @Synchronized
    fun consumePending(): EvaluationRequestRecord? {
        val pending = File(evaluationRoot, "pending-request.json")
        if (!pending.exists()) return null
        val request = parseRequest(JSONObject(pending.readText()))
        Files.deleteIfExists(pending.toPath())
        return request
    }

    @Synchronized
    fun clearActive(requestId: String) {
        val active = File(evaluationRoot, "active-request.json")
        if (!active.exists()) return
        if (JSONObject(active.readText()).optString("requestId") == requestId) {
            Files.deleteIfExists(active.toPath())
        }
    }

    @Synchronized
    fun requestCancellation(requestId: String): Boolean {
        if (!ID_PATTERN.matches(requestId)) return false
        val active = File(evaluationRoot, "active-request.json")
        if (!active.exists() || JSONObject(active.readText()).optString("requestId") != requestId) return false
        atomicWrite(
            File(evaluationRoot, "pending-cancel.json"),
            JSONObject().put("requestId", requestId).put("requestedAt", Instant.now().toString()).toString() + "\n",
        )
        return true
    }

    @Synchronized
    fun consumePendingCancellation(): String? {
        val pending = File(evaluationRoot, "pending-cancel.json")
        if (!pending.exists()) return null
        val requestId = JSONObject(pending.readText()).getString("requestId")
        Files.deleteIfExists(pending.toPath())
        return requestId
    }

    @Synchronized
    fun writeStatus(statusJson: String) {
        val status = JSONObject(statusJson)
        if (status.getInt("schemaVersion") != 1) throw IllegalArgumentException("不支持的状态版本")
        val requestId = status.getString("requestId")
        val runId = status.getString("runId")
        val sampleId = status.getString("sampleId")
        if (listOf(requestId, runId, sampleId).any { !ID_PATTERN.matches(it) }) throw IllegalArgumentException("状态 ID 无效")
        val state = status.getString("state")
        if (state !in setOf("ACCEPTED", "RUNNING", "COMPLETED", "BLOCKED", "TIMED_OUT", "CANCELLED", "ERROR")) {
            throw IllegalArgumentException("状态值无效")
        }
        val directory = File(evaluationRoot, "$runId/$sampleId/$requestId")
        if (!File(directory, "request.json").exists()) throw IllegalArgumentException("评测请求不存在")
        atomicWrite(File(directory, "status.json"), status.toString(2) + "\n")
        if (state in setOf("COMPLETED", "BLOCKED", "TIMED_OUT", "CANCELLED", "ERROR")) clearActive(requestId)
    }

    fun requestToJson(request: EvaluationRequestRecord): String = requestJson(request).toString()

    fun requestDirectory(request: EvaluationRequestRecord): File =
        File(evaluationRoot, "${request.runId}/${request.sampleId}/${request.requestId}")

    private fun decodePayload(payload: String): EvaluationRequestRecord {
        if (payload.isEmpty() || !Regex("^[A-Za-z0-9_-]+$").matches(payload) || payload.length % 4 == 1) {
            throw IllegalArgumentException("payload 不是合法 Base64URL")
        }
        val bytes = try { Base64.getUrlDecoder().decode(payload) } catch (_: Exception) {
            throw IllegalArgumentException("payload 不是合法 Base64URL")
        }
        if (bytes.size > MAX_PAYLOAD_BYTES) throw IllegalArgumentException("payload 超过大小限制")
        val text = try {
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        } catch (_: Exception) {
            throw IllegalArgumentException("payload 不是合法 UTF-8")
        }
        val json = try { JSONObject(text) } catch (_: Exception) { throw IllegalArgumentException("payload 不是合法 JSON") }
        val allowed = setOf("schemaVersion", "requestId", "requestHash", "runId", "sampleId", "instruction", "timeoutMs", "conversationMode")
        if (json.keys().asSequence().any { it !in allowed }) throw IllegalArgumentException("payload 包含未知字段")
        return try { parseRequest(json) } catch (_: Exception) { throw IllegalArgumentException("payload 字段无效") }
    }

    private fun validate(request: EvaluationRequestRecord): EvaluationRegistration.Rejected? {
        if (request.schemaVersion != 1) return rejected("UNSUPPORTED_SCHEMA_VERSION", "仅支持 schemaVersion=1")
        for ((name, value) in listOf("requestId" to request.requestId, "runId" to request.runId, "sampleId" to request.sampleId)) {
            if (!ID_PATTERN.matches(value)) return rejected("INVALID_REQUEST", "$name 格式无效")
        }
        if (!HASH_PATTERN.matches(request.requestHash)) return rejected("INVALID_REQUEST", "requestHash 格式无效")
        if (request.instruction.isBlank() || request.instruction.toByteArray(StandardCharsets.UTF_8).size > MAX_INSTRUCTION_BYTES) {
            return rejected("INVALID_REQUEST", "instruction 为空或超过限制")
        }
        if (request.timeoutMs !in MIN_TIMEOUT_MS..MAX_TIMEOUT_MS) return rejected("INVALID_REQUEST", "timeoutMs 超出范围")
        if (request.conversationMode != "ISOLATED") return rejected("INVALID_REQUEST", "conversationMode 必须为 ISOLATED")
        if (sha256(canonicalHashInput(request)) != request.requestHash) return rejected("INVALID_REQUEST", "requestHash 校验失败")
        return null
    }

    private fun canonicalHashInput(request: EvaluationRequestRecord): String = buildString {
        append("{\"schemaVersion\":1")
        append(",\"requestId\":").append(JSONObject.quote(request.requestId))
        append(",\"runId\":").append(JSONObject.quote(request.runId))
        append(",\"sampleId\":").append(JSONObject.quote(request.sampleId))
        append(",\"instruction\":").append(JSONObject.quote(request.instruction))
        append(",\"timeoutMs\":").append(request.timeoutMs)
        append(",\"conversationMode\":").append(JSONObject.quote(request.conversationMode))
        append('}')
    }

    private fun requestJson(request: EvaluationRequestRecord): JSONObject = JSONObject(canonicalHashInput(request))
        .put("requestHash", request.requestHash)

    private fun acceptedStatusJson(request: EvaluationRequestRecord): JSONObject = JSONObject()
        .put("schemaVersion", 1)
        .put("requestId", request.requestId)
        .put("runId", request.runId)
        .put("sampleId", request.sampleId)
        .put("state", "ACCEPTED")
        .put("updatedAt", Instant.now().toString())

    private fun parseRequest(json: JSONObject) = EvaluationRequestRecord(
        schemaVersion = json.getInt("schemaVersion"),
        requestId = json.getString("requestId"),
        requestHash = json.getString("requestHash"),
        runId = json.getString("runId"),
        sampleId = json.getString("sampleId"),
        instruction = json.getString("instruction"),
        timeoutMs = json.getLong("timeoutMs"),
        conversationMode = json.getString("conversationMode"),
    )

    private fun atomicWrite(target: File, contents: String) {
        target.parentFile?.mkdirs()
        val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.tmp")
        temporary.writeText(contents, StandardCharsets.UTF_8)
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun rejected(code: String, message: String) = EvaluationRegistration.Rejected(code, message)
}
