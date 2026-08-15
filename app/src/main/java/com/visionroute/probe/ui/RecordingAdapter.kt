package com.visionroute.probe.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.visionroute.probe.R
import com.visionroute.probe.data.ProbeStorage
import com.visionroute.probe.data.RecordingSummary
import com.visionroute.probe.databinding.ItemRecordingBinding

class RecordingAdapter(
    private val onClick: (RecordingSummary) -> Unit
) : RecyclerView.Adapter<RecordingAdapter.ViewHolder>() {

    private val items = mutableListOf<RecordingSummary>()

    fun submit(recordings: List<RecordingSummary>) {
        items.clear()
        items.addAll(recordings)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemRecordingBinding.inflate(
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
        private val binding: ItemRecordingBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(recording: RecordingSummary) {
            binding.recordingTime.text = itemView.context.getString(
                R.string.recorded_at,
                ProbeStorage.formatTimestamp(recording.startedAt)
            )
            binding.recordingStats.text = itemView.context.getString(
                R.string.recording_stats,
                recording.eventCount,
                recording.screenshotCount
            )
            binding.root.setOnClickListener { onClick(recording) }
        }
    }
}
