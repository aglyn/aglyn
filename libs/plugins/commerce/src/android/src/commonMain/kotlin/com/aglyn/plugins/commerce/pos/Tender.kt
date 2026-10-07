package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ConsoleApiError
import com.aglyn.hardware.CardCollectOutcome
import com.aglyn.hardware.CardCollectRequest
import com.aglyn.hardware.CardCollector
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.collectRequestProblem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * TAKING ONE TENDER.
 *
 * Each tender is a short, resumable sequence against the open sale, and
 * every one ends in the same four outcomes the checkout acts on:
 *
 * - settled: the server recorded the payment (the sale may still have a
 *   balance, when this was a split);
 * - canceled: nobody was charged and the same tender can be tried again;
 * - failed: declined or refused, with words to read out;
 * - unknown: the answer was lost. The cashier checks the sale again rather
 *   than pressing the tender twice; the attempt key makes even a second
 *   press safe, because the route finds the payment the first press started.
 *
 * The device never decides that money moved: a card collected on this device
 * is AUTHORIZED here and recorded by the server's own read of Stripe.
 */

sealed interface TenderOutcome {
  data class Settled(val answer: PosPaymentAnswer, val payment: PosSalePayment?) : TenderOutcome
  data class Canceled(val answer: PosPaymentAnswer?) : TenderOutcome
  data class Failed(val message: String, val answer: PosPaymentAnswer?) : TenderOutcome
  data class Unknown(val message: String) : TenderOutcome
}

const val LOST_ANSWER = "The connection dropped before the answer arrived. Check the sale before taking payment again."

/** A lost answer (no status: the network dropped) as opposed to the route's refusal. */
fun isLostAnswer(error: Throwable): Boolean = error !is ConsoleApiError || error.status == 0

private fun failedOrUnknown(error: Throwable, fallback: String): TenderOutcome {
  if (error is CancellationException) throw error
  if (isLostAnswer(error)) return TenderOutcome.Unknown(LOST_ANSWER)
  return TenderOutcome.Failed(error.message?.ifEmpty { null } ?: fallback, null)
}

/** What a payment's own status means for the checkout; null while it is still in progress. */
fun outcomeOfPayment(answer: PosPaymentAnswer): TenderOutcome? {
  val payment = answer.payment ?: return null
  return when (payment.status) {
    "succeeded" -> TenderOutcome.Settled(answer, payment)
    "canceled" -> TenderOutcome.Canceled(answer)
    "failed" -> TenderOutcome.Failed(payment.failureMessage?.ifEmpty { null } ?: "The card was declined.", answer)
    else -> null
  }
}

/** The open sale a tender is taken against. */
class TenderDeps(
  val api: PosSaleApi,
  val orderId: String,
  val sleep: suspend (Long) -> Unit = { delay(it) },
)

/**
 * Re-reads one card payment through the server until it settles or fails.
 * A collected card is usually recorded at the first read; the retries cover
 * the moment between the reader's answer and Stripe's.
 */
suspend fun settleCardPayment(deps: TenderDeps, paymentId: String, attempts: Int = 5): TenderOutcome {
  for (attempt in 0 until attempts) {
    val answer = try {
      deps.api.payment(deps.orderId, SaleStep.Status(paymentId))
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      if (attempt == attempts - 1) return failedOrUnknown(error, "The payment could not be confirmed.")
      deps.sleep(1_000)
      continue
    }
    outcomeOfPayment(answer)?.let { return it }
    deps.sleep(1_000L * (attempt + 1))
  }
  return TenderOutcome.Unknown("The card was read, but the payment is not confirmed yet. Check the sale in a moment.")
}

/** Stops a card payment nobody was charged for, so the balance is open again. */
suspend fun cancelCardPayment(deps: TenderDeps, paymentId: String): PosPaymentAnswer? = try {
  deps.api.payment(deps.orderId, SaleStep.Cancel(paymentId))
} catch (error: Throwable) {
  if (error is CancellationException) throw error
  null
}

enum class CardReaderKind { SMART, DEVICE, SIMULATED }

/**
 * The register's card payment layer: one card tender, start to outcome, on
 * whichever reader the cashier picked. Three implementations:
 *
 * - [SmartReaderService]: a smart reader on the counter (WisePOS E, S700),
 *   driven entirely by the server (`card-present` + `status`); no SDK, and the
 *   only kind a desktop register offers;
 * - [DeviceReaderService] over the device's [CardCollector]: Tap to Pay or a
 *   Bluetooth reader through the Stripe Terminal SDK (a stub until the SDK is
 *   approved), or the simulated reader for tests and training.
 */
