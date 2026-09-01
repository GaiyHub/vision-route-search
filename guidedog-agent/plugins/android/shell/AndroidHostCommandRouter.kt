package com.watchdog.agent.shell

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Looper
import android.os.StatFs
import android.os.SystemClock
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Host-owned Android commands exposed through shell_execute.
 *
 * The commands look like executables to the model, but run through Android
 * framework APIs rather than inside BusyBox.
 * A complete, single command is parsed here and dispatched to Android framework
 * APIs. Linux commands and compound shell expressions continue through the
 * isolated BusyBox runtime unchanged.
 */
object AndroidHostCommandRouter {
    private const val PRIVILEGE = "android_host"
    private const val NOTIFICATION_CHANNEL = "doupao_shell_notifications"
    private const val NOTIFICATION_BASE_ID = 8_100
    private const val LOCATION_TIMEOUT_SECONDS = 8L
    private const val MAX_CACHED_LOCATION_AGE_MS = 10 * 60 * 1_000L

    private val commands = setOf(
        "shell-help",
        "android-device",
        "android-clipboard",
        "android-open",
        "android-communicate",
        "android-map",
        "android-location",
        "android-settings",
        "android-calendar",
        "android-share",
        "android-alarm",
        "android-notification",
        "android-speak",
    )

    /** Returns null when [command] is an ordinary sandbox command. */
    fun tryExecute(context: Context, command: String): ShellExecutionResult? {
        val started = System.currentTimeMillis()
        val parsed = tokenize(command)
        val commandName = parsed.tokens.firstOrNull()
        if (commandName == null || commandName !in commands) {
            // Reserve the android-* namespace so misspellings cannot silently
            // fall through to BusyBox's generic "not found" response.
            if (command.trimStart().startsWith("android-")) {
                return result(
                    ok = false,
                    output = "",
                    started = started,
                    error = "Unsupported Android host command '$commandName'. Run shell-help first and use one of the listed android-* host commands.",
                    code = "ANDROID_COMMAND_NOT_FOUND",
                    exitCode = 127,
                )
            }
            return null
        }
        if (parsed.error != null) {
            return result(false, "", started, parsed.error, "INVALID_ANDROID_COMMAND", 2)
        }
        if (parsed.hasShellOperators) {
            return result(
                false,
                "",
                started,
                "Android host commands must be invoked as a single command; pipes, redirects and command chaining are not supported",
                "UNSUPPORTED_ANDROID_COMMAND_SYNTAX",
                2,
            )
        }

        return try {
            val args = parsed.tokens.drop(1)
            val output = when (commandName) {
                "shell-help" -> shellHelp()
                "android-device" -> device(context, args)
                "android-clipboard" -> clipboard(context, args)
                "android-open" -> open(context, args)
                "android-communicate" -> communicate(context, args)
                "android-map" -> map(context, args)
                "android-location" -> location(context, args)
                "android-settings" -> settings(context, args)
                "android-calendar" -> calendar(context, args)
                "android-share" -> share(context, args)
                "android-alarm" -> alarm(context, args)
                "android-notification" -> notification(context, args)
                "android-speak" -> speak(context, args)
                else -> error("unreachable")
            }
            result(true, output, started, exitCode = 0)
        } catch (e: HostCommandException) {
            result(false, "", started, e.message, e.code, e.exitCode)
        } catch (t: Throwable) {
            result(
                false,
                "",
                started,
                t.message ?: t.javaClass.simpleName,
                "ANDROID_COMMAND_FAILED",
                1,
            )
        }
    }

    private fun device(context: Context, args: List<String>): String {
        if (args.any { it == "--help" || it == "-h" }) return deviceHelp()
        val sub = args.firstOrNull() ?: "all"
        val data = when (sub) {
            "info" -> deviceInfo(context)
            "battery" -> batteryInfo(context)
            "storage" -> storageInfo(context)
            "all" -> JSONObject()
                .put("device", deviceInfo(context))
                .put("battery", batteryInfo(context))
                .put("storage", storageInfo(context))
            else -> usage("android-device: unknown subcommand '$sub'\n${deviceHelp()}")
        }
        return data.toString(2) + "\n"
    }

