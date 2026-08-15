package com.visionroute.probe.data

import android.content.Context
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * 纯文件存储：
 * <外部存储>/Android/data/<pkg>/files/vision-route-search/
 *   scenarios/<scenario_id>/
 *     meta.json
 *     recordings/<recording_id>/
 *       meta.json
 *       events.jsonl
 *       screenshots/
 *         NNN_<timestamp>.png
 *         index.jsonl
 */
object ProbeStorage {

    private const val ROOT_NAME = "vision-route-search"
    private val idFormat = ThreadLocal.withInitial {
        SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
    }
    private val displayFormat = ThreadLocal.withInitial {
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
    }

    fun rootDir(context: Context): File = File(context.getExternalFilesDir(null), ROOT_NAME)
    fun scenariosDir(context: Context): File = File(rootDir(context), "scenarios")
    fun scenarioDir(context: Context, scenarioId: String): File = File(scenariosDir(context), scenarioId)
    fun recordingsDir(context: Context, scenarioId: String): File =
        File(scenarioDir(context, scenarioId), "recordings")
    fun recordingDir(context: Context, scenarioId: String, recordingId: String): File =
        File(recordingsDir(context, scenarioId), recordingId)
    fun eventsFile(context: Context, scenarioId: String, recordingId: String): File =
        File(recordingDir(context, scenarioId, recordingId), "events.jsonl")
    fun screenshotsDir(context: Context, scenarioId: String, recordingId: String): File =
        File(recordingDir(context, scenarioId, recordingId), "screenshots")

    // ---------- 场景 ----------

    fun createScenario(context: Context, name: String, description: String): Scenario {
        val id = newId()
        val dir = scenarioDir(context, id).apply { mkdirs() }
        val scenario = Scenario(id, name.trim(), description.trim(), System.currentTimeMillis())
        writeJson(File(dir, "meta.json"), scenario.toJson())
        return scenario
    }

    fun loadScenarios(context: Context): List<Scenario> =
        scenariosDir(context).listFiles()
            ?.filter { it.isDirectory }
            ?.mapNotNull { readScenario(File(it, "meta.json")) }
            ?.sortedByDescending { it.createdAt }
            ?: emptyList()

    fun loadScenario(context: Context, scenarioId: String): Scenario? =
        readScenario(File(scenarioDir(context, scenarioId), "meta.json"))

    private fun readScenario(file: File): Scenario? = try {
        if (!file.exists()) null else Scenario.fromJson(JSONObject(file.readText()))
    } catch (_: Exception) {
        null
    }

    // ---------- 录制 ----------

    fun createRecording(context: Context, scenarioId: String): Pair<String, String> {
        val recordingId = newId()
        val dir = recordingDir(context, scenarioId, recordingId).apply { mkdirs() }
        screenshotsDir(context, scenarioId, recordingId).apply { mkdirs() }
        val startedAt = System.currentTimeMillis()
        writeJson(
            File(dir, "meta.json"),
            RecordingSummary(scenarioId, recordingId, startedAt, null, 0, 0).toJson()
        )
        return scenarioId to recordingId
    }

    fun openEventWriter(context: Context, scenarioId: String, recordingId: String): BufferedWriter =
        eventsFile(context, scenarioId, recordingId).bufferedWriter()

    fun finishRecording(
        context: Context,
        scenarioId: String,
        recordingId: String,
        startedAt: Long,
        eventCount: Int,
        screenshotCount: Int
    ) {
        val dir = recordingDir(context, scenarioId, recordingId)
        writeJson(
            File(dir, "meta.json"),
            RecordingSummary(
                scenarioId = scenarioId,
                recordingId = recordingId,
                startedAt = startedAt,
                endedAt = System.currentTimeMillis(),
                eventCount = eventCount,
                screenshotCount = screenshotCount
            ).toJson()
        )
    }

