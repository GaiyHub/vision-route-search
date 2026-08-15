package com.visionroute.probe.ui

import android.content.ClipData
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.isVisible
import androidx.recyclerview.widget.LinearLayoutManager
import com.visionroute.probe.R
import com.visionroute.probe.data.ProbeStorage
import com.visionroute.probe.databinding.ActivityTrajectoryBinding
import org.json.JSONObject
import java.io.File

class TrajectoryActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTrajectoryBinding
    private val adapter = EventAdapter { event, file ->
        openImage(file)
    }
    private var scenarioId: String? = null
    private var recordingId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTrajectoryBinding.inflate(layoutInflater)
        setContentView(binding.root)

        scenarioId = intent.getStringExtra(EXTRA_SCENARIO_ID)
        recordingId = intent.getStringExtra(EXTRA_RECORDING_ID)
        if (scenarioId == null || recordingId == null) {
            finish()
            return
        }
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.title = getString(R.string.trajectory_title)

        binding.eventList.layoutManager = LinearLayoutManager(this)
        binding.eventList.adapter = adapter
        loadTrajectory()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    override fun onCreateOptionsMenu(menu: android.view.Menu): Boolean {
        menuInflater.inflate(R.menu.menu_trajectory, menu)
        return true
    }

    override fun onOptionsItemSelected(item: android.view.MenuItem): Boolean {
        if (item.itemId == R.id.action_export) {
            exportRecording()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private fun loadTrajectory() {
        val sid = scenarioId ?: return
        val rid = recordingId ?: return
        Thread {
            val events = ProbeStorage.loadEvents(this, sid, rid)
            val shots = ProbeStorage.loadScreenshotIndex(this, sid, rid)
            val displayEvents = buildDisplayEvents(events, shots)
            runOnUiThread {
                adapter.submit(displayEvents)
                binding.emptyEvents.isVisible = displayEvents.isEmpty()
            }
        }.start()
    }

    private fun buildDisplayEvents(
        events: List<JSONObject>,
        shots: Map<Int, File>
    ): List<EventAdapter.DisplayEvent> {
        return events.map { obj ->
            if (obj.optString("kind") == "screenshot_error") {
                EventAdapter.DisplayEvent(
                    seq = obj.optInt("ref_seq"),
                    title = getString(R.string.screenshot_failed),
                    subtitle = getString(
                        R.string.screenshot_error_detail,
                        obj.optInt("error_code"),
                        ProbeStorage.formatTimestamp(obj.optLong("eventTime"))
                    ),
                    detailJson = null,
                    screenshotFile = null,
                    isError = true
                )
            } else {
                val seq = obj.optInt("seq")
                val title = obj.optString(
                    "eventTypeName",
                    "TYPE_${obj.optInt("eventType")}"
                )
                val packageName = obj.optString("packageName", "?")
                val time = ProbeStorage.formatTimestamp(obj.optLong("eventTime"))
                val text = obj.optString("text")
                    .ifBlank { obj.optString("contentDescription") }
                val element = obj.optString("viewIdResourceName")
                    .ifBlank { obj.optString("className") }
                val subtitle = buildString {
                    append(packageName)
                    append(" · ")
                    append(time)
                    if (text.isNotBlank()) {
                        append(" · ")
                        append(text.take(48))
                    }
                    if (element.isNotBlank()) {
                        append(" · ")
                        append(element)
                    }
                }
                EventAdapter.DisplayEvent(
                    seq = seq,
                    title = title,
                    subtitle = subtitle,
                    detailJson = prettyJson(obj),
                    screenshotFile = shots[seq],
                    isError = false
                )
            }
        }
    }

    private fun prettyJson(obj: JSONObject): String = try {
        obj.toString(2)
    } catch (_: Exception) {
        obj.toString()
    }

    private fun openImage(file: File) {
        if (!file.exists()) return
        startActivity(
            Intent(this, ImageViewerActivity::class.java)
                .putExtra(ImageViewerActivity.EXTRA_IMAGE_PATH, file.absolutePath)
        )
    }

    private fun exportRecording() {
        val sid = scenarioId ?: return
        val rid = recordingId ?: return
        Thread {
            val zip = ProbeStorage.exportRecording(this, sid, rid)
            runOnUiThread {
                if (zip == null || !zip.exists()) {
                    Toast.makeText(this, R.string.export_nothing, Toast.LENGTH_SHORT).show()
                    return@runOnUiThread
                }
                shareZip(zip)
            }
        }.start()
    }

    private fun shareZip(file: File) {
        val uri: Uri = FileProvider.getUriForFile(
            this,
            "$packageName.fileprovider",
            file
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/zip"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newRawUri(getString(R.string.export), uri)
        }
        startActivity(Intent.createChooser(send, getString(R.string.export)))
    }

    companion object {
        const val EXTRA_SCENARIO_ID = "scenario_id"
        const val EXTRA_RECORDING_ID = "recording_id"
    }
}
