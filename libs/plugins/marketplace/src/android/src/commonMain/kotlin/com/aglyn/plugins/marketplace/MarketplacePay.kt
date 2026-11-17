package com.aglyn.plugins.marketplace

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.boolField
import com.aglyn.core.field
import com.aglyn.core.jsonBody
import com.aglyn.core.numberField
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.random.Random

/*
 * BUYING A PAID LISTING (AGL-4049), as the console's listing page buys it: `use-marketplace-pay.tsx` and
 * `marketplace-pay-panel.component.tsx`. The same door (`/api/marketplace/pay`: quote, then pay with one key per press,
 * then settle after the bank's step), the same total before Pay, the same prerequisites and refusals, in place under
 * the Buy button.
 *
 * Two steps the console takes with Stripe.js happen on Stripe's own pages here, in the secure browser tab, as the app's
 * Billing already takes them: a card is added on Stripe's billing portal (`payment_method_update`, Billing details'
 * "Add a payment method on Stripe"), and a bank that wants to confirm a payment does so on the invoice's own page
 * (`hostedInvoiceUrl`, Billing's plan change). Back in the app the purchase is asked about again. The Apple plugin's
 * MarketplacePay.swift.
 */

/** The card a quote names, as far as this person may see it (`PayQuoteCard`). */
data class PayQuoteCard(val type: String? = null, val brand: String? = null, val last4: String? = null, val email: String? = null) {
  companion object {
    fun from(value: JsonElement?): PayQuoteCard? = (value as? JsonObject)?.let {
      PayQuoteCard(it.field("type"), it.field("brand"), it.field("last4"), it.field("email"))
    }
  }
}

/** What the door answers a `quote` with: what will be charged, before it is (`PayQuote`). */
data class PayQuote(
  val listingName: String,
  val amountCents: Int,
  val taxCents: Int,
  val totalCents: Int,
  /** null for someone who may buy but may not see billing. */
  val card: PayQuoteCard?,
  /** Whether this person holds `billing.manage`, which paying takes. */
  val canPay: Boolean,
) {
  companion object {
    fun from(value: JsonElement?): PayQuote? {
      val quote = value as? JsonObject ?: return null
      fun cents(key: String) = quote.numberField(key)?.roundToInt() ?: 0
      return PayQuote(
        listingName = quote.field("listingName").orEmpty(),
        amountCents = cents("amountCents"),
        taxCents = cents("taxCents"),
        totalCents = cents("totalCents"),
        card = PayQuoteCard.from(quote["card"]),
        canPay = quote.boolField("canPay") == true,
      )
    }
  }
}

/** The two things a workspace needs before it can be charged (`PayPrerequisite`). */
enum class PayPrerequisite(val code: String) { CARD_REQUIRED("card_required"), BILLING_ADDRESS_REQUIRED("billing_address_required") }

/** The prerequisite a refusal names, or null when it names none (`payPrerequisiteOf`). */
fun payPrerequisite(status: Int, body: JsonElement?): PayPrerequisite? {
  if (status != 412) return null
  val code = body.field("code") ?: return null
  return PayPrerequisite.entries.firstOrNull { it.code == code }
}

/** Dollars and cents, for a line a buyer is about to agree to (`formatPayCents`: en-US currency, grouped). */
fun formatPayCents(cents: Int): String {
  val sign = if (cents < 0) "-" else ""
  val magnitude = abs(cents)
  val whole = (magnitude / 100).toString()
  val grouped = StringBuilder()
  whole.forEachIndexed { index, digit ->
    if (index > 0 && (whole.length - index) % 3 == 0) grouped.append(',')
    grouped.append(digit)
  }
  return "$sign\$$grouped.${(magnitude % 100).toString().padStart(2, '0')}"
}

/** The saved method in words, wallets included: they carry an email, not a number (`payCardLabel`). */
fun payCardLabel(card: PayQuoteCard?): String {
  val last4 = card?.last4
  if (!last4.isNullOrEmpty()) return "${(card.brand ?: card.type ?: "card").uppercase()} •••• $last4"
  val email = card?.email
  if (!email.isNullOrEmpty()) return "${card.type ?: "wallet"} · $email"
  return "the card on file"
}

/**
 * A feature lockdown's refusal in one line (`parseLockdownRefusal` + `lockdownRefusalText`): the title is led only when the
 * message does not already open with it.
 */
