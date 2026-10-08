package com.aglyn.hardware

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/*
 * A DEVICE READER, AS THE SCREENS SEE IT.
 *
 * Tap to Pay on this phone or tablet, or a Bluetooth reader near it, reached
 * through the Stripe Terminal SDK. The SDK itself stays in the POS app (it is
 * Android only and must not reach the Aglyn app); this file holds what the
 * shared screens draw and every rule that can be decided without the SDK:
 * the collect sequence, the words a reader prompt or an SDK error is read out
 * as, and when a reader update must install. The SDK binding is a thin
 * adapter over [TerminalPaymentPort], so the sequence is tested here on the
 * JVM with a fake.
 */

/** A reader found by discovery, or the one connected. */
data class DeviceReader(
  /** The SDK's serial number (Tap to Pay has a stable stand-in). */
  val id: String,
  val label: String,
  val kind: CardCollectorKind,
  val simulated: Boolean,
  /** 0..1, when the reader reports one. */
  val batteryLevel: Double? = null,
  /** The reader's model as Stripe names it (`STRIPE_M2`, `WISEPAD_3`, `TAP_TO_PAY_DEVICE`, …). */
  val deviceType: String = "",
)

sealed interface ReaderDiscovery {
  data object Idle : ReaderDiscovery

  data class Searching(val kind: CardCollectorKind, val found: List<DeviceReader> = emptyList()) : ReaderDiscovery

  /** Discovery ended with readers to pick from. */
  data class Found(val kind: CardCollectorKind, val found: List<DeviceReader>) : ReaderDiscovery

  data class Failed(val message: String) : ReaderDiscovery
}

/** A reader software update: offered, installing, or due before the next payment. */
data class ReaderUpdate(
  /** 0..1 while installing; null while only offered. */
  val progress: Double? = null,
  /** Past its deadline: it installs before this reader takes another payment. */
  val required: Boolean = false,
)

/**
 * The reader management a device reader adds to [CardCollector]: discover by
 * kind, pick one, disconnect, install an update, and the prompts the reader
 * asks the cashier to read out. A collector without device readers (the
 * simulated one, a desktop) keeps the defaults: nothing to discover.
 */
interface DeviceReaderControls {
  /** The kinds this device can use at all (Tap to Pay needs NFC and Android 13+). */
  val kinds: List<CardCollectorKind>
  val discovery: StateFlow<ReaderDiscovery>
  val connected: StateFlow<DeviceReader?>

  /** What the reader asks for right now ("Insert the card."), while a payment is in progress. */
  val prompt: StateFlow<String?>
  val update: StateFlow<ReaderUpdate?>

  suspend fun discover(kind: CardCollectorKind, hostId: String, sessions: CardReaderSessionSource)

  suspend fun cancelDiscovery()

  /** Connects [reader] under the site's Terminal Location; the SDK remembers it for reconnects. */
  suspend fun connectTo(reader: DeviceReader, hostId: String, sessions: CardReaderSessionSource): Boolean

  suspend fun disconnect()

  suspend fun installUpdate()
}

/** The controls of a collector that has none (simulated, desktop). */
object NoDeviceReaderControls : DeviceReaderControls {
  override val kinds: List<CardCollectorKind> = emptyList()
  override val discovery: StateFlow<ReaderDiscovery> = MutableStateFlow(ReaderDiscovery.Idle)
  override val connected: StateFlow<DeviceReader?> = MutableStateFlow(null)
  override val prompt: StateFlow<String?> = MutableStateFlow(null)
  override val update: StateFlow<ReaderUpdate?> = MutableStateFlow(null)

  override suspend fun discover(kind: CardCollectorKind, hostId: String, sessions: CardReaderSessionSource) = Unit

  override suspend fun cancelDiscovery() = Unit

  override suspend fun connectTo(reader: DeviceReader, hostId: String, sessions: CardReaderSessionSource) = false

  override suspend fun disconnect() = Unit

  override suspend fun installUpdate() = Unit
}

/** The reader controls behind [this] collector, or none. */
val CardCollector.deviceReaders: DeviceReaderControls get() = (this as? DeviceReaderControls) ?: NoDeviceReaderControls

// ---- the collect sequence

/** A PaymentIntent as the SDK hands it back, reduced to what the sequence reads. */
data class TerminalIntent(
  val id: String,
  /** Stripe's status, lower snake case (`requires_payment_method`, `requires_capture`, `succeeded`, …). */
  val status: String,
  val amountCents: Long,
  val tipCents: Long = 0,
)

