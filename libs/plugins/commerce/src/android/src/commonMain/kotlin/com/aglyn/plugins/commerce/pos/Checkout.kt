package com.aglyn.plugins.commerce.pos

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/*
 * CHECKOUT: the tender state machine.
 *
 * The server has priced the sale; this takes the money. A tip first when the
 * store asks for one, then a tender: a card reader, cash or a gift card. A
 * tender may cover part of the balance (a split), and the sale stays open
 * until the balance is zero. Then the receipt.
 *
 * Every press goes through here, so the rules hold in one place: one tender
 * at a time, one attempt key per press until its answer arrives, and after a
 * lost answer no tender at all until the sale has been read again.
 */

enum class NoticeTone { ERROR, WARNING, SUCCESS, INFO }

data class Notice(val tone: NoticeTone, val message: String)

sealed interface CheckoutStep {
  data object Tender : CheckoutStep
  data object Cash : CheckoutStep
  data object GiftCard : CheckoutStep

  /** The customer is at a card reader. */
  data class Card(val readerLabel: String, val paymentId: String?) : CheckoutStep

  /** Paid: the receipt is next. */
  data class Receipt(val changeCents: Long) : CheckoutStep
}

data class CheckoutState(
  val opened: PosOpenedSale,
  val sale: PosSale,
  val step: CheckoutStep = CheckoutStep.Tender,
  val tipId: String = "none",
  val tipCents: Long = 0,
  /** Part of the balance, for a split; null pays it all. */
  val partCents: Long? = null,
  val busy: Boolean = false,
  val notice: Notice? = null,
  /** An answer was lost: no tender until the sale is read again. */
  val lost: Boolean = false,
  val giftBalance: String? = null,
) {
  /** What a tender may still take. */
  val dueCents: Long get() = sale.tenderableCents

  /** What the next tender pays: the part, when it is less than the balance, or the balance. */
  val amountCents: Long get() = partCents?.takeIf { it in 1 until dueCents } ?: dueCents

  val isSplit: Boolean get() = amountCents < dueCents

  /** Tenders are open: nothing in flight, nothing unknown, something to pay. */
  val canTender: Boolean get() = !busy && !lost && dueCents > 0 && step !is CheckoutStep.Receipt
}

fun saleFromOpened(opened: PosOpenedSale) = PosSale(
  orderId = opened.orderId,
  status = "pending",
  totalCents = opened.totalCents,
  paidCents = 0,
  dueCents = opened.dueCents,
  tenderableCents = opened.dueCents,
  tipCents = 0,
  payments = emptyList(),
)