fun lockdownRefusalLine(status: Int, body: JsonElement?): String? {
  if (status != 423) return null
  val title = body.field("title")?.trim()?.ifEmpty { null } ?: "Temporarily unavailable"
  val message = body.field("message")?.trim()?.ifEmpty { null } ?: "This is paused for a moment. Try again later."
  return if (message.lowercase().startsWith(title.lowercase())) message else "$title — $message"
}

/** What a refused answer says to the buyer (`refusalText`). */
fun payRefusalText(status: Int, body: JsonElement?): String =
  lockdownRefusalLine(status, body)
    ?: if (status == 501) "Purchases are not set up on this deployment." else body.field("error")?.ifEmpty { null } ?: "The payment did not go through."

/** Which part of paying for a listing is on screen (`PayStep`). */
sealed interface PayStep {
  data class Confirm(val quote: PayQuote) : PayStep
  /** A card is needed, and this person can add one: on Stripe's page. */
  data object Card : PayStep
  data object Address : PayStep
  /** Something is needed that this person cannot add. */
  data class AskBilling(val need: PayPrerequisite, val amountCents: Int?) : PayStep
  /** The bank is confirming the payment on the invoice's Stripe page. */
  data object Bank : PayStep
}

/** How one purchase ended (`MarketplacePayOutcome`). */
sealed interface PayOutcome {
  /** Paid, and the purchase is on record: the workspace owns it now. */
  data object Paid : PayOutcome
  /** The workspace owns it already: nothing was charged. */
  data object Owned : PayOutcome
  /** Stripe accepted the payment and it has not cleared yet. */
  data object Pending : PayOutcome
  /** Closed before paying, or it could not open: [error] says which. */
  data class Stopped(val error: String? = null, val locked: Boolean = false) : PayOutcome
}

/** A purchase's notice tone, without the UI kit. */
enum class PayNoticeTone { SUCCESS, INFO, WARNING, ERROR }

/** What the listing says once a purchase ends, and its tone (the console's `buy` snackbars); null says nothing. */
fun payOutcomeNotice(outcome: PayOutcome, name: String): Pair<String, PayNoticeTone>? = when (outcome) {
  PayOutcome.Paid -> "Bought \"$name\". It is yours to install." to PayNoticeTone.SUCCESS
  PayOutcome.Owned -> "This organization already owns \"$name\"." to PayNoticeTone.INFO
  PayOutcome.Pending -> "Your payment for \"$name\" is going through. It is yours as soon as it clears." to PayNoticeTone.INFO
  is PayOutcome.Stopped -> outcome.error?.let { it to if (outcome.locked) PayNoticeTone.WARNING else PayNoticeTone.ERROR }
}

/** The address fields the console's Billing address form hands back (`BillingAddressValue`). */
data class PayBillingAddress(
  val name: String = "",
  val line1: String = "",
  val line2: String = "",
  val city: String = "",
  val state: String = "",
  val postalCode: String = "",
  val country: String = "",
) {
  /** The two the route requires: a street line and a two-letter country (`set-billing-address`). */
  val complete: Boolean get() = line1.isNotBlank() && country.trim().length == 2
}

// Who must buy (the listing page's own reads)

/**
 * Whether one purchase still licenses this workspace (`purchaseEntitlesOrg`): a purchase naming a workspace licenses that
 * one; one naming none (before AGL-2331) licenses its buyer, wherever they install.
 */
fun purchaseEntitles(licence: LicenceRow, orgId: String?, uid: String): Boolean {
  val buyerOrgId = licence.buyerOrgId ?: return uid.isNotEmpty() && licence.buyerUid == uid
  return !orgId.isNullOrEmpty() && orgId == buyerOrgId
}

/** Whether these live purchases license this workspace for [listingId] (`hasOrgLicenceOf`). */
fun hasOrgLicence(purchases: List<LicenceRow>, listingId: String, orgId: String?, uid: String): Boolean =
  listingId.isNotEmpty() && purchases.any { it.listingId == listingId && purchaseEntitles(it, orgId, uid) }

/** The buyer holds a licence for [listingId] in another workspace, and none here (`licensedElsewhere`). */
fun licensedElsewhere(purchases: List<LicenceRow>, listingId: String, orgId: String?, uid: String): Boolean =
  !hasOrgLicence(purchases, listingId, orgId, uid) && purchases.any { it.listingId == listingId && it.buyerOrgId != null && it.buyerOrgId != orgId }