interface CardReaderService {
  val id: String
  val label: String
  val kind: CardReaderKind

  /**
   * Takes [amountCents] plus [tipCents] by card. [onWaiting] fires once the
   * customer is at the reader, with the payment the server opened.
   */
  suspend fun charge(
    deps: TenderDeps,
    amountCents: Long,
    tipCents: Long,
    attemptKey: String,
    onWaiting: (paymentId: String?) -> Unit = {},
  ): TenderOutcome

  /** Stops the payment in flight; nobody is charged. */
  suspend fun cancel(deps: TenderDeps, paymentId: String?)
}

/** A smart reader on the counter: the server pushes the intent to it and reads the result. */
class SmartReaderService(
  val reader: PosSmartReader,
  private val pollMs: Long = 2_000,
  /** How long the customer has at the reader before the register asks to check the sale. */
  private val maxPolls: Int = 90,
) : CardReaderService {
  override val id get() = reader.id
  override val label get() = reader.label
  override val kind = CardReaderKind.SMART

  override suspend fun charge(
    deps: TenderDeps,
    amountCents: Long,
    tipCents: Long,
    attemptKey: String,
    onWaiting: (paymentId: String?) -> Unit,
  ): TenderOutcome {
    val started = try {
      deps.api.payment(deps.orderId, SaleStep.CardPresent(reader.id, amountCents, tipCents), attemptKey)
    } catch (error: Throwable) {
      return failedOrUnknown(error, "The card reader could not start the payment.")
    }
    outcomeOfPayment(started)?.let { return it }
    val payment = started.payment ?: return TenderOutcome.Failed("The card reader could not start the payment.", started)
    onWaiting(payment.id)
    repeat(maxPolls) {
      deps.sleep(pollMs)
      poll(deps, payment.id)?.let { return it }
    }
    return TenderOutcome.Unknown("The reader has not answered yet. Check the sale before taking payment again.")
  }

  /** One read of the payment; null while the customer is still at the reader. */
  suspend fun poll(deps: TenderDeps, paymentId: String): TenderOutcome? = try {
    outcomeOfPayment(deps.api.payment(deps.orderId, SaleStep.Status(paymentId)))
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
    if (isLostAnswer(error)) null else failedOrUnknown(error, "The payment could not be read.")
  }

  override suspend fun cancel(deps: TenderDeps, paymentId: String?) {
    if (paymentId != null) cancelCardPayment(deps, paymentId)
  }
}

/**
 * This device's own reader: the server makes the intent (`card-present-sdk`),
 * the [collector] takes the card, the server records it (`status`). Before
 * the card is asked for, the answer is checked: the client secret must name
 * the same intent, and the amount must be the amount plus the tip the
 * register asked for, so a mismatched intent is never collected.
 */
class DeviceReaderService(private val collector: CardCollector) : CardReaderService {
  override val id = "device"
  override val label: String
    get() = (collector.state.value as? CardCollectorState.Connected)?.label ?: "This device"
  override val kind: CardReaderKind
    get() = if ((collector.state.value as? CardCollectorState.Connected)?.kind == com.aglyn.hardware.CardCollectorKind.SIMULATED) {
      CardReaderKind.SIMULATED
    } else {
      CardReaderKind.DEVICE
    }

