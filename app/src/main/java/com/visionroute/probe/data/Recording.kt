package com.visionroute.probe.data

import org.json.JSONObject

/**
 * 一次录制的摘要信息，持久化为 recordings/<id>/meta.json。
 */
data class RecordingSummary(
    val scenarioId: String,
    val recordingId: String,
    val startedAt: Long,
    val endedAt: Long?,
    val eventCount: Int,
    val screenshotCount: Int
) {

    fun toJson(): JSONObject = JSONObject().apply {
        put("scenario_id", scenarioId)
        put("recording_id", recordingId)
        put("started_at", startedAt)
        put("ended_at", endedAt ?: JSONObject.NULL)
        put("event_count", eventCount)
        put("screenshot_count", screenshotCount)
    }

    companion object {
        fun fromJson(json: JSONObject): RecordingSummary = RecordingSummary(
            scenarioId = json.optString("scenario_id"),
            recordingId = json.optString("recording_id"),
            startedAt = json.optLong("started_at"),
            endedAt = if (json.isNull("ended_at")) null else json.optLong("ended_at"),
            eventCount = json.optInt("event_count"),
            screenshotCount = json.optInt("screenshot_count")
        )
    }
}