    fun loadRecordings(context: Context, scenarioId: String): List<RecordingSummary> {
        val dir = recordingsDir(context, scenarioId)
        return dir.listFiles()
            ?.filter { it.isDirectory }
            ?.mapNotNull { dir ->
                val meta = readRecordingMeta(File(dir, "meta.json"))
                if (meta != null) {
                    meta
                } else {
                    // 录制中途被杀时的兜底：按目录内容估算
                    val events = eventsFile(context, scenarioId, dir.name).readLinesOrEmpty().size
                    val shots = screenshotsDir(context, scenarioId, dir.name).listFiles()?.size ?: 0
                    RecordingSummary(
                        scenarioId = scenarioId,
                        recordingId = dir.name,
                        startedAt = parseIdTime(dir.name) ?: dir.lastModified(),
                        endedAt = null,
                        eventCount = events,
                        screenshotCount = shots
                    )
                }
            }
            ?.sortedByDescending { it.startedAt }
            ?: emptyList()
    }

    private fun readRecordingMeta(file: File): RecordingSummary? = try {
        if (!file.exists()) null else RecordingSummary.fromJson(JSONObject(file.readText()))
    } catch (_: Exception) {
        null
    }

    // ---------- 事件与截图 ----------

    fun loadEvents(context: Context, scenarioId: String, recordingId: String): List<JSONObject> {
        val file = eventsFile(context, scenarioId, recordingId)
        if (!file.exists()) return emptyList()
        return file.readLinesOrEmpty().mapNotNull { line ->
            try {
                JSONObject(line)
            } catch (_: Exception) {
                null
            }
        }
    }

    fun appendScreenshotIndex(
        context: Context,
        scenarioId: String,
        recordingId: String,
        eventSeq: Int,
        fileName: String
    ) {
        val file = File(screenshotsDir(context, scenarioId, recordingId), "index.jsonl")
        try {
            file.appendText(
                JSONObject().apply {
                    put("seq", eventSeq)
                    put("file", fileName)
                    put("time", System.currentTimeMillis())
                }.toString() + "\n"
            )
        } catch (_: Exception) {
        }
    }

    fun loadScreenshotIndex(context: Context, scenarioId: String, recordingId: String): Map<Int, File> {
        val dir = screenshotsDir(context, scenarioId, recordingId)
        val indexFile = File(dir, "index.jsonl")
        if (!indexFile.exists()) return emptyMap()
        return indexFile.readLinesOrEmpty().mapNotNull { line ->
            try {
                val obj = JSONObject(line)
                val seq = obj.optInt("seq")
                val name = obj.optString("file")
                if (seq > 0 && name.isNotBlank()) seq to File(dir, name) else null
            } catch (_: Exception) {
                null
            }
        }.toMap()
    }

    // ---------- 导出 ----------

    /** 将 events.jsonl + meta.json + screenshots/ 打包为 zip，返回缓存目录中的文件。 */
    fun exportRecording(context: Context, scenarioId: String, recordingId: String): File? {
        val src = recordingDir(context, scenarioId, recordingId)
        if (!src.exists()) return null
        val outDir = File(context.cacheDir, "exports")
        outDir.mkdirs()
        val zipFile = File(outDir, "$recordingId.zip")
        try {
            ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
                fun add(file: File, entryName: String) {
                    if (!file.isFile) return
                    zos.putNextEntry(ZipEntry(entryName))
                    file.inputStream().use { it.copyTo(zos) }
                    zos.closeEntry()
                }
                add(File(src, "events.jsonl"), "events.jsonl")
                add(File(src, "meta.json"), "meta.json")
                val shots = screenshotsDir(context, scenarioId, recordingId)
                add(File(shots, "index.jsonl"), "screenshots/index.jsonl")
                shots.listFiles()
                    ?.filter { it.isFile && it.extension.equals("png", ignoreCase = true) }
                    ?.sortedBy { it.name }
                    ?.forEach { add(it, "screenshots/${it.name}") }
            }
            return zipFile
        } catch (_: Exception) {
            return null
        }
    }

    // ---------- 工具 ----------

    fun newId(): String = idFormat.get().format(Date()) + "_" + (100..999).random()

    fun parseIdTime(id: String): Long? = try {
        idFormat.get().parse(id.substringBefore("_"))?.time
    } catch (_: Exception) {
        null
    }

    fun formatTimestamp(ms: Long): String = displayFormat.get().format(Date(ms))

    fun writeJson(file: File, json: JSONObject) {
        file.parentFile?.mkdirs()
        file.writeText(json.toString())
    }

    private fun File.readLinesOrEmpty(): List<String> = try {
        if (exists()) readLines() else emptyList()
    } catch (_: Exception) {
        emptyList()
    }
}
