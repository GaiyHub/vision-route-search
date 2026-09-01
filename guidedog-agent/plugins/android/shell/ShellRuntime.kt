package com.watchdog.agent.shell

import android.content.Context
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

data class ShellExecutionResult(
    val ok: Boolean,
    val output: String = "",
    val exitCode: Int = -1,
    val durationMs: Long = 0,
    val timedOut: Boolean = false,
    val truncated: Boolean = false,
    val outputRef: String? = null,
    val privilege: String,
    val error: String? = null,
    val code: String? = null,
)

/** Isolated BusyBox runtime for shell_execute. */
object ShellRuntime {
    private const val TAG = "ShellRuntime"
    private const val BUSYBOX_LIBRARY = "libbusybox.so"
    private const val MAX_LOG_BYTES = 2 * 1024 * 1024
    private val executor = Executors.newSingleThreadExecutor()
    private val installLock = ReentrantLock()

    @Volatile private var currentProcess: java.lang.Process? = null

    fun executeAsync(
        context: Context,
        command: String,
        timeoutMs: Long,
        privilege: String,
        confirmed: Boolean,
        callback: (ShellExecutionResult) -> Unit,
    ) {
        executor.execute {
            val result = try {
                execute(context.applicationContext, command, timeoutMs, privilege, confirmed)
            } catch (t: Throwable) {
                Log.e(TAG, "shell execution failed", t)
                ShellExecutionResult(
                    ok = false,
                    privilege = privilege,
                    error = t.message ?: t.javaClass.simpleName,
                    code = "SHELL_EXECUTION_ERROR",
                )
            }
            callback(result)
        }
    }

    fun cancelCurrent() {
        currentProcess?.let { process ->
            runCatching { process.destroy() }
            runCatching { process.destroyForcibly() }
        }
    }

    internal fun execute(
        context: Context,
        command: String,
        timeoutMs: Long,
        privilege: String,
        @Suppress("UNUSED_PARAMETER") confirmed: Boolean,
    ): ShellExecutionResult {
        ShellCommandPolicy.validate(command, timeoutMs).let {
            if (!it.ok) return ShellExecutionResult(
                ok = false, privilege = privilege, error = it.error, code = "INVALID_ARGUMENT"
            )
        }
        return when (privilege) {
            "sandbox" -> AndroidHostCommandRouter.tryExecute(context, command)
                ?: executeSandbox(context, command, timeoutMs)
            else -> ShellExecutionResult(
                ok = false,
                privilege = privilege,
                error = "privilege must be sandbox",
                code = "INVALID_PRIVILEGE",
            )
        }
    }

    private fun executeSandbox(context: Context, command: String, timeoutMs: Long): ShellExecutionResult {
        val workspace = ensureSharedWorkspace(context)
        return executeBusyBox(context, workspace, command, timeoutMs)
    }

    private fun executeBusyBox(
        context: Context,
        workspace: File,
        command: String,
        timeoutMs: Long,
    ): ShellExecutionResult {
        val busybox = File(context.applicationInfo.nativeLibraryDir, BUSYBOX_LIBRARY)
        if (!busybox.exists() || !busybox.canExecute()) {
            return ShellExecutionResult(
                ok = false,
                privilege = "sandbox",
                error = "BusyBox runtime is unavailable at ${busybox.absolutePath}",
                code = "BUSYBOX_UNAVAILABLE",
            )
        }
        val outputFile = newOutputFile(workspace)
        val home = File(workspace, ".home").apply { mkdirs() }
        val tmp = File(context.cacheDir, "busybox-tmp").apply { mkdirs() }
        val builder = ProcessBuilder(
            busybox.absolutePath,
            "ash",
            "-c",
            rewriteWorkspacePath(command, workspace.absolutePath),
        ).directory(workspace).redirectErrorStream(true)
        builder.environment().apply {
            clear()
            put("HOME", home.absolutePath)
            put("PATH", context.applicationInfo.nativeLibraryDir)
            put("TMPDIR", tmp.absolutePath)
            put("TZ", TimeZone.getDefault().id)
            put("WORKSPACE", workspace.absolutePath)
            put("DOUPAO_SHELL_EXECUTOR", "busybox")
        }
        val process = try {
            builder.start()
        } catch (t: Throwable) {
            return ShellExecutionResult(
                ok = false,
                privilege = "sandbox",
                error = "failed to start BusyBox: ${t.message}",
                code = "BUSYBOX_START_FAILED",
            )
        }
        return withBusyBoxCommandNotFoundGuidance(
            runProcess(process, timeoutMs, outputFile, "sandbox"),
        )
    }

    internal fun rewriteWorkspacePath(command: String, physicalWorkspace: String): String =
        command.replace("/workspace", physicalWorkspace)

    internal fun withBusyBoxCommandNotFoundGuidance(result: ShellExecutionResult): ShellExecutionResult {
        if (
            result.timedOut ||
            result.exitCode != 127 ||
            !result.output.contains("not found", ignoreCase = true)
        ) return result
        return result.copy(
            error = "Command is unavailable in this BusyBox environment. Run shell-help first to see the supported shell and Android host commands, then choose a command from that output.",
            code = "COMMAND_NOT_FOUND",
        )
    }

