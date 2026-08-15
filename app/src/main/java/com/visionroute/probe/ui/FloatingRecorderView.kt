package com.visionroute.probe.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.Toast
import com.visionroute.probe.ProbeAccessibilityService
import com.visionroute.probe.R
import com.visionroute.probe.databinding.ViewFloatingRecorderBinding
import com.visionroute.probe.service.RecorderSession

/**
 * 半透明悬浮录制窗（TYPE_APPLICATION_OVERLAY）。
 * 支持拖动；按钮负责启动/停止无障碍采集。
 */
@SuppressLint("ViewConstructor")
class FloatingRecorderView(
    context: Context,
    private val scenarioId: String,
    private val onCaptureChanged: (Boolean) -> Unit,
    private val onStopped: () -> Unit
) : FrameLayout(context) {

    private val binding = ViewFloatingRecorderBinding.inflate(
        LayoutInflater.from(context),
        this,
        true
    )
    private val windowManager = context.getSystemService(WindowManager::class.java)
    private var layoutParams: WindowManager.LayoutParams? = null

    private var downRawX = 0f
    private var downRawY = 0f
    private var downX = 0f
    private var downY = 0f
    private var dragging = false

    init {
        binding.captureButton.setOnClickListener { toggleCapture() }
        setOnTouchListener { _, event -> handleTouch(event) }
    }

    fun show() {
        if (layoutParams != null) return
        val density = resources.displayMetrics.density
        layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (16 * density).toInt()
            y = (160 * density).toInt()
        }
        windowManager.addView(this, layoutParams)
    }

    fun hide() {
        try {
            windowManager.removeView(this)
        } catch (_: IllegalArgumentException) {
        }
        layoutParams = null
    }

    private fun toggleCapture() {
        if (RecorderSession.isCapturing) {
            RecorderSession.stop()
            updateUi(capturing = false)
            onCaptureChanged(false)
            onStopped()
        } else {
            val service = ProbeAccessibilityService.instance
            if (service == null) {
                Toast.makeText(context, R.string.a11y_not_enabled, Toast.LENGTH_LONG).show()
                onStopped()
                return
            }
            if (RecorderSession.start(context.applicationContext, scenarioId)) {
                updateUi(capturing = true)
                onCaptureChanged(true)
            }
        }
    }

    private fun updateUi(capturing: Boolean) {
        binding.captureButton.setText(
            if (capturing) R.string.stop_capture else R.string.start_capture
        )
        binding.statusText.setText(
            if (capturing) R.string.capturing else R.string.waiting_capture
        )
    }

    private fun handleTouch(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downRawX = event.rawX
                downRawY = event.rawY
                downX = event.x
                downY = event.y
                dragging = false
                return false
            }
            MotionEvent.ACTION_MOVE -> {
                val params = layoutParams ?: return false
                val slop = ViewConfiguration.get(context).scaledTouchSlop
                if (!dragging &&
                    (Math.abs(event.rawX - downRawX) > slop ||
                        Math.abs(event.rawY - downRawY) > slop)
                ) {
                    dragging = true
                }
                if (dragging) {
                    params.x = (event.rawX - downX).toInt()
                    params.y = (event.rawY - downY).toInt()
                    windowManager.updateViewLayout(this, params)
                    return true
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (dragging) {
                    dragging = false
                    return true
                }
            }
        }
        return false
    }
}
