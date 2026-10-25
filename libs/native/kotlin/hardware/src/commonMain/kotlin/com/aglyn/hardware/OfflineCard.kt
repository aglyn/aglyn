package com.aglyn.hardware

/*
 * A CARD TAKEN WITH NO CONNECTION (AGL-4039), on this device's own reader.
 * The Apple kit's `OfflineCard.swift`, rule for rule.
 *
 * Online, the server makes every card PaymentIntent and the reader only
 * collects it ([collectCardPayment]). Offline there is no server to ask, so
 * the app makes the intent itself through the Stripe Terminal SDK, which
 * stores the card on the device ("store and forward") and sends it to Stripe
 * once a connection returns. The intent is a destination charge with MANUAL
 * capture and no application fee: the server captures it when the sale
 * syncs, and sizes the platform fee then.
 *
 * Nothing here needs Google Play services or the SDK: the request's checks,
 * the create → collect → confirm sequence and what a forward means are tested
 * with a fake port, and the app's collector only binds calls. A forward can
 * happen at any time (the SDK forwards on its own), so each one is written to
 * a small ledger on the device, keyed by the sale, for the register to apply.
 */

private val OFFLINE_SALE_KEY = Regex("^[A-Za-z0-9_-]{16,64}$")
private val CURRENCY = Regex("^[a-z]{3}$")
private val AUTHORIZED_STATUSES = setOf("requires_capture", "succeeded")

/** One card to take offline for one sale. */
data class OfflineCardRequest(
  /** The sale's key: the order's id once it syncs, and the intent's `metadata.saleKey`. */
  val saleKey: String,
  val amountCents: Long,
  val currency: String,
  /** The connected account the charge transfers to. */
  val destination: String,
  val metadata: Map<String, String>,
) {
  /** Null when the request is well formed. */
  val problem: String?
    get() = when {
      !OFFLINE_SALE_KEY.matches(saleKey) -> "The sale has no key to charge the card against."
      amountCents <= 0 -> "There is nothing to charge."
      !destination.startsWith("acct_") -> "Card payments are not set up for this store."
      !CURRENCY.matches(currency) -> "The store's currency is missing."
      metadata["saleKey"] != saleKey -> "The card does not name its sale."
      else -> null
    }
}

/** A card the reader has taken, on the device or already with Stripe. */
data class OfflineCardTaken(
  val saleKey: String,
  /** Stripe's id when Stripe already has it; null while stored on the device. */
  val paymentIntentId: String?,
  val brand: String? = null,
  val last4: String? = null,
) {
  val label: String get() = offlineCardLabel(brand, last4)
}

sealed interface OfflineCardOutcome {
  data class Taken(val taken: OfflineCardTaken) : OfflineCardOutcome

  /** Nobody was charged; the sale can be tried again. */
  data object Canceled : OfflineCardOutcome

  data class Failed(val message: String, val code: String? = null) : OfflineCardOutcome
}

/** What became of a stored card once the SDK sent it to Stripe. */
data class OfflineCardForward(
  val saleKey: String,
  val paymentIntentId: String?,
  val status: Status,
  val message: String? = null,
  val brand: String? = null,
  val last4: String? = null,
) {
  enum class Status { AUTHORIZED, DECLINED, FAILED }
}

/** An intent the SDK made or handed back, reduced to what the offline sequence reads. */
data class OfflineTerminalIntent(
  /** Null while the intent exists only on the device. */
  val id: String?,
  val status: String,
  val amountCents: Long,
  /** Confirmed while offline: the card waits on the device for its forward. */
  val storedOffline: Boolean,
  val saleKey: String? = null,
  val brand: String? = null,
  val last4: String? = null,
)

sealed interface OfflineTerminalResult {
  data class Ok(val intent: OfflineTerminalIntent) : OfflineTerminalResult

  data class Error(val error: TerminalError) : OfflineTerminalResult
}

/** The three SDK calls an offline card makes, one adapter per SDK. */
interface OfflineTerminalPort {
  suspend fun create(request: OfflineCardRequest): OfflineTerminalResult

  suspend fun collect(saleKey: String): OfflineTerminalResult

  suspend fun confirm(saleKey: String): OfflineTerminalResult
}

/**
 * Create → collect → confirm, for one card taken offline. Confirming offline
 * stores the card on the device; confirming while Stripe is reachable after
 * all authorizes it there and then (a decline is then said at once, while the
 * customer is still at the counter).
 */