/** Whether this listing has to be bought before it installs here (`mustBuy`). */
fun mustBuy(priceUsd: Double, purchased: Boolean, ownWorkspace: Boolean, installed: Boolean): Boolean =
  priceUsd > 0 && !purchased && !ownWorkspace && !installed

/** The Buy button's words (`Buy for $X`, or `Buy for this workspace — $X` beside a licence held elsewhere). */
fun buyLabel(priceUsd: Double, licensedElsewhere: Boolean): String {
  val price = "$" + com.aglyn.pluginhost.jsNumber(priceUsd)
  return if (licensedElsewhere) "Buy for this workspace — $price" else "Buy for $price"
}

/** Why Buy is off for a member of the publishing workspace, in one sentence (`publisherMemberBuyReason`). */
fun publisherMemberBuyReason(publisherName: String?): String =
  "Someone in this workspace who isn't in ${publisherName?.trim()?.ifEmpty { null } ?: "the publishing workspace"} needs to buy it."

/** The permission a buyer's Buy asks for, as the pay door asks it: a site starter is bought to create a site with. */
fun buyPermissionKey(artifactType: String): String = if (artifactType == "siteStarter") "hosts.create" else INSTALL_PLUGINS_KEY

/** How many of the person's own purchases the listing page reads to decide Buy (`PURCHASE_LOOKUP_CEILING`). */
const val PURCHASE_LOOKUP_CEILING = 200

fun listingPurchasesQuery(uid: String) = boughtByYouQuery(uid, null, PURCHASE_LOOKUP_CEILING)

// The door

/** What the pay door answered a `pay` or a `settle`. */
sealed interface PayAnswer {
  data object Paid : PayAnswer
  data object Submitted : PayAnswer
  /** The bank wants the buyer: the invoice, and its Stripe page when the door named one. */
  data class RequiresAction(val invoiceId: String, val page: String?) : PayAnswer
  data object Unknown : PayAnswer

  companion object {
    fun from(body: JsonElement?): PayAnswer {
      val invoiceId = body.field("invoiceId")
      return when {
        body.boolField("paid") == true -> Paid
        body.boolField("submitted") == true -> Submitted
        body.boolField("requiresAction") == true && invoiceId != null ->
          RequiresAction(invoiceId, body.field("hostedInvoiceUrl")?.takeIf { it.startsWith("https://") })
        else -> Unknown
      }
    }
  }
}

/** `/api/marketplace/pay` and the two Billing routes its prerequisites use. */
class MarketplacePayApi(private val api: ConsoleApiClient, private val orgId: String, private val hostId: String?) {
  private suspend fun door(listingId: String, vararg fields: Pair<String, Any?>, key: String? = null): JsonElement? =
    api.request(
      "/api/marketplace/pay",
      ApiMethod.POST,
      // The site it is bought from, when there is one, so the dispatcher can gate it; none is sent as none, as the console's.
      jsonBody("listingId" to listingId, "orgId" to orgId, *(hostId?.let { arrayOf<Pair<String, Any?>>("hostId" to it) } ?: emptyArray<Pair<String, Any?>>()), *fields),
      idempotencyKey = key,
    )

  suspend fun quote(listingId: String): PayQuote? = PayQuote.from((door(listingId, "action" to "quote") as? JsonObject)?.get("quote"))

  /** One press of Pay: the same [key] replays this attempt rather than charging twice (AGL-1697). */
  suspend fun pay(listingId: String, expectedTotalCents: Int, key: String): PayAnswer =
    PayAnswer.from(door(listingId, "expectedTotalCents" to expectedTotalCents, key = key))

  suspend fun settle(listingId: String, invoiceId: String): PayAnswer =
    PayAnswer.from(door(listingId, "action" to "settle", "invoiceId" to invoiceId))

  private suspend fun billing(vararg fields: Pair<String, Any?>): JsonElement? =
    api.request("/api/billing/profile", ApiMethod.POST, jsonBody("orgId" to orgId, *fields))

  suspend fun setBillingAddress(address: PayBillingAddress) {
    billing(
      "action" to "set-billing-address", "name" to address.name, "line1" to address.line1, "line2" to address.line2,
      "city" to address.city, "state" to address.state, "postalCode" to address.postalCode, "country" to address.country.uppercase(),
    )
  }