class Checkout(
  private val api: PosSaleApi,
  opened: PosOpenedSale,
  val settings: PosRegisterSettings,
  private val keys: AttemptKeys = AttemptKeys(),
  private val sleep: suspend (Long) -> Unit = { delay(it) },
  /** A money string for the notices, in the store's currency. */
  private val formatMoney: (Long) -> String = { money(it, "usd") },
) {
  private val mutable = MutableStateFlow(CheckoutState(opened, saleFromOpened(opened)))
  val state: StateFlow<CheckoutState> = mutable

  private val deps get() = TenderDeps(api, mutable.value.opened.orderId, sleep)

  /** The tip presets on what the next tender pays; none when the store does not ask. */
  fun tips(): List<TipChoice> =
    if (settings.tippingEnabled) tipChoices(mutable.value.amountCents, settings.tipPercentages) else emptyList()

  fun chooseTip(choice: TipChoice) = mutable.update { it.copy(tipId = choice.id, tipCents = choice.cents) }

  fun customTip(cents: Long?) = mutable.update { it.copy(tipId = "custom", tipCents = maxOf(0, cents ?: 0)) }

  fun setPart(cents: Long?) = mutable.update { state ->
    // A new amount re-prices the percent tips on it.
    val part = cents?.takeIf { it > 0 }
    val next = state.copy(partCents = part)
    val tip = tipChoices(next.amountCents, settings.tipPercentages).firstOrNull { it.id == state.tipId }
    if (tip != null) next.copy(tipCents = tip.cents) else next
  }

  fun goTo(step: CheckoutStep) = mutable.update { if (it.canTender || step == CheckoutStep.Tender) it.copy(step = step, notice = null) else it }

  fun dismissNotice() = mutable.update { it.copy(notice = null) }

  private inline fun startTender(block: (CheckoutState) -> Unit) {
    val state = mutable.value
    if (!state.canTender) return
    mutable.value = state.copy(busy = true, notice = null)
    block(state)
  }

  /** A card on [reader]: the customer pays the amount plus the tip. */
  suspend fun payCard(reader: CardReaderService) {
    startTender { state ->
    mutable.update { it.copy(step = CheckoutStep.Card(reader.label, null)) }
    val key = keys.keyFor("card:${reader.id}:${state.amountCents}:${state.tipCents}")
    val outcome = try {
      reader.charge(deps, state.amountCents, state.tipCents, key) { paymentId ->
        mutable.update { it.copy(step = CheckoutStep.Card(reader.label, paymentId)) }
      }
    } catch (error: CancellationException) {
      mutable.update { it.copy(busy = false) }
      throw error
    }
    finish(outcome)
    }
  }

  /** Stops the card payment the customer is at; nobody is charged. */
  suspend fun cancelCard(reader: CardReaderService) {
    val step = mutable.value.step as? CheckoutStep.Card ?: return
    reader.cancel(deps, step.paymentId)
  }

  /** Cash: [tenderedCents] handed over; the server works out the change. */
  suspend fun payCash(tenderedCents: Long) {
    startTender { state ->
    if (tenderedCents < state.amountCents + state.tipCents) {
      mutable.update { it.copy(busy = false, notice = Notice(NoticeTone.ERROR, "The cash handed over is less than ${formatMoney(state.amountCents + state.tipCents)}.")) }
      return
    }
    val key = keys.keyFor("cash:$tenderedCents:${state.amountCents}:${state.tipCents}")
    val part = if (state.isSplit) state.amountCents else null
    finish(payCash(deps, tenderedCents, part, state.tipCents, key), maxOf(0, tenderedCents - state.amountCents - state.tipCents))
    }
  }

  /** A gift card by its code: it pays what it can, up to the amount. */
  suspend fun payGiftCard(code: String) {
    startTender { state ->
    val cleaned = code.trim().uppercase()
    if (cleaned.isEmpty()) {
      mutable.update { it.copy(busy = false, notice = Notice(NoticeTone.ERROR, "Enter the gift card code.")) }
      return
    }
    val key = keys.keyFor("gift:$cleaned:${state.amountCents}")
    finish(payGiftCard(deps, cleaned, if (state.isSplit) state.amountCents else null, key))
    }
  }

  /** Reads a gift card's balance to the customer before it is applied. */
  suspend fun checkGiftCard(code: String) {
    if (code.isBlank() || mutable.value.busy) return
    mutable.update { it.copy(busy = true, notice = null, giftBalance = null) }
    val words = try {
      val balance = api.giftCardBalance(code)
      when {
        balance.voided -> "This card was voided."
        balance.frozen -> "This card is on hold."
        else -> "Available: ${formatMoney(balance.availableCents)}"
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      error.message ?: "The balance could not be read."
    }
    mutable.update { it.copy(busy = false, giftBalance = words) }
  }

  private suspend fun finish(outcome: TenderOutcome, changeCents: Long = 0) {
    apply(outcome, changeCents)
    // A lost answer: read the sale again at once, rather than leave the
    // cashier guessing whether the money moved.
    if (outcome is TenderOutcome.Unknown) recheck(quiet = true)
  }

  /** Applies one tender's outcome to the sale and the screen. */
  fun apply(outcome: TenderOutcome, changeCents: Long = 0) {
    if (outcome is TenderOutcome.Unknown) {
      mutable.update { it.copy(busy = false, lost = true, step = CheckoutStep.Tender, notice = Notice(NoticeTone.WARNING, outcome.message)) }
      return
    }
    keys.answered()
    val answer = when (outcome) {
      is TenderOutcome.Settled -> outcome.answer
      is TenderOutcome.Canceled -> outcome.answer
      is TenderOutcome.Failed -> outcome.answer
      is TenderOutcome.Unknown -> null
    }
    mutable.update { state ->
      val base = state.copy(busy = false, lost = false, sale = answer?.sale ?: state.sale, giftBalance = null)
      when (outcome) {
        is TenderOutcome.Settled -> {
          val completed = outcome.answer.completed || outcome.answer.sale.dueCents <= 0
          val change = outcome.payment?.changeCents?.takeIf { it > 0 } ?: changeCents
          val reset = base.copy(tipId = "none", tipCents = 0, partCents = null)
          if (completed) {
            reset.copy(step = CheckoutStep.Receipt(change), notice = null)
          } else {
            reset.copy(
              step = CheckoutStep.Tender,
              notice = Notice(
                NoticeTone.SUCCESS,
                "Paid ${formatMoney(outcome.payment?.amountCents ?: 0)}. ${formatMoney(outcome.answer.sale.dueCents)} is left to pay.",
              ),
            )
          }
        }
        is TenderOutcome.Canceled -> base.copy(step = CheckoutStep.Tender, notice = Notice(NoticeTone.WARNING, "The payment was canceled. Nobody was charged."))
        is TenderOutcome.Failed -> base.copy(step = CheckoutStep.Tender, notice = Notice(NoticeTone.ERROR, outcome.message))
        is TenderOutcome.Unknown -> base
      }
    }
  }

  /** Reads the sale again: after a lost answer, or when the app reopens on it. */
  suspend fun recheck(quiet: Boolean = false) {
    if (!quiet && mutable.value.busy) return
    mutable.update { it.copy(busy = true) }
    try {
      val answer = api.payment(mutable.value.opened.orderId, SaleStep.Sale)
      val paid = answer.completed || answer.sale.status == "paid"
      if (paid) keys.answered()
      mutable.update {
        it.copy(
          busy = false,
          lost = false,
          sale = answer.sale,
          notice = if (paid) null else Notice(NoticeTone.INFO, "The sale is up to date: ${formatMoney(answer.sale.dueCents)} is left to pay."),
          step = if (paid) CheckoutStep.Receipt(answer.sale.payments.sumOf { payment -> payment.changeCents }) else CheckoutStep.Tender,
        )
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      mutable.update {
        it.copy(
          busy = false,
          lost = true,
          notice = Notice(NoticeTone.WARNING, "Still offline. The sale is safe; check it again when you reconnect."),
        )
      }
    }
  }

  /** Cancels the unpaid sale; the basket stays for another try. True when it was voided. */
  suspend fun void(): Boolean {
    if (mutable.value.busy) return false
    mutable.update { it.copy(busy = true, notice = null) }
    return try {
      api.payment(mutable.value.opened.orderId, SaleStep.Void)
      mutable.update { it.copy(busy = false) }
      true
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      mutable.update { it.copy(busy = false, notice = Notice(NoticeTone.ERROR, error.message ?: "The sale could not be canceled.")) }
      false
    }
  }

  /**
   * Sends (or records) the receipt: `email` or `sms` to [to], `print` when it
   * printed here, `none` when the customer declined. "No receipt" never holds
   * the next customer, so its note is best-effort. True when the sale is done.
   */
  suspend fun sendReceipt(channel: String, to: String? = null): Boolean {
    if (mutable.value.busy) return false
    if (channel == "none" || channel == "print") {
      runCatching { api.payment(mutable.value.opened.orderId, SaleStep.Receipt(channel)) }
        .exceptionOrNull()?.let { if (it is CancellationException) throw it }
      return true
    }
    mutable.update { it.copy(busy = true, notice = null) }
    return try {
      api.payment(mutable.value.opened.orderId, SaleStep.Receipt(channel, to?.trim()))
      mutable.update { it.copy(busy = false, notice = Notice(NoticeTone.SUCCESS, if (channel == "sms") "Receipt texted." else "Receipt emailed.")) }
      true
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      mutable.update { it.copy(busy = false, notice = Notice(NoticeTone.ERROR, error.message ?: "The receipt could not be sent.")) }
      false
    }
  }
}

private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

fun isReceiptEmail(text: String) = EMAIL.matches(text.trim())

fun isReceiptPhone(text: String) = text.count { it.isDigit() } >= 7