/** An SDK error, reduced: its code (the SDK's enum name), message and decline details. */
data class TerminalError(
  val code: String,
  val message: String? = null,
  val declineCode: String? = null,
  val apiMessage: String? = null,
  /** The intent as it stood when the call failed, when the SDK says. */
  val intent: TerminalIntent? = null,
) {
  val canceled: Boolean get() = code.uppercase() == "CANCELED"
}

sealed interface TerminalResult {
  data class Ok(val intent: TerminalIntent) : TerminalResult

  data class Error(val error: TerminalError) : TerminalResult
}

/** The three SDK calls a collection makes, one adapter per SDK. */
interface TerminalPaymentPort {
  suspend fun retrieve(clientSecret: String): TerminalResult

  suspend fun collect(intentId: String, skipTipping: Boolean): TerminalResult

  suspend fun confirm(intentId: String): TerminalResult
}

/** Readers that can ask the customer for a tip on their own screen. */
fun readerCanTip(deviceType: String): Boolean = deviceType.uppercase().startsWith("WISEPAD_3")

private val AUTHORIZED = setOf("requires_capture", "succeeded")

/**
 * Retrieve → collect → confirm, for one server-made intent. Confirming
 * AUTHORIZES; the server captures after reading Stripe. An intent that is
 * already authorized (a retry after a lost answer) is reported again rather
 * than charged twice, and an intent for another amount than the register
 * shows is refused before the card is asked for.
 */
suspend fun collectCardPayment(port: TerminalPaymentPort, request: CardCollectRequest, reader: DeviceReader?): CardCollectOutcome {
  val id = request.paymentIntentId
  collectRequestProblem(id, request.clientSecret)?.let { return CardCollectOutcome.Failed(id, it) }
  if (reader == null) return CardCollectOutcome.Failed(id, "Connect Tap to Pay or a card reader first.")

  val retrieved = when (val result = port.retrieve(request.clientSecret)) {
    is TerminalResult.Error -> return failed(id, result.error, "The payment could not be loaded. Try again.")
    is TerminalResult.Ok -> result.intent
  }
  if (retrieved.id != id) return CardCollectOutcome.Failed(id, "The payment to collect does not match.")
  if (retrieved.status in AUTHORIZED) return collected(retrieved)
  if (retrieved.amountCents != request.amountCents) {
    return CardCollectOutcome.Failed(id, "The amount to charge does not match the register. Start the payment again.")
  }

  val skipTipping = !(request.tipEligible && readerCanTip(reader.deviceType))
  when (val result = port.collect(id, skipTipping)) {
    is TerminalResult.Error -> {
      if (result.error.canceled) return CardCollectOutcome.Canceled(id)
      return failed(id, result.error, "The card could not be read. Try again.")
    }
    is TerminalResult.Ok -> Unit
  }
  return when (val result = port.confirm(id)) {
    is TerminalResult.Ok -> collected(result.intent)
    is TerminalResult.Error -> {
      val after = result.error.intent
      when {
        result.error.canceled -> CardCollectOutcome.Canceled(id)
        after != null && after.status in AUTHORIZED -> collected(after)
        else -> failed(id, result.error, "The payment did not go through. Try again.")
      }
    }
  }
}

private fun collected(intent: TerminalIntent) =
  CardCollectOutcome.Collected(intent.id, maxOf(0, intent.amountCents), maxOf(0, intent.tipCents))

private fun failed(id: String, error: TerminalError, fallback: String) =
  CardCollectOutcome.Failed(id, collectErrorMessage(error, fallback), error.code)

// ---- words

/** An SDK payment error, as the cashier reads it. */
fun collectErrorMessage(error: TerminalError, fallback: String): String {
  if (error.declineCode == "insufficient_funds") return "Declined: insufficient funds. Ask for another card."
  error.apiMessage?.ifBlank { null }?.let { return it }
  val code = error.code.uppercase()
  return when {
    code.startsWith("DECLINED") -> "The card was declined. Ask for another card."
    code == "NOT_CONNECTED_TO_READER" -> "The card reader disconnected. Reconnect it and try again."
    code == "READER_BUSY" -> "The card reader is busy. Finish or cancel the other payment first."
    code == "TAP_TO_PAY_INSECURE_ENVIRONMENT" ->
      "This device cannot take a PIN right now. Turn off screen recording and overlays, then try again."
    else -> error.message?.ifBlank { null } ?: fallback
  }
}

