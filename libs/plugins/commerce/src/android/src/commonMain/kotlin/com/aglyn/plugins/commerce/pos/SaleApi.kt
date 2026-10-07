package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/*
 * THE REGISTER'S ROUTES.
 *
 * The app sells through the SAME routes the console register sells through,
 * with the member's ID token, so every gate the console has (a site role
 * that may sell, `managePos`, the `pos` entitlement, the register's plan
 * seat, the discount ceiling) holds on the device unchanged:
 *
 * - `commerce/pos-order` with `payment: 'open'` prices the basket on the
 *   server and opens a PENDING sale with an empty tender ledger;
 * - `commerce/pos-payment` takes each tender against it (`card-present` for
 *   a smart reader, `card-present-sdk` for this device's reader, `cash`,
 *   `gift-card`), re-reads a card payment (`status`), stops one (`cancel`),
 *   voids an unpaid sale (`void`) and sends the receipt (`receipt`).
 *
 * Every money-moving call carries an Idempotency-Key the caller keeps for
 * that one press, so a retry after a lost answer finds the payment the first
 * press started instead of taking the money twice.
 */

const val POS_ORDER_ROUTE = "/api/commerce/pos-order"
const val POS_PAYMENT_ROUTE = "/api/commerce/pos-payment"

enum class ReceiptDefault { ASK, PRINT, NONE }

data class PosRegisterSettings(
  val tippingEnabled: Boolean = false,
  val tipPercentages: List<Double> = emptyList(),
  val receiptDefault: ReceiptDefault = ReceiptDefault.ASK,
)

data class PosSmartReader(
  val id: String,
  val label: String,
  val registerId: String?,
  val status: String,
  val livemode: Boolean,
) {
  val online: Boolean get() = status == "online"
}

data class PosContext(
  val settings: PosRegisterSettings,
  /** Card readers are offered on this deployment at all. */
  val terminalAvailable: Boolean,
  val testMode: Boolean,
  /** The site's smart (internet) readers, driven through the server. */
  val readers: List<PosSmartReader>,
  val smsReceipts: Boolean,
)

data class PosSalePayment(
  val id: String,
  val method: String,
  val amountCents: Long,
  val tipCents: Long,
  val status: String,
  val cardBrand: String?,
  val last4: String?,
  val changeCents: Long,
  val readerId: String?,
  val failureMessage: String?,
)

data class PosSale(
  val orderId: String,
  val status: String,
  val totalCents: Long,
  val paidCents: Long,
  val dueCents: Long,
  /** What a tender may still take: the due amount less payments in flight. */
  val tenderableCents: Long,
  val tipCents: Long,
  val payments: List<PosSalePayment>,
)

data class PosOpenedSale(
  val orderId: String,
  val subtotalCents: Long?,
  val discountCents: Long?,
  val taxCents: Long?,
  val totalCents: Long,
  val dueCents: Long,
  val stockWarnings: List<String>,
)

data class PosPaymentAnswer(
  val sale: PosSale,
  val paymentId: String?,
  val completed: Boolean,
  val clientSecret: String?,
  val paymentIntentId: String?,
) {
  /** The payment this answer started or re-read. */
  val payment: PosSalePayment? get() = sale.payments.firstOrNull { it.id == paymentId }
}

data class GiftCardBalance(val availableCents: Long, val frozen: Boolean, val voided: Boolean, val last4: String)

internal fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
internal fun JsonElement?.arr(): JsonArray = this as? JsonArray ?: JsonArray(emptyList())
internal fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
internal fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull?.toDoubleOrNull() else it.doubleOrNull }
internal fun JsonElement?.bool(): Boolean = (this as? JsonPrimitive)?.let { !it.isString && it.contentOrNull == "true" } == true
internal fun JsonElement?.cents(): Long = num()?.takeIf { it.isFinite() }?.let(::jsRound) ?: 0

