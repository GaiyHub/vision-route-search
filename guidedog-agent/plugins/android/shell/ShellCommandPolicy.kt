package com.watchdog.agent.shell

/** Host-owned policy for shell_execute. Model instructions cannot bypass it. */
object ShellCommandPolicy {
    const val MAX_COMMAND_LENGTH = 1000
    const val DEFAULT_TIMEOUT_MS = 60_000L
    const val MIN_TIMEOUT_MS = 1_000L
    const val MAX_TIMEOUT_MS = 900_000L

    data class Validation(val ok: Boolean, val error: String? = null)

    fun validate(command: String, timeoutMs: Long): Validation {
        if (command.isBlank()) return Validation(false, "command must not be empty")
        if (command.length > MAX_COMMAND_LENGTH) {
            return Validation(false, "command exceeds $MAX_COMMAND_LENGTH characters")
        }
        if ('\u0000' in command) return Validation(false, "command contains a NUL byte")
        if (timeoutMs !in MIN_TIMEOUT_MS..MAX_TIMEOUT_MS) {
            return Validation(false, "timeout_ms must be between $MIN_TIMEOUT_MS and $MAX_TIMEOUT_MS")
        }
        return Validation(true)
    }
}