    private fun deviceInfo(context: Context): JSONObject {
        val activityManager = context.getSystemService(android.app.ActivityManager::class.java)
        val memory = android.app.ActivityManager.MemoryInfo().also(activityManager::getMemoryInfo)
        return JSONObject()
            .put("manufacturer", Build.MANUFACTURER.orUnknown())
            .put("model", Build.MODEL.orUnknown())
            .put("brand", Build.BRAND.orUnknown())
            .put("device", Build.DEVICE.orUnknown())
            .put("product", Build.PRODUCT.orUnknown())
            .put("android_version", Build.VERSION.RELEASE.orUnknown())
            .put("sdk_level", Build.VERSION.SDK_INT)
            .put("security_patch", Build.VERSION.SECURITY_PATCH.orUnknown())
            .put("build_id", Build.ID.orUnknown())
            .put("board", Build.BOARD.orUnknown())
            .put("hardware", Build.HARDWARE.orUnknown())
            .put("supported_abis", JSONArray(Build.SUPPORTED_ABIS.toList()))
            .put("available_processors", Runtime.getRuntime().availableProcessors())
            .put("total_memory_mb", memory.totalMem / (1024 * 1024))
            .put("available_memory_mb", memory.availMem / (1024 * 1024))
            .put("low_memory", memory.lowMemory)
    }