  /**
   * Stripe's add-a-payment-method page for the workspace (Billing details' "Add a payment method on Stripe"). A workspace
   * with no Stripe customer yet gets one first, the way the console's card form gets one (`create-setup-intent`).
   */
  suspend fun cardPage(): String? {
    suspend fun portal() = api.request(
      "/api/billing/subscription",
      ApiMethod.POST,
      jsonBody("orgId" to orgId, "action" to "portal", "flow" to "payment_method_update"),
    ).field("url")
    return try {
      portal()
    } catch (refused: ConsoleApiError) {
      if (refused.status != 409) throw refused
      billing("action" to "create-setup-intent")
      portal()
    }
  }
}

/** A fresh key for one press of Pay. */
private fun newAttemptKey(): String = List(4) { Random.nextLong().toULong().toString(36) }.joinToString("-")

/**
 * Buying one listing (`useMarketplacePay`): asks the door what it would charge before it shows anything, so the total, the
 * prerequisite or the refusal is the first thing the buyer sees; one key per press of Pay.
 *
 * [openPage] opens one of Stripe's pages in the secure browser tab. A tab does not say when it closes, so the screen calls
 * [backFromStripe] when the app is in front again (and the buyer can say so with a button).
 */
class MarketplacePay(
  private val api: MarketplacePayApi,
  private val openPage: (String) -> Unit,
  private val onFinish: (PayOutcome) -> Unit,
  private val newKey: () -> String = ::newAttemptKey,
) {
  var step by mutableStateOf<PayStep?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
  /** The listing being bought, and its name as the page shows it. */
  var listing by mutableStateOf<Pair<String, String>?>(null)
    private set
  /** Stripe's page is open, and the app is waiting for the buyer to come back from it. */
  var away by mutableStateOf(false)
    private set

  private val attemptKeys = mutableMapOf<String, String>()
  private var lastQuote: PayQuote? = null
  private var pendingInvoice: Pair<String, Boolean>? = null

  val open: Boolean get() = step != null

  private fun finish(outcome: PayOutcome) {
    step = null
    listing = null
    busy = false
    error = null
    away = false
    lastQuote = null
    pendingInvoice = null
    onFinish(outcome)
  }

  private fun answered(error: Throwable): ConsoleApiError? = (error as? ConsoleApiError)?.takeIf { it.status != 0 }

  /** Opens payment for a listing. */
  suspend fun buy(listingId: String, name: String) {
    if (listingId.isEmpty() || step != null || busy) return
    listing = listingId to name
    error = null
    busy = true
    try {
      quote()?.let { return finish(it) }
      busy = false
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Throwable) {
      finish(PayOutcome.Stopped("The payment could not open. Check your connection and try again."))
    }
  }

  /** Asks what it would cost now and shows what that needs: the outcome when the purchase ends here, null when a step is up. */
  private suspend fun quote(): PayOutcome? {
    val (listingId, _) = listing ?: return PayOutcome.Stopped()
    return try {
      val quote = api.quote(listingId) ?: return PayOutcome.Stopped("The payment did not go through.")
      lastQuote = quote
      step = PayStep.Confirm(quote)
      null
    } catch (refused: ConsoleApiError) {
      if (refused.status == 0) throw refused
      if (refused.status == 409 && refused.body.field("code") == "already_purchased") return PayOutcome.Owned
      payPrerequisite(refused.status, refused.body)?.let { meet(it, refused.body); return null }
      PayOutcome.Stopped(payRefusalText(refused.status, refused.body), locked = refused.status == 423)
    }
  }

  /** Moves to the step a prerequisite needs: a form or Stripe's page here, or who can meet it. */
  private fun meet(need: PayPrerequisite, body: JsonElement?) {
    step = when {
      body.boolField("canManageBilling") != true -> PayStep.AskBilling(need, body.numberField("amountCents")?.roundToInt())
      need == PayPrerequisite.BILLING_ADDRESS_REQUIRED -> PayStep.Address
      else -> PayStep.Card
    }
  }

  /** Goes back to the total once a card or an address is on file. */
  private suspend fun returnToQuote() {
    busy = true
    try {
      when (val ended = quote()) {
        PayOutcome.Owned -> return finish(PayOutcome.Owned)
        is PayOutcome.Stopped -> error = ended.error
        else -> Unit
      }
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Throwable) {
      error = "The payment could not open. Check your connection and try again."
    } finally {
      busy = false
    }
  }

  /** Adds a card on Stripe's page; [backFromStripe] asks for the total again. */
  suspend fun addCard() {
    if (step != PayStep.Card || busy) return
    busy = true
    error = null
    val page = try {
      api.cardPage()
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (failed: Throwable) {
      busy = false
      error = answered(failed)?.message ?: "The card form could not open."
      return
    }
    busy = false
    if (page == null) {
      error = "The card form could not open."
      return
    }
    away = true
    openPage(page)
  }

  suspend fun saveAddress(address: PayBillingAddress) {
    if (step != PayStep.Address || busy) return
    busy = true
    error = null
    try {
      api.setBillingAddress(address)
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (failed: Throwable) {
      busy = false
      error = answered(failed)?.message ?: "Billing could not be reached."
      return
    }
    returnToQuote()
  }

  /** One press of Pay. */
  suspend fun pay() {
    val (listingId, _) = listing ?: return
    val quote = (step as? PayStep.Confirm)?.quote ?: return
    if (busy) return
    val key = attemptKeys.getOrPut(listingId, newKey)
    busy = true
    error = null
    try {
      val answer = api.pay(listingId, quote.totalCents, key)
      attemptKeys.remove(listingId)
      when (answer) {
        PayAnswer.Paid -> return finish(PayOutcome.Paid)
        PayAnswer.Submitted -> return finish(PayOutcome.Pending)
        is PayAnswer.RequiresAction -> return confirmWithBank(answer.invoiceId, answer.page)
        PayAnswer.Unknown -> error = "The payment did not go through."
      }
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (failed: Throwable) {
      val refused = answered(failed)
      if (refused == null) {
        // No answer came back, so this attempt may still be running: the key stays, and a second press replays it.
        error = "The payment could not be confirmed. Check your connection and try again."
      } else {
        // An answer ends this attempt: the next press of Pay is a new one.
        attemptKeys.remove(listingId)
        val code = refused.body.field("code")
        when {
          refused.status == 409 && code == "already_purchased" -> return finish(PayOutcome.Owned)
          refused.status == 409 && code == "total_changed" -> {
            returnToQuote()
            error = payRefusalText(refused.status, refused.body)
          }
          else -> payPrerequisite(refused.status, refused.body)?.let { meet(it, refused.body) }
            ?: run { error = payRefusalText(refused.status, refused.body) }
        }
      }
    } finally {
      busy = false
    }
  }

  /** The bank's step on the invoice's Stripe page. Without one the server is asked at once, and voids it. */
  private suspend fun confirmWithBank(invoiceId: String, page: String?) {
    step = PayStep.Bank
    pendingInvoice = invoiceId to (page != null)
    if (page == null) return settle()
    away = true
    openPage(page)
  }

  /** The buyer is back from Stripe's page: the total again after a card, the server's word after the bank. */
  suspend fun backFromStripe() {
    if (!away) return
    away = false
    when (step) {
      PayStep.Card -> returnToQuote()
      PayStep.Bank -> settle()
      else -> Unit
    }
  }

  /** Back here, the server decides: it records a payment that landed and voids one that did not. */
  private suspend fun settle() {
    val (listingId, _) = listing ?: return
    val (invoiceId, hadPage) = pendingInvoice ?: return
    busy = true
    try {
      when (api.settle(listingId, invoiceId)) {
        PayAnswer.Paid -> return finish(PayOutcome.Paid)
        PayAnswer.Submitted -> return finish(PayOutcome.Pending)
        else -> error = "The payment did not go through."
      }
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (failed: Throwable) {
      val refused = answered(failed)
      error = when {
        refused == null -> "The payment could not be confirmed. Check your connection and try again."
        !hadPage -> "Your bank needs to confirm this payment, but it cannot be finished here. Nothing has changed and nothing has been charged."
        else -> payRefusalText(refused.status, refused.body)
      }
    } finally {
      busy = false
    }
    pendingInvoice = null
    lastQuote?.let { step = PayStep.Confirm(it) }
  }

  fun cancel() {
    if (busy) return
    finish(PayOutcome.Stopped())
  }
}