/** What the reader asks for (the SDK's `ReaderDisplayMessage`), in plain words. */
fun readerPrompt(display: String): String = when (display.uppercase()) {
  "REMOVE_CARD" -> "Remove the card."
  "RETRY_CARD" -> "Try the card again."
  "INSERT_CARD" -> "Insert the card."
  "INSERT_OR_SWIPE_CARD" -> "Insert or swipe the card."
  "SWIPE_CARD" -> "Swipe the card."
  "MULTIPLE_CONTACTLESS_CARDS_DETECTED" -> "More than one card was tapped. Tap just one."
  "TRY_ANOTHER_READ_METHOD" -> "Try another way to pay with this card."
  "TRY_ANOTHER_CARD" -> "Try another card."
  "CARD_REMOVED_TOO_EARLY" -> "The card was removed too early. Try again."
  else -> "Follow the prompt on the reader."
}

/** The ways the reader is ready to take the card (the SDK's `ReaderInputOptions`). */
fun readerInputPrompt(options: List<String>): String {
  val ways = options.mapNotNull {
    when (it.uppercase()) {
      "TAP", "TAP_CARD" -> "tap"
      "INSERT", "INSERT_CARD" -> "insert"
      "SWIPE", "SWIPE_CARD" -> "swipe"
      else -> null
    }
  }
  return if (ways.isEmpty()) "Present the card." else "Ready: ${ways.joinToString(", ")} the card."
}

fun friendlyDiscoveryError(code: String, message: String?): String = when (code.uppercase()) {
  "TAP_TO_PAY_UNSUPPORTED_DEVICE", "TAP_TO_PAY_UNSUPPORTED_ANDROID_VERSION" ->
    "This device cannot take Tap to Pay. It needs an NFC phone or tablet on Android 13 or later. Use a Bluetooth card reader instead."
  "TAP_TO_PAY_NFC_DISABLED" -> "Turn on NFC in Settings to take Tap to Pay."
  "TAP_TO_PAY_DEBUG_NOT_SUPPORTED" -> "Tap to Pay does not run in a developer build. Use the store's release app."
  "BLUETOOTH_DISABLED", "BLUETOOTH_ERROR" -> "Turn on Bluetooth to find card readers."
  "BLUETOOTH_SCAN_TIMED_OUT" -> "No card reader answered. Turn the reader on, keep it close and try again."
  "BLUETOOTH_PERMISSION_DENIED", "LOCATION_SERVICES_DISABLED", "MISSING_REQUIRED_PERMISSION" ->
    "Allow nearby devices and location for Aglyn POS in Settings to find card readers."
  else -> message?.ifBlank { null } ?: "Readers could not be found. Try again."
}

fun friendlyConnectError(code: String, message: String?): String = when (code.uppercase()) {
  "TAP_TO_PAY_NFC_DISABLED" -> "Turn on NFC in Settings to take Tap to Pay."
  "READER_CONNECTED_TO_ANOTHER_DEVICE" -> "This reader is connected to another device. Disconnect it there first."
  "TAP_TO_PAY_DEVICE_TAMPERED" -> "This device failed a security check and cannot take Tap to Pay."
  "TAP_TO_PAY_INSECURE_ENVIRONMENT" -> "Turn off developer options, screen recording and overlays to use Tap to Pay."
  "UNSUPPORTED_READER_VERSION" -> "This reader needs a software update. Keep it charged and connected while it updates."
  "READER_BATTERY_CRITICALLY_LOW" -> "The reader's battery is too low. Charge it and try again."
  else -> message?.ifBlank { null } ?: "The reader could not connect. Try again."
}

/** Whether an optional update has reached its deadline (an ISO instant); after it, it must install first. */
@OptIn(ExperimentalTime::class)
fun updateIsDue(requiredAt: String?, nowMs: Long): Boolean {
  if (requiredAt.isNullOrBlank()) return false
  val at = runCatching { Instant.parse(requiredAt).toEpochMilliseconds() }.getOrNull() ?: return false
  return at <= nowMs
}

/** A reader's name for the list: its label, else its model and serial. */
fun deviceReaderLabel(kind: CardCollectorKind, deviceType: String, label: String?, serial: String?, simulated: Boolean): String {
  if (kind == CardCollectorKind.TAP_TO_PAY) return if (simulated) "Tap to Pay (simulated)" else "Tap to Pay on this device"
  val model = when (deviceType.uppercase()) {
    "STRIPE_M2" -> "Stripe Reader M2"
    "WISEPAD_3", "WISEPAD_3S" -> "BBPOS WisePad 3"
    "CHIPPER_2X" -> "BBPOS Chipper 2X BT"
    else -> "Card reader"
  }
  val name = label?.ifBlank { null } ?: listOfNotNull(model, serial?.ifBlank { null }).joinToString(" ")
  return if (simulated) "$name (simulated)" else name
}
