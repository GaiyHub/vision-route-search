package com.visionroute.probe.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DividerItemDecoration
import androidx.recyclerview.widget.LinearLayoutManager
import com.visionroute.probe.ProbeAccessibilityService
import com.visionroute.probe.R
import com.visionroute.probe.data.ProbeStorage
import com.visionroute.probe.data.RecordingSummary
import com.visionroute.probe.databinding.ActivityScenarioDetailBinding
import com.visionroute.probe.service.RecorderOverlayService

class ScenarioDetailActivity : AppCompatActivity() {

    private lateinit var binding: ActivityScenarioDetailBinding
    private val recordingAdapter = RecordingAdapter { recording ->
        openTrajectory(recording)
    }
    private var scenarioId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityScenarioDetailBinding.inflate(layoutInflater)
        setContentView(binding.root)

        scenarioId = intent.getStringExtra(EXTRA_SCENARIO_ID)
        if (scenarioId == null) {
            finish()
            return
        }
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        binding.recordingList.layoutManager = LinearLayoutManager(this)
        binding.recordingList.adapter = recordingAdapter
        binding.recordingList.addItemDecoration(
            DividerItemDecoration(this, DividerItemDecoration.VERTICAL)
        )
        binding.startRecordingBtn.setOnClickListener { ensurePermissionsAndStart() }
        loadScenario()
    }

    override fun onResume() {
        super.onResume()
        refreshRecordings()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    private fun loadScenario() {
        val sid = scenarioId ?: return
        val s = ProbeStorage.loadScenario(this, sid)
        if (s == null) {
            finish()
            return
        }
        supportActionBar?.title = s.name
        binding.scenarioName.text = s.name
        binding.scenarioDesc.text = s.description.ifBlank {
            getString(R.string.no_description)
        }
        binding.scenarioCreated.text = getString(
            R.string.created_at,
            ProbeStorage.formatTimestamp(s.createdAt)
        )
    }

    private fun refreshRecordings() {
        val sid = scenarioId ?: return
        val recordings = ProbeStorage.loadRecordings(this, sid)
        recordingAdapter.submit(recordings)
        binding.emptyRecordings.isVisible = recordings.isEmpty()
    }

    private fun ensurePermissionsAndStart() {
        val sid = scenarioId ?: return
        if (!ProbeAccessibilityService.isEnabled(this)) {
            showPermissionDialog(
                message = R.string.a11y_not_enabled,
                actionLabel = R.string.go_to_settings
            ) {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        } else if (!Settings.canDrawOverlays(this)) {
            showPermissionDialog(
                message = R.string.overlay_not_granted,
                actionLabel = R.string.grant_overlay
            ) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            }
        } else {
            RecorderOverlayService.start(this, sid)
            moveTaskToBack(true)
        }
    }

    private fun showPermissionDialog(
        message: Int,
        actionLabel: Int,
        action: () -> Unit
    ) {
        AlertDialog.Builder(this)
            .setTitle(R.string.permission_required)
            .setMessage(message)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(actionLabel) { _, _ -> action() }
            .show()
    }

    private fun openTrajectory(recording: RecordingSummary) {
        val sid = scenarioId ?: return
        startActivity(
            Intent(this, TrajectoryActivity::class.java)
                .putExtra(TrajectoryActivity.EXTRA_SCENARIO_ID, sid)
                .putExtra(TrajectoryActivity.EXTRA_RECORDING_ID, recording.recordingId)
        )
    }

    companion object {
        const val EXTRA_SCENARIO_ID = "scenario_id"
    }
}
