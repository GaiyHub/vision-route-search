package com.watchdog.agent.shell

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ShellRuntimeInstrumentedTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun sandboxExecutesPersistsBoundsOutputAndTimesOut() {
        val selectedExecutor = ShellRuntime.execute(
            context,
            "printf \"${'$'}DOUPAO_SHELL_EXECUTOR\"",
            5_000,
            "sandbox",
            false,
        )
        assertTrue(selectedExecutor.error ?: selectedExecutor.output, selectedExecutor.ok)
        assertEquals("busybox", selectedExecutor.output)

        val marker = "doupao-shell-${System.nanoTime()}"
        val first = ShellRuntime.execute(
            context,
            "printf '$marker' > /workspace/device-smoke && cat /workspace/device-smoke",
            10_000,
            "sandbox",
            false,
        )
        assertTrue(first.error ?: first.output, first.ok)
        assertEquals(marker, first.output)

        val second = ShellRuntime.execute(context, "cat /workspace/device-smoke", 5_000, "sandbox", false)
        assertTrue(second.error ?: second.output, second.ok)
        assertEquals(marker, second.output)

        val longOutput = ShellRuntime.execute(context, "yes x | head -c 20000", 5_000, "sandbox", false)
        assertTrue(longOutput.error ?: longOutput.output, longOutput.ok)
        assertTrue(longOutput.truncated)
        assertTrue(longOutput.output.contains("bytes omitted"))
        assertTrue(longOutput.outputRef?.startsWith("/workspace/") == true)

        val timedOut = ShellRuntime.execute(context, "sleep 2", 1_000, "sandbox", false)
        assertFalse(timedOut.ok)
        assertTrue(timedOut.timedOut)
        assertEquals(124, timedOut.exitCode)
    }

    @Test
    fun androidDeviceCommandRunsOnHost() {
        val result = ShellRuntime.execute(context, "android-device info", 5_000, "sandbox", false)
        assertTrue(result.error ?: result.output, result.ok)
        assertEquals("android_host", result.privilege)
        assertTrue(result.output.contains("\"android_version\""))
        assertTrue(result.output.contains("\"sdk_level\""))
        assertTrue(result.output.contains("\"model\""))
    }

    @Test
    fun deterministicAndroidActionsAreDiscoverableWithoutLaunchingApps() {
        val help = ShellRuntime.execute(context, "shell-help", 5_000, "sandbox", false)
        assertTrue(help.error ?: help.output, help.ok)
        assertTrue(help.output.contains("android-communicate"))
        assertTrue(help.output.contains("android-map"))
        assertTrue(help.output.contains("android-location"))
        assertTrue(help.output.contains("android-settings"))
        assertTrue(help.output.contains("android-calendar"))
        assertTrue(help.output.contains("android-share"))

        val settings = ShellRuntime.execute(
            context,
            "android-settings list",
            5_000,
            "sandbox",
            false,
        )
        assertTrue(settings.error ?: settings.output, settings.ok)
        assertTrue(settings.output.contains("app-notifications"))

        val compose = ShellRuntime.execute(
            context,
            "android-communicate --help",
            5_000,
            "sandbox",
            false,
        )
        assertTrue(compose.error ?: compose.output, compose.ok)
        assertTrue(compose.output.contains("does not send a message"))

        val location = ShellRuntime.execute(
            context,
            "android-location --help",
            5_000,
            "sandbox",
            false,
        )
        assertTrue(location.error ?: location.output, location.ok)
        assertTrue(location.output.contains("android-location current"))
        assertTrue(location.output.contains("accuracy"))
    }

    @Test
    fun androidHostCommandRejectsPipes() {
        val result = ShellRuntime.execute(
            context,
            "android-device info | sed -n 1p",
            5_000,
            "sandbox",
            false,
        )
        assertFalse(result.ok)
        assertEquals("UNSUPPORTED_ANDROID_COMMAND_SYNTAX", result.code)
    }

    @Test
    fun busyBoxCommandNotFoundReturnsActionableShellHelpGuidance() {
        val result = ShellRuntime.execute(
            context,
            "definitely-not-a-real-command",
            5_000,
            "sandbox",
            false,
        )
        assertFalse(result.ok)
        assertEquals("sandbox", result.privilege)
        assertEquals("COMMAND_NOT_FOUND", result.code)
        assertEquals(127, result.exitCode)
        assertTrue(result.error?.contains("shell-help") == true)
    }
}