    private fun newOutputFile(workspace: File): File {
        val outputDir = File(workspace, ".doupao/outputs").apply { mkdirs() }
        return File(outputDir, "shell-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}.log")
    }

    private fun ensureSharedWorkspace(context: Context): File = installLock.withLock {
        val shellBase = File(context.filesDir, "shell").apply { mkdirs() }
        val workspace = File(shellBase, "workspace").apply { mkdirs() }
        val migrationMarker = File(workspace, ".doupao/workspace-v2-migrated")
        val legacyRootfs = File(shellBase, "rootfs")
        if (!migrationMarker.isFile) {
            val legacyWorkspace = File(legacyRootfs, "workspace")
            if (legacyWorkspace.isDirectory) {
                legacyWorkspace.copyRecursively(workspace, overwrite = false)
            }
            migrationMarker.parentFile?.mkdirs()
            migrationMarker.writeText("1\n")
        }
        // An upgrade from the former Alpine/PRoot runtime may leave an
        // extracted rootfs behind. Preserve its workspace above, then remove
        // the obsolete runtime data and interrupted installation directory.
        legacyRootfs.deleteRecursively()
        File(shellBase, "rootfs.installing").deleteRecursively()
        File(context.cacheDir, "proot-tmp").deleteRecursively()
        workspace
    }

    private fun runProcess(
        process: java.lang.Process,
        timeoutMs: Long,
        outputFile: File,
        privilege: String,
        explicitRef: String? = null,
    ): ShellExecutionResult {
        currentProcess = process
        val started = System.currentTimeMillis()
        val collector = BoundedOutputCollector(outputFile, MAX_LOG_BYTES)
        val reader = Thread({ process.inputStream.use(collector::consume) }, "doupao-shell-output").apply {
            isDaemon = true
            start()
        }
        var timedOut = false
        val exitCode = try {
            if (process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) {
                process.exitValue()
            } else {
                timedOut = true
                process.destroy()
                if (!process.waitFor(500, TimeUnit.MILLISECONDS)) process.destroyForcibly()
                124
            }
        } finally {
            reader.join(2_000)
            currentProcess = null
        }
        val preview = collector.preview()
        val ref = explicitRef ?: "/workspace/.doupao/outputs/${outputFile.name}"
        return ShellExecutionResult(
            ok = exitCode == 0 && !timedOut,
            output = preview,
            exitCode = exitCode,
            durationMs = System.currentTimeMillis() - started,
            timedOut = timedOut,
            truncated = collector.isTruncated,
            outputRef = if (collector.totalBytes > 0) ref else null,
            privilege = privilege,
            error = when {
                timedOut -> "command timed out after ${timeoutMs}ms"
                exitCode != 0 -> "command exited with code $exitCode"
                else -> null
            },
            code = if (timedOut) "COMMAND_TIMEOUT" else if (exitCode != 0) "COMMAND_FAILED" else null,
        )
    }

}

internal class BoundedOutputCollector(private val file: File, private val maxFileBytes: Int) {
    private val head = ByteArrayOutputStream()
    private val tail = ByteArray(8 * 1024)
    private var tailPos = 0
    private var tailSize = 0
    var totalBytes: Long = 0
        private set
    var storedBytes: Long = 0
        private set
    val isTruncated: Boolean get() = totalBytes > head.size() + tailSize || totalBytes > maxFileBytes

    fun consume(input: InputStream) {
        file.parentFile?.mkdirs()
        file.outputStream().use { output ->
            val buffer = ByteArray(8 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                totalBytes += read
                if (head.size() < 4 * 1024) {
                    val count = minOf(read, 4 * 1024 - head.size())
                    head.write(buffer, 0, count)
                }
                for (i in 0 until read) {
                    tail[tailPos] = buffer[i]
                    tailPos = (tailPos + 1) % tail.size
                    if (tailSize < tail.size) tailSize++
                }
                val writable = minOf(read.toLong(), maxFileBytes - storedBytes).coerceAtLeast(0).toInt()
                if (writable > 0) {
                    output.write(buffer, 0, writable)
                    storedBytes += writable
                }
            }
        }
    }

    fun preview(): String {
        if (totalBytes == 0L) return ""
        val headText = head.toByteArray().toString(Charsets.UTF_8)
        val orderedTail = ByteArray(tailSize)
        val start = if (tailSize == tail.size) tailPos else 0
        for (i in 0 until tailSize) orderedTail[i] = tail[(start + i) % tail.size]
        if (totalBytes <= tailSize) return orderedTail.toString(Charsets.UTF_8)
        val overlap = (head.size() + tailSize - totalBytes).coerceAtLeast(0).toInt()
        val tailText = orderedTail.copyOfRange(overlap, orderedTail.size).toString(Charsets.UTF_8)
        val omitted = totalBytes - head.size() - (tailSize - overlap)
        return if (omitted > 0) {
            "$headText\n… [$omitted bytes omitted] …\n$tailText"
        } else {
            headText + tailText
        }
    }
}