fun readPosContext(body: JsonElement?): PosContext {
  val record = body.obj()
  val settings = record["settings"].obj()
  val receipt = settings["receiptDefault"].str()
  val terminal = record["terminal"].obj()
  return PosContext(
    settings = PosRegisterSettings(
      tippingEnabled = settings["tippingEnabled"].bool(),
      tipPercentages = settings["tipPercentages"].arr().mapNotNull { it.num() }.filter { it.isFinite() && it > 0 }.take(4),
      receiptDefault = when (receipt) {
        "print" -> ReceiptDefault.PRINT
        "none" -> ReceiptDefault.NONE
        else -> ReceiptDefault.ASK
      },
    ),
    terminalAvailable = terminal["available"].bool(),
    testMode = terminal["testMode"].bool(),
    readers = record["readers"].arr().mapNotNull { entry ->
      val reader = entry.obj()
      val id = reader["id"].str() ?: return@mapNotNull null
      PosSmartReader(
        id = id,
        label = reader["label"].str() ?: "Card reader",
        registerId = reader["registerId"].str(),
        status = reader["status"].str() ?: "offline",
        livemode = reader["livemode"].bool(),
      )
    },
    smsReceipts = record["smsReceipts"].bool(),
  )
}

fun readSalePayment(element: JsonElement): PosSalePayment? {
  val payment = element.obj()
  val id = payment["id"].str() ?: return null
  return PosSalePayment(
    id = id,
    method = payment["method"].str() ?: "",
    amountCents = payment["amountCents"].cents(),
    tipCents = payment["tipCents"].cents(),
    status = payment["status"].str() ?: "",
    cardBrand = payment["cardBrand"].str(),
    last4 = payment["last4"].str(),
    changeCents = payment["changeCents"].cents(),
    readerId = payment["readerId"].str(),
    failureMessage = payment["failureMessage"].str(),
  )
}

fun readPaymentAnswer(body: JsonElement?): PosPaymentAnswer {
  val record = body.obj()
  val sale = record["sale"].obj()
  return PosPaymentAnswer(
    sale = PosSale(
      orderId = sale["orderId"].str() ?: "",
      status = sale["status"].str() ?: "",
      totalCents = sale["totalCents"].cents(),
      paidCents = sale["paidCents"].cents(),
      dueCents = sale["dueCents"].cents(),
      tenderableCents = sale["tenderableCents"].cents(),
      tipCents = sale["tipCents"].cents(),
      payments = sale["payments"].arr().mapNotNull(::readSalePayment),
    ),
    paymentId = record["paymentId"].str(),
    completed = record["completed"].bool(),
    clientSecret = record["clientSecret"].str(),
    paymentIntentId = record["paymentIntentId"].str(),
  )
}

fun readOpenedSale(body: JsonElement?): PosOpenedSale {
  val record = body.obj()
  val totals = record["totals"].obj()
  val total = totals["totalCents"].cents()
  return PosOpenedSale(
    orderId = record["orderId"].str() ?: "",
    subtotalCents = totals["subtotalCents"].num()?.let(::jsRound) ?: totals["itemsCents"].num()?.let(::jsRound),
    discountCents = totals["discountCents"].num()?.let(::jsRound),
    taxCents = totals["taxCents"].num()?.let(::jsRound),
    totalCents = total,
    dueCents = record["dueCents"].num()?.let(::jsRound) ?: total,
    stockWarnings = record["stockWarnings"].arr().mapNotNull { entry ->
      val warning = entry.obj()
      val name = warning["name"].str() ?: return@mapNotNull null
      val available = warning["available"].num()?.toLong()
      if (available != null) "$name: $available left" else name
    },
  )
}

/** A sale step: what `pos-payment` is asked to do. A payment-starting step needs its attempt key. */
sealed class SaleStep(val action: String, val startsPayment: Boolean) {
  data class CardPresentSdk(val amountCents: Long, val tipCents: Long) : SaleStep("card-present-sdk", true)
  data class CardPresent(val readerId: String, val amountCents: Long, val tipCents: Long) : SaleStep("card-present", true)
  data class Cash(val tenderedCents: Long, val tipCents: Long, val amountCents: Long?) : SaleStep("cash", true)
  data class GiftCard(val code: String, val amountCents: Long?) : SaleStep("gift-card", true)
  data class Status(val paymentId: String) : SaleStep("status", false)
  data class Cancel(val paymentId: String) : SaleStep("cancel", false)
  data object Sale : SaleStep("sale", false)
  data object Void : SaleStep("void", false)
  data class Receipt(val channel: String, val to: String? = null) : SaleStep("receipt", false)

