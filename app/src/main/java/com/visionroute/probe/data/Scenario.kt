package com.visionroute.probe.data

import org.json.JSONObject

/**
 * 分析场景模型，持久化为 scenarios/<id>/meta.json。
 */
data class Scenario(
    val id: String,
    val name: String,
    val description: String,
    val createdAt: Long
) {

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("description", description)
        put("created_at", createdAt)
    }

    companion object {
        fun fromJson(json: JSONObject): Scenario = Scenario(
            id = json.optString("id"),
            name = json.optString("name"),
            description = json.optString("description"),
            createdAt = json.optLong("created_at")
        )
    }
}