  override suspend fun charge(
    deps: TenderDeps,
    amountCents: Long,
    tipCents: Long,
    attemptKey: String,
    onWaiting: (paymentId: String?) -> Unit,
  ): TenderOutcome {
    val started = try {
      deps.api.payment(deps.orderId, SaleStep.CardPresentSdk(amountCents, tipCents), attemptKey)
    } catch (error: Throwable) {
      return failedOrUnknown(error, "The card payment could not be started.")
    }
    val already = outcomeOfPayment(started)
    // A retried press whose first attempt already settled or failed.
    if (already != null && already !is TenderOutcome.Canceled) return already
    val payment = started.payment
    val secret = started.clientSecret
    val intent = started.paymentIntentId
    if (payment == null || secret == null || intent == null) {
      return TenderOutcome.Failed(payment?.failureMessage ?: "The card payment could not be started.", started)
    }
    val problem = collectRequestProblem(intent, secret)
      ?: if (payment.amountCents + payment.tipCents != amountCents + tipCents) {
        "The amount to charge does not match the register. Start the payment again."
      } else {
        null
      }
    if (problem != null) {
      return TenderOutcome.Failed(problem, cancelCardPayment(deps, payment.id) ?: started)
    }
    onWaiting(payment.id)
    val collected = try {
      collector.collect(CardCollectRequest(intent, secret, payment.amountCents + payment.tipCents))
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      // The reader's answer was lost: the server's read of Stripe decides.
      null
    }
    return when (collected) {
      is CardCollectOutcome.Canceled -> TenderOutcome.Canceled(cancelCardPayment(deps, payment.id) ?: started)
      // The intent stays open on the server; releasing it lets the cashier
      // try another card or another tender.
      is CardCollectOutcome.Failed -> TenderOutcome.Failed(collected.message, cancelCardPayment(deps, payment.id) ?: started)
      is CardCollectOutcome.Collected, null -> settleCardPayment(deps, payment.id)
    }
  }

  override suspend fun cancel(deps: TenderDeps, paymentId: String?) {
    collector.cancel()
    if (paymentId != null) cancelCardPayment(deps, paymentId)
  }
}

/** Cash: the server works out the change from what the customer handed over. */
suspend fun payCash(deps: TenderDeps, tenderedCents: Long, amountCents: Long?, tipCents: Long, attemptKey: String): TenderOutcome = try {
  val answer = deps.api.payment(deps.orderId, SaleStep.Cash(tenderedCents, tipCents, amountCents), attemptKey)
  outcomeOfPayment(answer) ?: TenderOutcome.Settled(answer, answer.payment)
} catch (error: Throwable) {
  failedOrUnknown(error, "The cash payment could not be recorded.")
}

/** A gift card: the server takes the smaller of its balance and what is left to pay. */
suspend fun payGiftCard(deps: TenderDeps, code: String, amountCents: Long?, attemptKey: String): TenderOutcome = try {
  val answer = deps.api.payment(deps.orderId, SaleStep.GiftCard(code.trim().uppercase(), amountCents), attemptKey)
  outcomeOfPayment(answer) ?: TenderOutcome.Settled(answer, answer.payment)
} catch (error: Throwable) {
  failedOrUnknown(error, "The gift card could not be used.")
}

data class TipChoice(val id: String, val label: String, val cents: Long)

/** The merchant's tip presets on what is being paid, plus no tip. */
fun tipChoices(baseCents: Long, percentages: List<Double>): List<TipChoice> =
  listOf(TipChoice("none", "No tip", 0)) + percentages.map { percent ->
    val text = if (percent == kotlin.math.floor(percent)) percent.toLong().toString() else percent.toString()
    TipChoice("pct-$text", "$text%", posTipFromPercent(baseCents, percent))
  }

/** The bills a customer is likely to hand over: exact, then the next $5, $10, $20, $50, $100. */
fun cashQuickAmounts(dueCents: Long): List<Long> {
  val due = maxOf(0, dueCents)
  if (due == 0L) return emptyList()
  val amounts = mutableSetOf(due)
  for (step in listOf(500L, 1_000L, 2_000L, 5_000L, 10_000L)) {
    val next = (due + step - 1) / step * step
    if (next > due) amounts += next
  }
  return amounts.sorted().take(5)
}

/**
 * One attempt key per tender press, kept until an answer arrives. Pressing
 * the same tender again after a lost answer reuses the key, so the route
 * finds the payment the first press started; any answer (settled, canceled,
 * failed) retires it, and the next press is a new attempt.
 */
class AttemptKeys(private val mint: () -> String = ::newAttemptKey) {
  private var current: Pair<String, String>? = null

  /** The key for [tender] (what is being paid, how, and how much). */
  fun keyFor(tender: String): String {
    val held = current
    if (held != null && held.first == tender) return held.second
    return mint().also { current = tender to it }
  }

  /** The key still waiting on an answer, if any. */
  val pending: String? get() = current?.second

  /** An answer arrived: the next press is a new attempt. */
  fun answered() {
    current = null
  }
}

@OptIn(ExperimentalUuidApi::class)
fun newAttemptKey(prefix: String = "pos-app"): String = "$prefix-${Uuid.random()}"