  fun body(hostId: String, orderId: String): JsonObject = buildJsonObject {
    put("hostId", hostId)
    put("orderId", orderId)
    put("action", action)
    when (val step = this@SaleStep) {
      is CardPresentSdk -> {
        put("amountCents", step.amountCents)
        put("tipCents", step.tipCents)
      }
      is CardPresent -> {
        put("readerId", step.readerId)
        put("amountCents", step.amountCents)
        put("tipCents", step.tipCents)
      }
      is Cash -> {
        put("tenderedCents", step.tenderedCents)
        put("tipCents", step.tipCents)
        step.amountCents?.takeIf { it > 0 }?.let { put("amountCents", it) }
      }
      is GiftCard -> {
        put("code", step.code)
        step.amountCents?.takeIf { it > 0 }?.let { put("amountCents", it) }
      }
      is Status -> put("paymentId", step.paymentId)
      is Cancel -> put("paymentId", step.paymentId)
      is Receipt -> {
        put("channel", step.channel)
        step.to?.let { put("to", it) }
      }
      Sale, Void -> Unit
    }
  }
}

/** The register's calls for one site; specs answer them from a script. */
interface PosSaleApi {
  val hostId: String

  suspend fun context(): PosContext

  /** Opens the sale: the server prices the basket and holds it pending. */
  suspend fun openSale(registerId: String, locationId: String?, cart: Cart, attemptKey: String): PosOpenedSale

  /** One call to the payment route; a payment-starting step needs its attempt key. */
  suspend fun payment(orderId: String, step: SaleStep, attemptKey: String? = null): PosPaymentAnswer

  /** A gift card's spendable balance, to read to the customer. */
  suspend fun giftCardBalance(code: String): GiftCardBalance
}

/** The register's calls over the console API, as the signed-in member. */
class ConsolePosSaleApi(private val api: ConsoleApiClient, override val hostId: String) : PosSaleApi {
  override suspend fun context(): PosContext =
    readPosContext(api.request(POS_PAYMENT_ROUTE, ApiMethod.GET, query = mapOf("hostId" to hostId, "action" to "context")))

  override suspend fun openSale(registerId: String, locationId: String?, cart: Cart, attemptKey: String): PosOpenedSale {
    val body = buildJsonObject {
      put("hostId", hostId)
      put("registerId", registerId)
      locationId?.let { put("locationId", it) }
      put("payment", "open")
      put("lines", cart.saleLines())
      if (cart.discountPct > 0) put("discountPct", cart.discountPct)
      if (cart.customerEmail.isNotEmpty()) put("customerEmail", cart.customerEmail)
    }
    return readOpenedSale(api.request(POS_ORDER_ROUTE, ApiMethod.POST, body, idempotencyKey = attemptKey))
  }

  override suspend fun payment(orderId: String, step: SaleStep, attemptKey: String?): PosPaymentAnswer {
    require(!step.startsPayment || !attemptKey.isNullOrEmpty()) { "A payment needs its attempt key." }
    return readPaymentAnswer(api.request(POS_PAYMENT_ROUTE, ApiMethod.POST, step.body(hostId, orderId), idempotencyKey = attemptKey))
  }

  override suspend fun giftCardBalance(code: String): GiftCardBalance {
    val body = api.request(
      POS_PAYMENT_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("action", "gift-card-balance")
        put("code", code.trim().uppercase())
      },
    ).obj()
    return GiftCardBalance(
      availableCents = body["availableCents"].cents(),
      frozen = body["frozen"].bool(),
      voided = body["voided"].bool(),
      last4 = body["last4"].str() ?: "",
    )
  }
}