suspend fun collectOfflineCardPayment(port: OfflineTerminalPort, request: OfflineCardRequest, reader: DeviceReader?): OfflineCardOutcome {
  request.problem?.let { return OfflineCardOutcome.Failed(it) }
  if (reader == null) return OfflineCardOutcome.Failed("Connect the card reader first.")
  when (val created = port.create(request)) {
    is OfflineTerminalResult.Error -> return offlineFailed(created.error, "The card could not be started. Try again.")
    is OfflineTerminalResult.Ok ->
      if (created.intent.amountCents != request.amountCents) {
        return OfflineCardOutcome.Failed("The amount to charge does not match the register. Start again.")
      }
  }
  when (val collected = port.collect(request.saleKey)) {
    is OfflineTerminalResult.Error -> {
      if (collected.error.canceled) return OfflineCardOutcome.Canceled
      return offlineFailed(collected.error, "The card could not be read. Try again.")
    }
    is OfflineTerminalResult.Ok -> Unit
  }
  return when (val confirmed = port.confirm(request.saleKey)) {
    is OfflineTerminalResult.Error ->
      if (confirmed.error.canceled) OfflineCardOutcome.Canceled
      else offlineFailed(confirmed.error, "The card did not go through. Try another card or take cash.")
    is OfflineTerminalResult.Ok -> {
      val intent = confirmed.intent
      if (!intent.storedOffline && intent.status !in AUTHORIZED_STATUSES) {
        OfflineCardOutcome.Failed("The card did not go through. Try another card or take cash.")
      } else {
        OfflineCardOutcome.Taken(
          OfflineCardTaken(request.saleKey, if (intent.storedOffline) null else intent.id, intent.brand, intent.last4),
        )
      }
    }
  }
}

private fun offlineFailed(error: TerminalError, fallback: String) =
  OfflineCardOutcome.Failed(collectErrorMessage(error, fallback), error.code)

/**
 * What a forward the SDK reported means for the sale: authorized when Stripe
 * holds an authorization to capture, failed when Stripe never made the payment
 * at all (no id), and declined for anything else Stripe answered.
 */
fun offlineForwardStatus(intentId: String?, status: String?): OfflineCardForward.Status = when {
  intentId.isNullOrEmpty() -> OfflineCardForward.Status.FAILED
  status in AUTHORIZED_STATUSES -> OfflineCardForward.Status.AUTHORIZED
  else -> OfflineCardForward.Status.DECLINED
}

/** "Visa •••• 4242", "Card •••• 4242" or "Card". */
fun offlineCardLabel(brand: String?, last4: String?): String {
  val name = when (brand.orEmpty().lowercase()) {
    "visa" -> "Visa"
    "mastercard" -> "Mastercard"
    "amex", "american_express" -> "American Express"
    "discover" -> "Discover"
    "jcb" -> "JCB"
    "" -> "Card"
    else -> brand!!.replaceFirstChar { it.uppercase() }
  }
  return if (last4 != null && last4.length == 4) "$name •••• $last4" else name
}

/** Where the ledger keeps its one value; the app's preferences on a device, a map in a test. */
interface OfflineCardForwardStore {
  fun read(): String?

  fun write(value: String?)
}

/** The device's record of forwards the register has not applied yet: one line per sale. */
class OfflineCardForwardLedger(private val store: OfflineCardForwardStore) {
  fun all(): List<OfflineCardForward> = store.read().orEmpty().lines().mapNotNull(::decode)

  /** Keeps [forward], replacing an earlier one for the same sale. */
  fun record(forward: OfflineCardForward) = write(all().filter { it.saleKey != forward.saleKey } + forward)

  fun remove(saleKeys: Set<String>) {
    if (saleKeys.isNotEmpty()) write(all().filter { it.saleKey !in saleKeys })
  }

  private fun write(list: List<OfflineCardForward>) = store.write(if (list.isEmpty()) null else list.joinToString("\n", transform = ::encode))

  private fun clean(value: String?) = value.orEmpty().replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')

  private fun encode(forward: OfflineCardForward) =
    listOf(forward.saleKey, forward.paymentIntentId, forward.status.name, forward.message, forward.brand, forward.last4)
      .joinToString("\t") { clean(it) }

  private fun decode(line: String): OfflineCardForward? {
    val parts = line.split('\t')
    if (parts.size != 6 || parts[0].isEmpty()) return null
    val status = OfflineCardForward.Status.entries.firstOrNull { it.name == parts[2] } ?: return null
    fun part(index: Int) = parts[index].ifEmpty { null }
    return OfflineCardForward(parts[0], part(1), status, part(3), part(4), part(5))
  }
}

/** A reader that can take a card with no connection; the app's Stripe Terminal collector is one. */
interface OfflineCardCollector {
  /** Why the connected reader cannot take a card offline right now, or null when it can. */
  val offlineCardUnavailableReason: String?

  suspend fun collectOffline(request: OfflineCardRequest): OfflineCardOutcome

  /** Told after a forward was written to the ledger, so a register on screen applies it now. */
  var onOfflineForward: (() -> Unit)?

  /** The register found the console reachable (true) or not (false). A test build may mirror it onto a simulated reader. */
  fun registerConnectivityChanged(online: Boolean) {}
}
