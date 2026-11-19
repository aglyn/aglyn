package com.aglyn.hardware

/**
 * Whether this device's Stripe Terminal readers are the SDK's simulated ones
 * or real ones. As on Apple, the server decides, never the build: the site's
 * reader session ([CardReaderSession.testMode], the connection-token route's
 * answer) is test mode exactly when the server's Stripe key is a test key,
 * and a test key only works with simulated readers, a live key only with real
 * ones. Until a session is known there is no mode, and no reader search.
 */
enum class TerminalReaderMode {
  SIMULATED,
  LIVE,
  ;

  val simulated: Boolean get() = this == SIMULATED

  companion object {
    /** The mode for a session's test flag; null (no session yet) means do not search for readers. */
    fun of(testMode: Boolean?): TerminalReaderMode? = when (testMode) {
      true -> SIMULATED
      false -> LIVE
      null -> null
    }

    /** Tap to Pay is offered where the device can take it, or anywhere in test mode (the SDK's simulated phone). */
    fun offersTapToPay(deviceCanTapToPay: Boolean, testMode: Boolean?): Boolean = deviceCanTapToPay || testMode == true
  }
}

/**
 * What a site's reader session last said online, kept so a reader can start
 * with no connection (AGL-4039): its Terminal Location, the merchant name and
 * the session's test mode. A record saved before the mode was kept reads as
 * unknown, so the reader goes online once before it starts.
 */
data class RememberedReaderSite(val locationId: String, val merchantDisplayName: String, val testMode: Boolean) {
  fun encode(): String = "$locationId\t$merchantDisplayName\t$testMode"

  companion object {
    fun of(session: CardReaderSession) = RememberedReaderSite(session.locationId, session.merchantDisplayName, session.testMode)

    fun decode(raw: String?): RememberedReaderSite? {
      val parts = raw?.split('\t') ?: return null
      if (parts.size != 3) return null
      val testMode = parts[2].toBooleanStrictOrNull() ?: return null
      return RememberedReaderSite(parts[0], parts[1], testMode)
    }
  }
}
