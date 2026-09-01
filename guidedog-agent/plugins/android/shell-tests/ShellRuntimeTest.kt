package com.watchdog.agent.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.time.LocalDateTime
import java.time.ZoneId

class ShellRuntimeTest {
    @get:Rule val temporaryFolder = TemporaryFolder()

    @Test fun commandPolicyValidatesBounds() {
        assertTrue(ShellCommandPolicy.validate("printf ok", 1_000).ok)
        assertFalse(ShellCommandPolicy.validate("", 1_000).ok)
        assertFalse(ShellCommandPolicy.validate("x", 999).ok)
        assertFalse(ShellCommandPolicy.validate("x".repeat(1001), 1_000).ok)
    }

    @Test fun workspacePathsAreMappedForDirectBusyBoxExecution() {
        assertEquals(
            "cat /data/user/0/test/files/shell/workspace/result.txt",
            ShellRuntime.rewriteWorkspacePath(
                "cat /workspace/result.txt",
                "/data/user/0/test/files/shell/workspace",
            ),
        )
    }

    @Test fun outputCollectorKeepsSmallOutputAndBoundsLargeOutput() {
        val smallFile = temporaryFolder.newFile("small.log")
        val small = BoundedOutputCollector(smallFile, 1024)
        small.consume(ByteArrayInputStream("hello".toByteArray()))
        assertEquals("hello", small.preview())
        assertFalse(small.isTruncated)

        val largeFile = temporaryFolder.newFile("large.log")
        val large = BoundedOutputCollector(largeFile, 1024)
        val payload = "x".repeat(20_000).toByteArray()
        large.consume(ByteArrayInputStream(payload))
        assertTrue(large.isTruncated)
        assertEquals(1024L, largeFile.length())
        assertTrue(large.preview().contains("bytes omitted"))
    }

    @Test fun androidHostCommandTokenizerSupportsQuotesWithoutEvaluation() {
        val parsed = AndroidHostCommandRouter.tokenize(
            "android-notification send --title '豆泡 通知' --body \"hello world\"",
        )
        assertEquals(
            listOf(
                "android-notification",
                "send",
                "--title",
                "豆泡 通知",
                "--body",
                "hello world",
            ),
            parsed.tokens,
        )
        assertFalse(parsed.hasShellOperators)
        assertEquals(null, parsed.error)
    }

    @Test fun androidHostCommandTokenizerRejectsShellComposition() {
        val piped = AndroidHostCommandRouter.tokenize("android-device info | sed -n 1p")
        assertTrue(piped.hasShellOperators)
        val chained = AndroidHostCommandRouter.tokenize("android-device info && id")
        assertTrue(chained.hasShellOperators)
        val quoted = AndroidHostCommandRouter.tokenize("android-clipboard set 'a | b'")
        assertFalse(quoted.hasShellOperators)
    }

    @Test fun androidCalendarDateTimeAcceptsLocalAndOffsetIsoValues() {
        val local = AndroidHostCommandRouter.parseDateTime("2026-08-27T09:30")
        val expectedLocal = LocalDateTime.parse("2026-08-27T09:30")
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
        assertEquals(expectedLocal, local)
        assertEquals(
            1_787_794_200_000L,
            AndroidHostCommandRouter.parseDateTime("2026-08-27T09:30+08:00"),
        )
    }

    @Test fun busyBoxCommandNotFoundFailurePointsToShellHelp() {
        val original = ShellExecutionResult(
            ok = false,
            output = "ash: am: not found",
            exitCode = 127,
            privilege = "sandbox",
            error = "command exited with code 127",
            code = "COMMAND_FAILED",
        )
        val guided = ShellRuntime.withBusyBoxCommandNotFoundGuidance(original)
        assertEquals("COMMAND_NOT_FOUND", guided.code)
        assertTrue(guided.error?.contains("shell-help") == true)
        assertEquals(original.output, guided.output)

        val ordinaryFailure = original.copy(exitCode = 2)
        assertEquals(ordinaryFailure, ShellRuntime.withBusyBoxCommandNotFoundGuidance(ordinaryFailure))
        val explicit127 = original.copy(output = "", error = "command exited with code 127")
        assertEquals(explicit127, ShellRuntime.withBusyBoxCommandNotFoundGuidance(explicit127))
    }
}
