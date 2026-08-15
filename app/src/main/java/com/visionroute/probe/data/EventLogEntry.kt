package com.visionroute.probe.data

import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject

/**
 * 单条无障碍事件日志条目，序列化为 events.jsonl 中的一行。
 */
data class EventLogEntry(
    val eventType: Int,
    val eventTypeName: String,
    val packageName: String?,
    val eventTime: Long,
    val text: String?,
    val contentDescription: String?,
    val className: String?,
    val viewIdResourceName: String?,
    val bounds: Rect?,
    val isClickable: Boolean?,
    val sourceNull: Boolean
) {

    fun toJson(seq: Int): JSONObject = JSONObject().apply {
        put("seq", seq)
        put("eventType", eventType)
        put("eventTypeName", eventTypeName)
        put("packageName", packageName ?: JSONObject.NULL)
        put("eventTime", eventTime)
        put("text", text ?: JSONObject.NULL)
        put("contentDescription", contentDescription ?: JSONObject.NULL)
        put("className", className ?: JSONObject.NULL)
        put("viewIdResourceName", viewIdResourceName ?: JSONObject.NULL)
        if (bounds != null) {
            put("bounds", JSONObject().apply {
                put("left", bounds.left)
                put("top", bounds.top)
                put("right", bounds.right)
                put("bottom", bounds.bottom)
            })
        } else {
            put("bounds", JSONObject.NULL)
        }
        put("isClickable", isClickable ?: JSONObject.NULL)
        put("sourceNull", sourceNull)
    }

    companion object {

        /** 从无障碍事件提取元数据。getSource() 为 null 或抛异常时优雅降级，sourceNull 标记为 true。 */
        fun from(event: AccessibilityEvent): EventLogEntry {
            val source = try {
                event.source
            } catch (_: Exception) {
                null
            }

            val bounds = Rect()
            val hasBounds = source != null && try {
                source.getBoundsInScreen(bounds)
                !bounds.isEmpty
            } catch (_: Exception) {
                false
            }

            return EventLogEntry(
                eventType = event.eventType,
                eventTypeName = eventTypeName(event.eventType),
                packageName = event.packageName?.toString(),
                eventTime = event.eventTime,
                text = safeText { source?.text?.toString() },
                contentDescription = safeText { source?.contentDescription?.toString() },
                className = safeText { source?.className?.toString() },
                viewIdResourceName = safeText { source?.viewIdResourceName },
                bounds = if (hasBounds) bounds else null,
                isClickable = try {
                    source?.isClickable
                } catch (_: Exception) {
                    null
                },
                sourceNull = source == null
            )
        }

        fun eventTypeName(type: Int): String = when (type) {
            AccessibilityEvent.TYPE_VIEW_CLICKED -> "TYPE_VIEW_CLICKED"
            AccessibilityEvent.TYPE_VIEW_LONG_CLICKED -> "TYPE_VIEW_LONG_CLICKED"
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> "TYPE_VIEW_SCROLLED"
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> "TYPE_VIEW_TEXT_CHANGED"
            AccessibilityEvent.TYPE_VIEW_SELECTED -> "TYPE_VIEW_SELECTED"
            AccessibilityEvent.TYPE_VIEW_FOCUSED -> "TYPE_VIEW_FOCUSED"
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> "TYPE_WINDOW_STATE_CHANGED"
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> "TYPE_WINDOW_CONTENT_CHANGED"
            else -> "TYPE_$type"
        }

        private inline fun safeText(block: () -> String?): String? = try {
            block()
        } catch (_: Exception) {
            null
        }
    }
}
