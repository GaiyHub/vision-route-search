package com.visionroute.probe.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.visionroute.probe.R
import com.visionroute.probe.data.ProbeStorage
import com.visionroute.probe.data.Scenario
import com.visionroute.probe.databinding.ItemScenarioBinding

class ScenarioAdapter(
    private val onClick: (Scenario) -> Unit
) : RecyclerView.Adapter<ScenarioAdapter.ViewHolder>() {

    private val items = mutableListOf<Scenario>()

    fun submit(scenarios: List<Scenario>) {
        items.clear()
        items.addAll(scenarios)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemScenarioBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    inner class ViewHolder(
        private val binding: ItemScenarioBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(scenario: Scenario) {
            binding.scenarioName.text = scenario.name
            binding.scenarioDesc.text = scenario.description.ifBlank {
                itemView.context.getString(R.string.no_description)
            }
            binding.scenarioCreated.text = itemView.context.getString(
                R.string.created_at,
                ProbeStorage.formatTimestamp(scenario.createdAt)
            )
            binding.root.setOnClickListener { onClick(scenario) }
        }
    }
}
