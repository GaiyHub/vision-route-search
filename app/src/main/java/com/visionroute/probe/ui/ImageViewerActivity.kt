package com.visionroute.probe.ui

import android.graphics.BitmapFactory
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.visionroute.probe.databinding.ActivityImageViewerBinding

class ImageViewerActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val binding = ActivityImageViewerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val path = intent.getStringExtra(EXTRA_IMAGE_PATH)
        if (path == null) {
            finish()
            return
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        var sample = 1
        while (bounds.outWidth / sample > 2160 || bounds.outHeight / sample > 2160) {
            sample *= 2
        }
        binding.fullImage.setImageBitmap(
            BitmapFactory.decodeFile(
                path,
                BitmapFactory.Options().apply { inSampleSize = sample }
            )
        )
    }

    companion object {
        const val EXTRA_IMAGE_PATH = "image_path"
    }
}