    private fun batteryInfo(context: Context): JSONObject {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: fail("BATTERY_UNAVAILABLE", "Battery information is unavailable")
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val temperature = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1)
        return JSONObject()
            .put("level_percent", if (level >= 0 && scale > 0) level * 100 / scale else JSONObject.NULL)
            .put(
                "charging",
                status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL,
            )
            .put("status", when (status) {
                BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
                BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
                BatteryManager.BATTERY_STATUS_FULL -> "full"
                BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
                else -> "unknown"
            })
            .put("power_source", when (intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)) {
                BatteryManager.BATTERY_PLUGGED_AC -> "ac"
                BatteryManager.BATTERY_PLUGGED_USB -> "usb"
                BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
                else -> "none"
            })
            .put("temperature_celsius", if (temperature >= 0) temperature / 10.0 else JSONObject.NULL)
    }

    private fun storageInfo(context: Context): JSONObject {
        val stat = StatFs(Environment.getDataDirectory().path)
        return JSONObject()
            .put("internal_total_bytes", stat.totalBytes)
            .put("internal_available_bytes", stat.availableBytes)
            .put("app_files_bytes", directoryBytes(context.filesDir))
            .put("app_cache_bytes", directoryBytes(context.cacheDir))
    }

    private fun clipboard(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) {
            return "android-clipboard get | set <text> | clear\n"
        }
        val manager = context.getSystemService(ClipboardManager::class.java)
        return when (args.first()) {
            "get" -> {
                val clip = manager.primaryClip
                val values = JSONArray()
                if (clip != null) {
                    for (index in 0 until clip.itemCount) {
                        values.put(clip.getItemAt(index).coerceToText(context)?.toString() ?: "")
                    }
                }
                JSONObject().put("items", values).put("count", values.length()).toString(2) + "\n"
            }
            "set" -> {
                val text = args.drop(1).joinToString(" ")
                if (text.isEmpty()) usage("android-clipboard set requires text")
                manager.setPrimaryClip(ClipData.newPlainText("豆泡", text))
                JSONObject().put("written", true).put("length", text.length).toString() + "\n"
            }
            "clear" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) manager.clearPrimaryClip()
                else manager.setPrimaryClip(ClipData.newPlainText("", ""))
                JSONObject().put("cleared", true).toString() + "\n"
            }
            else -> usage("android-clipboard: unknown subcommand '${args.first()}'")
        }
    }

    private fun open(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) {
            return openHelp()
        }
        val raw = args.joinToString(" ")
        val uri = Uri.parse(raw)
        if (uri.scheme.isNullOrBlank()) usage("android-open requires a URI with a scheme")
        val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(context.packageManager) == null) {
            fail("NO_ACTIVITY", "No Android app can open this URI")
        }
        context.startActivity(intent)
        return JSONObject().put("opened", raw).toString() + "\n"
    }

    private fun communicate(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) {
            return communicateHelp()
        }
        val sub = args.first()
        val tail = args.drop(1)
        val intent = when (sub) {
            "sms" -> {
                val recipient = requiredOption(tail, "--to")
                Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", recipient, null)).apply {
                    option(tail, "--body")?.let { putExtra("sms_body", it) }
                }
            }
            "dial" -> {
                val number = requiredOption(tail, "--number")
                Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))
            }
            "email" -> {
                val recipient = requiredOption(tail, "--to")
                Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", recipient, null)).apply {
                    option(tail, "--subject")?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
                    option(tail, "--body")?.let { putExtra(Intent.EXTRA_TEXT, it) }
                }
            }
            else -> usage("android-communicate: unknown subcommand '$sub'\n${communicateHelp()}")
        }
        return launchExternal(context, intent, "communicate_$sub", needsUserCommit = true)
    }

    private fun map(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) return mapHelp()
        val sub = args.first()
        val tail = args.drop(1)
        val uri = when (sub) {
            "search" -> {
                val query = requiredOption(tail, "--query")
                Uri.parse("geo:0,0?q=${Uri.encode(query)}")
            }
            "show" -> {
                val latitude = requiredOption(tail, "--latitude").toDoubleOrNull()
                    ?: usage("--latitude must be a number")
                val longitude = requiredOption(tail, "--longitude").toDoubleOrNull()
                    ?: usage("--longitude must be a number")
                if (latitude !in -90.0..90.0) usage("--latitude must be between -90 and 90")
                if (longitude !in -180.0..180.0) usage("--longitude must be between -180 and 180")
                val label = option(tail, "--label")
                val query = if (label.isNullOrBlank()) "$latitude,$longitude" else "$latitude,$longitude($label)"
                Uri.parse("geo:$latitude,$longitude?q=${Uri.encode(query)}")
            }
            else -> usage("android-map: unknown subcommand '$sub'\n${mapHelp()}")
        }
        return launchExternal(
            context,
            Intent(Intent.ACTION_VIEW, uri),
            "map_$sub",
            needsUserCommit = false,
        )
    }

    private fun location(context: Context, args: List<String>): String {
        if (args.any { it == "--help" || it == "-h" }) return locationHelp()
        val sub = args.firstOrNull() ?: usage("android-location requires a subcommand\n${locationHelp()}")
        if (sub != "current" || args.size != 1) {
            usage("android-location: unknown arguments '${args.joinToString(" ")}'\n${locationHelp()}")
        }

        val coarseGranted = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val fineGranted = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!coarseGranted && !fineGranted) {
            fail(
                "LOCATION_PERMISSION_REQUIRED",
                "Location permission is required. Return to DouPao and authorize location access, then retry the exact command.",
            )
        }

        val manager = context.getSystemService(LocationManager::class.java)
        val enabledProviders = manager.getProviders(true)
            .filter { it != LocationManager.PASSIVE_PROVIDER }
            .filter { fineGranted || it != LocationManager.GPS_PROVIDER }
        if (enabledProviders.isEmpty()) {
            fail("LOCATION_DISABLED", "Android location services are disabled or no location provider is available")
        }

        val live = requestCurrentLocation(manager, enabledProviders)
        val resolved = live ?: newestUsableLastKnownLocation(manager, enabledProviders)
            ?: fail(
                "LOCATION_UNAVAILABLE",
                "Unable to obtain a current location. Move to an area with a location signal and retry.",
            )
        val cached = live == null
        val ageMs = locationAgeMs(resolved)
        if (cached && ageMs > MAX_CACHED_LOCATION_AGE_MS) {
            fail(
                "LOCATION_STALE",
                "Only a stale location fix is available (${ageMs / 1_000}s old); it was not returned as the current location.",
            )
        }

        return JSONObject()
            .put("latitude", resolved.latitude)
            .put("longitude", resolved.longitude)
            .put("accuracy_meters", if (resolved.hasAccuracy()) resolved.accuracy.toDouble() else JSONObject.NULL)
            .put("provider", resolved.provider ?: "unknown")
            .put("timestamp", Instant.ofEpochMilli(resolved.time).toString())
            .put("age_ms", ageMs)
            .put("cached", cached)
            .put("is_mock", isMockLocation(resolved))
            .toString(2) + "\n"
    }

    private fun isMockLocation(location: Location): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            location.isMock
        } else {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        }

    @Suppress("DEPRECATION")
    private fun requestCurrentLocation(
        manager: LocationManager,
        providers: List<String>,
    ): Location? {
        val latch = CountDownLatch(1)
        var location: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(value: Location) {
                location = value
                latch.countDown()
            }

            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
            @Deprecated("Deprecated in Android")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        try {
            providers.forEach { provider ->
                runCatching { manager.requestSingleUpdate(provider, listener, Looper.getMainLooper()) }
            }
            latch.await(LOCATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } finally {
            runCatching { manager.removeUpdates(listener) }
        }
        return location
    }

    private fun newestUsableLastKnownLocation(
        manager: LocationManager,
        providers: List<String>,
    ): Location? = providers.mapNotNull { provider ->
        runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
    }.minWithOrNull(
        compareBy<Location> { locationAgeMs(it) }
            .thenBy { if (it.hasAccuracy()) it.accuracy else Float.MAX_VALUE },
    )

    private fun locationAgeMs(location: Location): Long {
        val elapsedNanos = location.elapsedRealtimeNanos
        return if (elapsedNanos > 0L) {
            ((SystemClock.elapsedRealtimeNanos() - elapsedNanos) / 1_000_000L).coerceAtLeast(0L)
        } else {
            (System.currentTimeMillis() - location.time).coerceAtLeast(0L)
        }
    }

    private fun settings(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) return settingsHelp()
        if (args.first() == "list") return settingsTargets() + "\n"
        if (args.first() != "open") usage("android-settings requires 'list' or 'open <target>'")
        val target = args.getOrNull(1) ?: usage("android-settings open requires a target")
        val tail = args.drop(2)
        val intent = when (target) {
            "main" -> Intent(Settings.ACTION_SETTINGS)
            "wifi" -> Intent(Settings.ACTION_WIFI_SETTINGS)
            "bluetooth" -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            "display" -> Intent(Settings.ACTION_DISPLAY_SETTINGS)
            "sound" -> Intent(Settings.ACTION_SOUND_SETTINGS)
            "location" -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            "battery" -> Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
            "notification-listener" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            "app-details" -> Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                packageUri(requiredOption(tail, "--package")),
            )
            "app-notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, requiredOption(tail, "--package"))
            }
            else -> usage("Unknown settings target '$target'. Run android-settings list")
        }
        return launchExternal(context, intent, "settings_$target", needsUserCommit = false)
    }

    private fun calendar(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) return calendarHelp()
        if (args.first() != "insert") usage("android-calendar: unknown subcommand '${args.first()}'")
        val tail = args.drop(1)
        val title = requiredOption(tail, "--title")
        val start = parseDateTime(requiredOption(tail, "--start"), "--start")
        val end = option(tail, "--end")?.let { parseDateTime(it, "--end") }
        if (end != null && end <= start) usage("--end must be later than --start")
        val intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).apply {
            putExtra(CalendarContract.Events.TITLE, title)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
            end?.let { putExtra(CalendarContract.EXTRA_EVENT_END_TIME, it) }
            option(tail, "--location")?.let { putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
            option(tail, "--description")?.let { putExtra(CalendarContract.Events.DESCRIPTION, it) }
        }
        return launchExternal(context, intent, "calendar_insert", needsUserCommit = true)
    }

    private fun share(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) return shareHelp()
        if (args.first() != "text") usage("android-share: unknown subcommand '${args.first()}'")
        val tail = args.drop(1)
        val text = requiredOption(tail, "--text")
        val title = option(tail, "--title") ?: "分享"
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            option(tail, "--subject")?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
        }
        if (send.resolveActivity(context.packageManager) == null) {
            fail("NO_ACTIVITY", "No Android app can share text")
        }
        val chooser = Intent.createChooser(send, title)
        return launchExternal(context, chooser, "share_text", needsUserCommit = true)
    }

    private fun alarm(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) {
            return "android-alarm schedule <HH:MM> [--label <text>] | timer <seconds> [--label <text>] | open\n"
        }
        val sub = args.first()
        val label = option(args.drop(1), "--label") ?: "豆泡"
        val intent = when (sub) {
            "open" -> Intent(AlarmClock.ACTION_SHOW_ALARMS)
            "schedule" -> {
                val time = args.getOrNull(1) ?: usage("android-alarm schedule requires HH:MM")
                val match = Regex("^(\\d{1,2}):(\\d{2})$").matchEntire(time)
                    ?: usage("time must use HH:MM")
                val hour = match.groupValues[1].toInt()
                val minute = match.groupValues[2].toInt()
                if (hour !in 0..23 || minute !in 0..59) usage("time must be a valid 24-hour HH:MM")
                Intent(AlarmClock.ACTION_SET_ALARM)
                    .putExtra(AlarmClock.EXTRA_HOUR, hour)
                    .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                    .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            }
            "timer" -> {
                val seconds = args.getOrNull(1)?.toIntOrNull()
                    ?: usage("android-alarm timer requires integer seconds")
                if (seconds <= 0) usage("timer seconds must be positive")
                Intent(AlarmClock.ACTION_SET_TIMER)
                    .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                    .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            }
            else -> usage("android-alarm: unknown subcommand '$sub'")
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(context.packageManager) == null) {
            fail("NO_CLOCK_APP", "No compatible Android Clock app is installed")
        }
        // Deliberately do not set EXTRA_SKIP_UI: Android shows the Clock app so
        // the user retains control over this external state change.
        context.startActivity(intent)
        return JSONObject().put("opened_clock", true).put("action", sub).toString() + "\n"
    }

    private fun notification(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) {
            return "android-notification send --title <text> [--body <text>] | clear\n"
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        return when (args.first()) {
            "clear" -> {
                for (id in NOTIFICATION_BASE_ID until NOTIFICATION_BASE_ID + 100) manager.cancel(id)
                JSONObject().put("cleared", true).toString() + "\n"
            }
            "send" -> {
                val title = option(args.drop(1), "--title")
                    ?: usage("android-notification send requires --title")
                val body = option(args.drop(1), "--body") ?: ""
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    manager.createNotificationChannel(
                        NotificationChannel(
                            NOTIFICATION_CHANNEL,
                            "豆泡创建的通知",
                            NotificationManager.IMPORTANCE_DEFAULT,
                        ),
                    )
                }
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                val contentIntent = launch?.let {
                    PendingIntent.getActivity(
                        context,
                        0,
                        it,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                }
                val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Notification.Builder(context, NOTIFICATION_CHANNEL)
                } else {
                    @Suppress("DEPRECATION") Notification.Builder(context)
                }
                builder.setContentTitle(title)
                    .setContentText(body)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setAutoCancel(true)
                contentIntent?.let(builder::setContentIntent)
                val id = NOTIFICATION_BASE_ID + (System.currentTimeMillis() % 100).toInt()
                manager.notify(id, builder.build())
                JSONObject().put("sent", true).put("id", id).toString() + "\n"
            }
            else -> usage("android-notification: unknown subcommand '${args.first()}'")
        }
    }

    private fun speak(context: Context, args: List<String>): String {
        if (args.isEmpty() || args.any { it == "--help" || it == "-h" }) {
            return "android-speak <text>\n"
        }
        val text = args.joinToString(" ")
        val initialized = CountDownLatch(1)
        var initStatus = TextToSpeech.ERROR
        lateinit var tts: TextToSpeech
        tts = TextToSpeech(context.applicationContext) {
            initStatus = it
            initialized.countDown()
        }
        if (!initialized.await(5, TimeUnit.SECONDS) || initStatus != TextToSpeech.SUCCESS) {
            tts.shutdown()
            fail("TTS_UNAVAILABLE", "Android text-to-speech engine is unavailable")
        }
        val localeResult = tts.setLanguage(Locale.getDefault())
        if (localeResult == TextToSpeech.LANG_MISSING_DATA || localeResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.shutdown()
            fail("TTS_LANGUAGE_UNAVAILABLE", "The current language is not supported by the TTS engine")
        }
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) = tts.shutdown()
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = tts.shutdown()
        })
        val status = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "doupao-${System.currentTimeMillis()}")
        if (status == TextToSpeech.ERROR) {
            tts.shutdown()
            fail("TTS_FAILED", "Text-to-speech playback could not start")
        }
        return JSONObject().put("speaking", true).put("length", text.length).toString() + "\n"
    }

    private fun shellHelp(): String = """豆泡 Shell uses BusyBox and selected Android host commands.

Sandbox commands:

  Files: pwd, ls, cat, head, tail, cp, mv, mkdir, rm, find
  Text: grep, sed, awk, sort, uniq, wc, cut, tr, xargs, printf
  Data: base64, sha256sum, tar, gzip, gunzip
  System: date, env, uname, du, ps
  Network: wget, ping, nc, ftpget

HTTP examples:
  wget -qO- 'https://example.com'
  wget -O output.json 'https://example.com/data.json'

Android host commands:

  android-device [all|info|battery|storage]
  android-clipboard get | set <text> | clear
  android-open <url-or-system-uri>
  android-communicate sms|dial|email [options]
  android-map search|show [options]
  android-location current
  android-settings list | open <target> [options]
  android-calendar insert [options]
  android-share text [options]
  android-alarm schedule <HH:MM> [--label <text>] | timer <seconds> [--label <text>] | open
  android-notification send --title <text> [--body <text>] | clear
  android-speak <text>

Use `<command> --help` for command-specific options. BusyBox wget supports HTTPS
but not long options. curl, package managers, Android Shell, adb, am, pm, and
Shizuku commands are not available. UI automation and browser work use their
dedicated tools.
"""

    private fun deviceHelp() = "android-device [all|info|battery|storage]"

    private fun openHelp() = """android-open — open a URL or system URI with its Android app

Usage:
  android-open <url-or-system-uri>

Supports http(s), tel, mailto, geo, market, intent, sms, smsto, and other
schemes handled by an installed app.

To open the SMS composer with recipient and message prefilled:
  android-open 'smsto:<phone>?body=<percent-encoded-message>'

This opens the user's SMS app; it does not send the message automatically.
"""

    private fun communicateHelp() = """android-communicate — open a communication composer

Usage:
  android-communicate sms --to <phone> [--body <text>]
  android-communicate dial --number <phone>
  android-communicate email --to <address> [--subject <text>] [--body <text>]

These commands only open and prefill the corresponding Android app. They do
not send a message, place a call, or commit any external action.
"""

    private fun mapHelp() = """android-map — open a location in an installed map app

Usage:
  android-map search --query <place-or-keywords>
  android-map show --latitude <number> --longitude <number> [--label <text>]
"""

    private fun locationHelp() = """android-location — query the device's current geographic coordinates

Usage:
  android-location current

Returns latitude, longitude, accuracy, provider, timestamp and fix age as JSON.
Location permission and Android location services must be enabled.
"""

    private fun settingsHelp() = """android-settings — open a deterministic Android Settings page

Usage:
  android-settings list
  android-settings open <target>
  android-settings open app-details --package <package-name>
  android-settings open app-notifications --package <package-name>

Run android-settings list for supported targets.
"""

    private fun settingsTargets() = JSONObject()
        .put(
            "targets",
            JSONArray(
                listOf(
                    "main",
                    "wifi",
                    "bluetooth",
                    "accessibility",
                    "display",
                    "sound",
                    "location",
                    "battery",
                    "notification-listener",
                    "app-details",
                    "app-notifications",
                ),
            ),
        )
        .toString(2)

    private fun calendarHelp() = """android-calendar — open a prefilled calendar event editor

Usage:
  android-calendar insert --title <text> --start <ISO-date-time> [--end <ISO-date-time>] [--location <text>] [--description <text>]

Date-time examples: 2026-08-27T09:30 or 2026-08-27T09:30+08:00. The event is
not saved until the user confirms it in the calendar app.
"""

    private fun shareHelp() = """android-share — open the Android share sheet

Usage:
  android-share text --text <text> [--title <chooser-title>] [--subject <text>]

Opening the share sheet does not send or publish the content.
"""

    private fun launchExternal(
        context: Context,
        intent: Intent,
        action: String,
        needsUserCommit: Boolean,
    ): String {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val handler = intent.resolveActivity(context.packageManager)
            ?: fail("NO_ACTIVITY", "No installed Android app can handle '$action'")
        context.startActivity(intent)
        return JSONObject()
            .put("action", action)
            .put("accepted", true)
            .put("handler_package", handler.packageName)
            .put("needs_user_commit", needsUserCommit)
            .put("completed", false)
            .toString() + "\n"
    }

    private fun packageUri(packageName: String): Uri {
        if (!Regex("^[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+$").matches(packageName)) {
            usage("--package must be a valid Android package name")
        }
        return Uri.parse("package:$packageName")
    }

    internal fun parseDateTime(raw: String, optionName: String = "date-time"): Long {
        val instant = runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching {
                LocalDateTime.parse(raw).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            }.getOrNull()
        return instant ?: usage("$optionName must be an ISO date-time such as 2026-08-27T09:30")
    }

    private fun option(args: List<String>, name: String): String? {
        val index = args.indexOf(name)
        if (index < 0) return null
        val value = args.getOrNull(index + 1)
        if (value.isNullOrBlank() || value.startsWith("--")) usage("$name requires a value")
        return value
    }

    private fun requiredOption(args: List<String>, name: String): String =
        option(args, name) ?: usage("missing required option $name")

    private fun directoryBytes(root: java.io.File): Long {
        if (!root.exists()) return 0
        var total = 0L
        root.walkTopDown().forEach { if (it.isFile) total += it.length() }
        return total
    }

    private fun String?.orUnknown(): String = this?.takeIf(String::isNotBlank) ?: "unknown"

    private fun usage(message: String): Nothing = throw HostCommandException("INVALID_ARGUMENT", message, 2)

    private fun fail(code: String, message: String): Nothing = throw HostCommandException(code, message, 1)

    private fun result(
        ok: Boolean,
        output: String,
        started: Long,
        error: String? = null,
        code: String? = null,
        exitCode: Int,
    ) = ShellExecutionResult(
        ok = ok,
        output = output,
        exitCode = exitCode,
        durationMs = System.currentTimeMillis() - started,
        privilege = PRIVILEGE,
        error = error,
        code = code,
    )

    internal data class ParsedCommand(
        val tokens: List<String>,
        val hasShellOperators: Boolean,
        val error: String? = null,
    )

    /** Minimal shell-like tokenizer: quoting is supported, evaluation is not. */
    internal fun tokenize(command: String): ParsedCommand {
        val tokens = mutableListOf<String>()
        val current = StringBuilder()
        var quote: Char? = null
        var escaping = false
        var operator = false

        fun flush() {
            if (current.isNotEmpty()) {
                tokens += current.toString()
                current.setLength(0)
            }
        }

        for (char in command.trim()) {
            if (escaping) {
                current.append(char)
                escaping = false
                continue
            }
            if (char == '\\' && quote != '\'') {
                escaping = true
                continue
            }
            if (quote != null) {
                if (char == quote) quote = null else current.append(char)
                continue
            }
            if (char == '\'' || char == '"') {
                quote = char
            } else if (char.isWhitespace()) {
                flush()
            } else if (char in charArrayOf('|', ';', '&', '>', '<', '`', '\n', '\r')) {
                operator = true
                current.append(char)
            } else {
                current.append(char)
            }
        }
        if (escaping) return ParsedCommand(tokens, operator, "unfinished escape sequence")
        if (quote != null) return ParsedCommand(tokens, operator, "unterminated quote")
        flush()
        return ParsedCommand(tokens, operator)
    }

    private class HostCommandException(
        val code: String,
        override val message: String,
        val exitCode: Int,
    ) : RuntimeException(message)
}
