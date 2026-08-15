package com.visionroute.probe

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DividerItemDecoration
import androidx.recyclerview.widget.LinearLayoutManager
import com.visionroute.probe.data.ProbeStorage
import com.visionroute.probe.data.Scenario
import com.visionroute.probe.databinding.ActivityMainBinding
import com.visionroute.probe.ui.ScenarioAdapter
import com.visionroute.probe.ui.ScenarioDetailActivity

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val adapter = ScenarioAdapter { scenario -> openScenario(scenario) }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* 结果不重要：通知未授权时仅不显示前台通知 */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.scenarioList.layoutManager = LinearLayoutManager(this)
        binding.scenarioList.adapter = adapter
        binding.scenarioList.addItemDecoration(
            DividerItemDecoration(this, DividerItemDecoration.VERTICAL)
        )
        binding.addScenarioFab.setOnClickListener { showNewScenarioDialog() }
        requestNotificationPermissionIfNeeded()
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        refreshScenarios()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val scenarioId = intent?.getStringExtra(EXTRA_OPEN_SCENARIO) ?: return
        intent.removeExtra(EXTRA_OPEN_SCENARIO)
        openScenario(scenarioId)
    }

    private fun refreshScenarios() {
        val scenarios = ProbeStorage.loadScenarios(this)
        adapter.submit(scenarios)
        binding.emptyView.isVisible = scenarios.isEmpty()
    }

    private fun openScenario(scenario: Scenario) {
        startActivity(
            Intent(this, ScenarioDetailActivity::class.java)
                .putExtra(ScenarioDetailActivity.EXTRA_SCENARIO_ID, scenario.id)
        )
    }

    private fun openScenario(scenarioId: String) {
        startActivity(
            Intent(this, ScenarioDetailActivity::class.java)
                .putExtra(ScenarioDetailActivity.EXTRA_SCENARIO_ID, scenarioId)
        )
    }

    private fun showNewScenarioDialog() {
        val nameInput = EditText(this).apply {
            hint = getString(R.string.scenario_name_hint)
        }
        val descInput = EditText(this).apply {
            hint = getString(R.string.scenario_desc_hint)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 16, 48, 16)
            addView(nameInput)
            addView(descInput)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.new_scenario)
            .setView(container)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.confirm) { _, _ ->
                val name = nameInput.text.toString().trim()
                if (name.isEmpty()) {
                    Toast.makeText(this, R.string.scenario_name_empty, Toast.LENGTH_SHORT).show()
                } else {
                    ProbeStorage.createScenario(this, name, descInput.text.toString())
                    refreshScenarios()
                }
            }
            .show()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    companion object {
        const val EXTRA_OPEN_SCENARIO = "extra_open_scenario"
    }
}
