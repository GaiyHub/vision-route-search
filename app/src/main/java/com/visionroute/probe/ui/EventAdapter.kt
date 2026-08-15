package com.visionroute.probe.ui

import android.graphics.BitmapFactory
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import androidx.core.view.isVisible
import androidx.recyclerview.widget.RecyclerView
import com.visionroute.probe.databinding.ItemEventBinding
import java.io.File

class EventAdapter(
    private val onThumbnailClick: (DisplayEvent, File) -> Unit
) : RecyclerView.Adapter<EventAdapter.ViewHolder>() {

    private val items = mutableListOf<DisplayEvent>()

    fun submit(events: List<DisplayEvent>) {
        items.clear()
        items.addAll(events)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemEventBinding.inflate(
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
        private val binding: ItemEventBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(event: DisplayEvent) {
            binding.eventTitle.text = event.title
            binding.eventSubtitle.text = event.subtitle

            val hasDetail = !event.detailJson.isNullOrBlank()
            binding.eventDetail.isVisible = event.expanded && hasDetail
            if (hasDetail) {
                binding.eventDetail.text = event.detailJson
            }

            val shot = event.screenshotFile
            if (shot != null && shot.exists()) {
                binding.eventThumb.isVisible = true
                binding.eventThumb.setImageBitmap(loadThumbnail(shot))
                binding.eventThumb.setOnClickListener { onThumbnailClick(event, shot) }
            } else {
                binding.eventThumb.isVisible = false
                binding.eventThumb.setOnClickListener(null)
            }

            binding.root.setOnClickListener {
                if (!hasDetail) return@setOnClickListener
                event.expanded = !event.expanded
                notifyItemChanged(bindingAdapterPosition)
            }
        }

        private fun loadThumbnail(file: File): android.graphics.Bitmap? {
            return try {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, bounds)
                var sample = 1
                while (bounds.outWidth / sample > 480 || bounds.outHeight / sample > 480) {
                    sample *= 2
                }
                BitmapFactory.decodeFile(
                    file.absolutePath,
                    BitmapFactory.Options().apply { inSampleSize = sample }
                )
            } catch (_: Exception) {
                null
            }
        }
    }

    data class DisplayEvent(
        val seq: Int,
        val title: String,
        val subtitle: String,
        val detailJson: String?,
        val screenshotFile: File?,
        val isError: Boolean,
        var expanded: Boolean = false
    )
}
