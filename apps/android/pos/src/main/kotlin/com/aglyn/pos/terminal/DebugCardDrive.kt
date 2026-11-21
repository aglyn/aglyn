package com.aglyn.pos.terminal

import com.aglyn.hardware.TerminalError
import com.aglyn.hardware.TerminalPaymentPort
import com.aglyn.hardware.TerminalResult
import kotlinx.coroutines.delay

/**
 * Debug builds only, on the SDK's simulated reader: lets an emulator drive what a simulated reader never does, as
 * Apple's `-AglynSimulateCardTimeout` and `-AglynSimulateProcessingSeconds` do on a simulator (Apple 5.8, 5.9).
 * Set with `adb shell setprop debug.aglyn.card_timeout 1` and `adb shell setprop debug.aglyn.processing_seconds 6`.
 */
data class DebugCardDrive(val timeout: Boolean, val processingSeconds: Int) {
  companion object {
    /** Read from the emulator's system properties; null when neither is set. */
    fun fromSystemProperties(): DebugCardDrive? {
      fun prop(name: String): String = runCatching {
        Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, name) as String
      }.getOrDefault("")
      val drive = DebugCardDrive(
        timeout = prop("debug.aglyn.card_timeout") == "1",
        processingSeconds = prop("debug.aglyn.processing_seconds").toIntOrNull()?.coerceIn(0, 30) ?: 0,
      )
      return drive.takeIf { it.timeout || it.processingSeconds > 0 }
    }
  }
}

/** [port] with the debug drive applied: the card read times out, or the processing step is held after the confirm. */
internal class DebugDrivenPort(private val port: TerminalPaymentPort, private val drive: DebugCardDrive) : TerminalPaymentPort {
  override suspend fun retrieve(clientSecret: String): TerminalResult = port.retrieve(clientSecret)

  override suspend fun collect(intentId: String, skipTipping: Boolean): TerminalResult =
    if (drive.timeout) TerminalResult.Error(TerminalError("CARD_READ_TIMED_OUT", "Reading a card timed out.")) else port.collect(intentId, skipTipping)

  /** The hold comes after the SDK's confirm: holding before it made the simulated reader's confirm fail ("Unexpected failure"). */
  override suspend fun confirm(intentId: String): TerminalResult {
    val result = port.confirm(intentId)
    if (drive.processingSeconds > 0) delay(drive.processingSeconds * 1_000L)
    return result
  }
}
