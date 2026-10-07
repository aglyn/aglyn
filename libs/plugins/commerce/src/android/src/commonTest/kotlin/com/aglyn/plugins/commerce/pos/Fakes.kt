package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ConsoleApiError

/** One recorded call to the payment route. */
data class Call(val action: String, val step: SaleStep, val key: String?)

/** The register's routes, answering each action from a script, in order. */
class ScriptedSaleApi(script: Map<String, List<Any>> = emptyMap()) : PosSaleApi {
  override val hostId = "h1"
  private val queues = script.mapValues { it.value.toMutableList() }.toMutableMap()
  val calls = mutableListOf<Call>()
  val actions get() = calls.map { it.action }
  var opened: PosOpenedSale = opened()

  fun answer(action: String, vararg next: Any) {
    queues.getOrPut(action) { mutableListOf() }.addAll(next)
  }

  override suspend fun context() = PosContext(PosRegisterSettings(), terminalAvailable = true, testMode = true, readers = emptyList(), smsReceipts = false)

  override suspend fun openSale(registerId: String, locationId: String?, cart: Cart, attemptKey: String) = opened

  override suspend fun payment(orderId: String, step: SaleStep, attemptKey: String?): PosPaymentAnswer {
    require(!step.startsPayment || !attemptKey.isNullOrEmpty()) { "A payment needs its attempt key." }
    calls += Call(step.action, step, attemptKey)
    val next = queues[step.action]?.removeFirstOrNull()
    if (next is Throwable) throw next
    return next as? PosPaymentAnswer ?: sale(emptyList())
  }

  override suspend fun giftCardBalance(code: String): GiftCardBalance {
    calls += Call("gift-card-balance", SaleStep.Sale, null)
    val next = queues["gift-card-balance"]?.removeFirstOrNull()
    if (next is Throwable) throw next
    return next as GiftCardBalance
  }
}

fun opened(total: Long = 1000) = PosOpenedSale("o1", 1000, null, null, total, total, emptyList())

fun payment(
  id: String = "pay1",
  status: String = "pending",
  method: String = "card_present",
  amountCents: Long = 1000,
  tipCents: Long = 0,
  changeCents: Long = 0,
  failureMessage: String? = null,
  readerId: String? = null,
) = PosSalePayment(id, method, amountCents, tipCents, status, null, null, changeCents, readerId, failureMessage)

fun sale(
  payments: List<PosSalePayment>,
  paymentId: String? = payments.firstOrNull()?.id,
  dueCents: Long = 1000,
  status: String = "pending",
  completed: Boolean = false,
  clientSecret: String? = null,
  paymentIntentId: String? = null,
) = PosPaymentAnswer(
  sale = PosSale("o1", status, 1000, 1000 - dueCents, dueCents, dueCents, 0, payments),
  paymentId = paymentId,
  completed = completed,
  clientSecret = clientSecret,
  paymentIntentId = paymentIntentId,
)

/** A dropped connection, as the API client reports it. */
fun lost() = ConsoleApiError("could not be reached", 0, null)

fun refused(message: String, status: Int = 400) = ConsoleApiError(message, status, null)

val noSleep: suspend (Long) -> Unit = {}
