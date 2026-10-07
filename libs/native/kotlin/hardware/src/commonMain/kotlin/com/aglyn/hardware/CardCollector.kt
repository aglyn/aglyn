package com.aglyn.hardware

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/*
 * THIS DEVICE'S CARD READER.
 *
 * The server has already made a `card_present` PaymentIntent for the payment
 * (a sale's tender or a booking taken at the counter) and holds the money
 * decisions. A collector's only job is the card: retrieve that intent,
 * collect a card on Tap to Pay or a Bluetooth reader, and confirm it, which
 * AUTHORIZES the charge. The server then reads Stripe and captures.
 *
 * So a collector never creates, prices or captures money, and what it
 * reports is a hint the server re-reads, never a fact anyone trusts. Every
 * outcome is one of three: collected, canceled (nobody was charged; the same
 * intent can be collected again) or failed (with words to read out).
 */

data class CardCollectRequest(
  val paymentIntentId: String,
  val clientSecret: String,
  /** What the register shows the customer, tip included. Another amount is refused before the card is asked for. */
  val amountCents: Long,
  /** Offer on-reader tipping, when the connected reader can show it. */
  val tipEligible: Boolean = false,
)

sealed interface CardCollectOutcome {
  val paymentIntentId: String

  data class Collected(override val paymentIntentId: String, val amountCents: Long, val tipCents: Long = 0) : CardCollectOutcome

  data class Canceled(override val paymentIntentId: String) : CardCollectOutcome

  data class Failed(override val paymentIntentId: String, val message: String, val code: String? = null) : CardCollectOutcome
}

private val PAYMENT_INTENT_ID = Regex("^pi_[A-Za-z0-9]{8,64}$")
private val CLIENT_SECRET = Regex("^(pi_[A-Za-z0-9]{8,64})_secret_[A-Za-z0-9]{8,128}$")

/**
 * Null when the request is well formed. The client secret names its own
 * intent, and one for a different intent is refused, so nothing can ask to
 * collect A while the register records B.
 */
fun collectRequestProblem(paymentIntentId: String?, clientSecret: String?): String? {
  if (paymentIntentId == null || !PAYMENT_INTENT_ID.matches(paymentIntentId)) return "The payment to collect is missing."
  if (clientSecret == null) return "The payment to collect is missing."
  val match = CLIENT_SECRET.matchEntire(clientSecret)
  if (match == null || match.groupValues[1] != paymentIntentId) return "The payment to collect does not match its secret."
  return null
}

enum class CardCollectorKind { TAP_TO_PAY, BLUETOOTH, SIMULATED }

sealed interface CardCollectorState {
  /** This device cannot take cards on its own; the words say why. */
  data class Unavailable(val reason: String) : CardCollectorState

  data object Disconnected : CardCollectorState

  data class Connected(val label: String, val kind: CardCollectorKind, val testMode: Boolean) : CardCollectorState
}

/** Why a reader could not be set up, as the connection token route words it. */
enum class CardReaderSetupCode(val wire: String) {
  UNAVAILABLE("terminal-unavailable"),
  MERCHANT_NOT_READY("merchant-not-ready"),
  LOCATION_REQUIRED("location-required"),
  ;

  companion object {
    fun of(wire: String?): CardReaderSetupCode? = entries.firstOrNull { it.wire == wire }
  }
}

class CardReaderSetupError(val code: CardReaderSetupCode, message: String) : Exception(message)

/** A Terminal connection token for one site, scoped to the site's Terminal Location. */
data class CardReaderSession(
  val secret: String,
  val locationId: String,
  val merchantDisplayName: String,
  val testMode: Boolean,
)

/**
 * The server half a device reader needs: a connection token whenever the
 * SDK asks for one. The commerce plugin provides it over its own route; the
 * foundation never names a plugin.
 */
fun interface CardReaderSessionSource {
  /** Throws [CardReaderSetupError] when the site is not ready for card readers. */
  suspend fun session(hostId: String): CardReaderSession
}

/** This device's own card reader. */
interface CardCollector {
  val state: StateFlow<CardCollectorState>

  /** Connects for one site; [sessions] mints the connection tokens. */
  suspend fun connect(hostId: String, sessions: CardReaderSessionSource): CardCollectorState

  /** Retrieves, collects and confirms one server-made intent. Validates [request] first. */
  suspend fun collect(request: CardCollectRequest): CardCollectOutcome

  /** Stops a collection in progress; the customer was not charged. */
  suspend fun cancel()
}

/**
 * The Stripe Terminal SDK reader (Tap to Pay and Bluetooth readers). The SDK
 * is not part of the build yet, so this reports itself unavailable and
 * refuses to collect; the register then offers smart readers and cash. When
 * the SDK lands, this is the one class that binds it: `connect` fetches the
 * token through [CardReaderSessionSource] (never with `onBehalfOf`: card-
 * present charges settle on the platform account), and `collect` runs
 * retrievePaymentIntent → collectPaymentMethod → confirmPaymentIntent.
 */
class StripeTerminalSdkCollector : CardCollector {
  private val mutableState = MutableStateFlow<CardCollectorState>(CardCollectorState.Unavailable(UNAVAILABLE))
  override val state: StateFlow<CardCollectorState> = mutableState

  override suspend fun connect(hostId: String, sessions: CardReaderSessionSource): CardCollectorState = mutableState.value

  override suspend fun collect(request: CardCollectRequest): CardCollectOutcome =
    CardCollectOutcome.Failed(request.paymentIntentId, UNAVAILABLE)

  override suspend fun cancel() = Unit

  companion object {
    const val UNAVAILABLE = "Tap to Pay and Bluetooth readers are not available on this device yet. Use a smart reader or cash."
  }
}

/**
 * A reader for tests, demos and training: no card, no SDK. It validates the
 * request like a real reader, waits [delayMs], and answers [answer] (by
 * default, collects the amount it was asked for).
 */
class SimulatedCardCollector(
  private val delayMs: Long = 1_200,
  private val answer: (CardCollectRequest) -> CardCollectOutcome = {
    CardCollectOutcome.Collected(it.paymentIntentId, it.amountCents)
  },
) : CardCollector {
  private val mutableState = MutableStateFlow<CardCollectorState>(CardCollectorState.Disconnected)
  override val state: StateFlow<CardCollectorState> = mutableState
  private var canceled = false

  override suspend fun connect(hostId: String, sessions: CardReaderSessionSource): CardCollectorState {
    mutableState.value = CardCollectorState.Connected(LABEL, CardCollectorKind.SIMULATED, testMode = true)
    return mutableState.value
  }

  override suspend fun collect(request: CardCollectRequest): CardCollectOutcome {
    collectRequestProblem(request.paymentIntentId, request.clientSecret)?.let {
      return CardCollectOutcome.Failed(request.paymentIntentId, it)
    }
    if (mutableState.value !is CardCollectorState.Connected) {
      return CardCollectOutcome.Failed(request.paymentIntentId, "Connect the card reader first.")
    }
    canceled = false
    delay(delayMs)
    if (canceled) return CardCollectOutcome.Canceled(request.paymentIntentId)
    return answer(request)
  }

  override suspend fun cancel() {
    canceled = true
  }

  companion object {
    const val LABEL = "Simulated reader"
  }
}
