package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.HostProduct
import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.OrderAddress
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.QuoteCustomerRecord
import com.aglyn.contracts.QuoteDiscount
import com.aglyn.contracts.QuoteDiscountKind
import com.aglyn.contracts.QuoteLineRequest
import com.aglyn.contracts.QuoteStage
import com.aglyn.contracts.computeQuoteTotals
import com.aglyn.contracts.describeQuoteTax
import com.aglyn.contracts.formatOrderMoney
import com.aglyn.contracts.formatQuoteNumber
import com.aglyn.contracts.isUnpaidQuote
import com.aglyn.contracts.liftLegacyProduct
import com.aglyn.contracts.payLinkStoreOf
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.contracts.priceQuoteCustomLine
import com.aglyn.contracts.quoteLineCents
import com.aglyn.contracts.quoteLineRequestFromLine
import com.aglyn.contracts.quotePayTax
import com.aglyn.contracts.quoteRequiresProofApprovalByDefault
import com.aglyn.contracts.quoteRequiresProofSignInByDefault
import com.aglyn.contracts.quoteTaxBasisFromSettings
import com.aglyn.contracts.quoteTotalsLineOf
import com.aglyn.contracts.storeTaxSettingsOf
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.Busy
import com.aglyn.ui.FormSheet
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor

/*
 * The quote editor (AGL-4093), as the console's QuoteEditorDialog has it: who the quote is for, its lines (products
 * with their options and add-ons, typed items, things included at no charge), discount, shipping, the two addresses,
 * notes and terms, with the totals worked out as it is edited. The server prices and saves it
 * (`POST /api/commerce/quote` create or update); the totals here are the same functions over the same inputs. A saved
 * quote left as it is shows what its customer's page shows. Sending, the pay link and proofs are not here yet.
 * The Apple kit's QuoteEditor.swift.
 */

const val QUOTE_EDIT_PERMISSION = "commerce.quotes"

/** How many products the editor's picker offers (the console's `PRODUCT_WINDOW`). */
const val QUOTE_PRODUCT_WINDOW = 200

/** Dollars typed into a field, as whole cents; 0 for nothing, null when it is not an amount (the console's `centsOf`). */
fun quoteCentsOf(text: String): Long? {
  val trimmed = text.trim()
  if (trimmed.isEmpty()) return 0
  if (!Regex("""^\d+(\.\d{0,2})?$""").matches(trimmed)) return null
  return floor(trimmed.toDouble() * 100 + 0.5).toLong()
}

/** Cents as the field shows them: `12.5`, `40`, or nothing for none (the console's `dollarsOf`). */
fun quoteDollarsOf(cents: Double?): String {
  if (cents == null || cents == 0.0) return ""
  val whole = floor(cents / 100 + 1e-9).toLong()
  val rest = (floor(cents + 0.5).toLong() - whole * 100).toInt()
  val text = "$whole.${rest.toString().padStart(2, '0')}"
  return text.removeSuffix(".00")
}

data class QuoteAddressDraft(
  val name: String = "", val line1: String = "", val line2: String = "", val city: String = "", val state: String = "",
  val postalCode: String = "", val country: String = "",
) {
  /** What the server is sent: the filled fields, trimmed, or null when none is (`addressBody`). */
  fun body(): JsonElement {
    val filled = listOf("name" to name, "line1" to line1, "line2" to line2, "city" to city, "state" to state, "postalCode" to postalCode, "country" to country)
      .mapNotNull { (key, value) -> value.trim().takeIf { it.isNotEmpty() }?.let { key to JsonPrimitive(it) } }
    return if (filled.isEmpty()) JsonNull else JsonObject(filled.toMap())
  }

  companion object {
    fun of(address: OrderAddress?) = QuoteAddressDraft(
      address?.name.orEmpty(), address?.line1.orEmpty(), address?.line2.orEmpty(), address?.city.orEmpty(),
      address?.state.orEmpty(), address?.postalCode.orEmpty(), address?.country.orEmpty(),
    )
  }
}

private var quoteLineSequence = 0L

/** One line as the form edits it (the console's `LineForm`). */
data class QuoteLineDraft(
  val custom: Boolean,
  val key: Long = ++quoteLineSequence,
  val productId: String = "",
  val variantId: String = "",
  val modifiers: List<ModifierSelection> = emptyList(),
  val name: String = "",
  val sku: String = "",
  val price: String = "",
  val ships: Boolean = true,
  val quantity: String = "1",
  val description: String = "",
  val included: Boolean = false,
) {
  private val quantityNumber: Double get() = quantity.toDoubleOrNull() ?: Double.NaN
  private val trimmedDescription: String? get() = description.trim().ifEmpty { null }

  /** What the server is sent for the line: its choices, never what a product costs (`lineRequest`). */
  fun body(): JsonObject {
    val fields = mutableMapOf<String, JsonElement>(
      "kind" to JsonPrimitive(if (custom) "custom" else "catalog"),
      "quantity" to JsonPrimitive(if (quantityNumber.isNaN()) 0.0 else quantityNumber),
    )
    trimmedDescription?.let { fields["description"] = JsonPrimitive(it) }
    if (included) fields["included"] = JsonPrimitive(true)
    if (custom) {
      fields["name"] = JsonPrimitive(name.trim())
      sku.trim().takeIf { it.isNotEmpty() }?.let { fields["sku"] = JsonPrimitive(it) }
      fields["unitAmountCents"] = JsonPrimitive(if (included) 0 else (quoteCentsOf(price) ?: -1))
      fields["ships"] = JsonPrimitive(ships)
    } else {
      fields["productId"] = JsonPrimitive(productId)
      if (variantId.isNotEmpty()) fields["variantId"] = JsonPrimitive(variantId)
      if (modifiers.isNotEmpty()) {
        fields["modifiers"] = JsonArray(modifiers.map { JsonObject(mapOf("groupId" to JsonPrimitive(it.groupId), "optionId" to JsonPrimitive(it.optionId))) })
      }
    }
    return JsonObject(fields)
  }

  /** The line priced as the server will price it, or why it can't be (the editor's `priced`). */
  fun priced(products: Map<String, HostProduct>): PricedQuoteLine {
    if (custom) {
      if (name.isBlank()) return PricedQuoteLine.Refused("Name the item.")
      val cents = if (included) 0L else quoteCentsOf(price) ?: return PricedQuoteLine.Refused("Enter a price.")
      if (!(quantityNumber >= 1)) return PricedQuoteLine.Refused("Enter a quantity.")
      return PricedQuoteLine.Ok(
        priceQuoteCustomLine(QuoteLineRequest.Custom(name.trim(), trimmedDescription, sku.trim(), cents.toDouble(), quantityNumber, ships, included)),
      )
    }
    if (productId.isEmpty()) return PricedQuoteLine.Refused("Choose a product.")
    if (!(quantityNumber >= 1)) return PricedQuoteLine.Refused("Enter a quantity.")
    return priceQuoteCatalogLine(
      products[productId],
      QuoteLineRequest.Catalog(productId, variantId.ifEmpty { null }, quantityNumber, modifiers, included, trimmedDescription),
    )
  }

  companion object {
    fun of(line: com.aglyn.contracts.OrderLineItem): QuoteLineDraft = when (val request = quoteLineRequestFromLine(line)) {
      is QuoteLineRequest.Custom -> QuoteLineDraft(
        custom = true, name = request.name, description = request.description.orEmpty(), sku = request.sku.orEmpty(),
        price = quoteDollarsOf(request.unitAmountCents), quantity = request.quantity.toLong().toString(), ships = request.ships,
        included = request.included,
      )
      is QuoteLineRequest.Catalog -> QuoteLineDraft(
        custom = false, productId = request.productId, variantId = request.variantId.orEmpty(),
        quantity = request.quantity.toLong().toString(), modifiers = request.modifiers, description = request.description.orEmpty(),
        included = request.included,
      )
    }
  }
}

/** Everything the editor changes (the console's `QuoteForm`). */
data class QuoteDraft(
  val lines: List<QuoteLineDraft> = emptyList(),
  val record: QuoteCustomerRecord? = null,
  val name: String = "", val company: String = "", val email: String = "", val phone: String = "",
  val shipTo: QuoteAddressDraft = QuoteAddressDraft(),
  val billTo: QuoteAddressDraft = QuoteAddressDraft(),
  val discountKind: String = "none",
  val discountValue: String = "",
  val shipping: String = "",
  val notes: String = "",
  val terms: String = "",
  val requireProofApproval: Boolean = false,
  val requireProofSignIn: Boolean = false,
) {
  /** The discount as the totals read it, or null (the editor's `discount`). */
  val discount: QuoteDiscount?
    get() = when (discountKind) {
      "amount" -> quoteCentsOf(discountValue)?.takeIf { it > 0 }?.let { QuoteDiscount(amountCents = it.toDouble(), kind = QuoteDiscountKind.AMOUNT) }
      "percent" -> discountValue.toDoubleOrNull()?.takeIf { it > 0 }?.let { QuoteDiscount(kind = QuoteDiscountKind.PERCENT, pct = minOf(100.0, it)) }
      else -> null
    }

  /** What the server is sent (`quoteBody`): choices, never what a product costs. */
  fun body(requireProofApproval: Boolean, requireProofSignIn: Boolean): JsonObject {
    val priced = lines.isNotEmpty()
    val customer = mutableMapOf<String, JsonElement>(
      "name" to JsonPrimitive(name), "company" to JsonPrimitive(company), "email" to JsonPrimitive(email), "phone" to JsonPrimitive(phone),
    )
    record?.let { customer["record"] = JsonObject(mapOf("kind" to JsonPrimitive(it.kind), "id" to JsonPrimitive(it.id))) }
    val discountBody: JsonElement = if (!priced) JsonNull else when (discountKind) {
      "amount" -> JsonObject(mapOf("kind" to JsonPrimitive("amount"), "amountCents" to JsonPrimitive(quoteCentsOf(discountValue) ?: -1)))
      "percent" -> JsonObject(mapOf("kind" to JsonPrimitive("percent"), "pct" to JsonPrimitive(discountValue.toDoubleOrNull() ?: 0.0)))
      else -> JsonNull
    }
    val shippingBody: JsonElement =
      if (priced && shipping.isNotBlank()) JsonObject(mapOf("amountCents" to JsonPrimitive(quoteCentsOf(shipping) ?: -1))) else JsonNull
    return JsonObject(
      mapOf(
        "lines" to JsonArray(lines.map { it.body() }),
        "customer" to JsonObject(customer),
        "shipTo" to shipTo.body(),
        "billTo" to billTo.body(),
        "discount" to discountBody,
        "shipping" to shippingBody,
        "notes" to JsonPrimitive(notes),
        "terms" to JsonPrimitive(terms),
        "requireProofApproval" to JsonPrimitive(requireProofApproval),
        "requireProofSignIn" to JsonPrimitive(requireProofSignIn),
      ),
    )
  }

  companion object {
    fun of(order: HostOrder): QuoteDraft {
      val quote = order.quote
      val discount = quote?.discount
      return QuoteDraft(
        lines = order.lineItems.orEmpty().map(QuoteLineDraft::of),
        record = quote?.customer?.record,
        name = quote?.customer?.name.orEmpty(), company = quote?.customer?.company.orEmpty(),
        email = quote?.customer?.email.orEmpty(), phone = quote?.customer?.phone.orEmpty(),
        shipTo = QuoteAddressDraft.of(quote?.shipTo), billTo = QuoteAddressDraft.of(quote?.billTo),
        discountKind = when (discount?.kind) { QuoteDiscountKind.AMOUNT -> "amount"; QuoteDiscountKind.PERCENT -> "percent"; else -> "none" },
        discountValue = when (discount?.kind) {
          QuoteDiscountKind.AMOUNT -> quoteDollarsOf(discount.amountCents)
          QuoteDiscountKind.PERCENT -> discount.pct?.let { if (it == floor(it)) it.toLong().toString() else it.toString() }.orEmpty()
          else -> ""
        },
        shipping = quoteDollarsOf(quote?.shipping?.amountCents),
        notes = quote?.notes.orEmpty(), terms = quote?.terms.orEmpty(),
        requireProofApproval = quote?.requireProofApproval == true, requireProofSignIn = quote?.requireProofSignIn == true,
      )
    }
  }
}

/** One person the workspace keeps, as `search-customers` answers. */
private data class FoundQuoteCustomer(val record: QuoteCustomerRecord, val name: String, val company: String, val email: String, val phone: String)

private fun JsonElement?.text(): String = (this as? JsonPrimitive)?.contentOrNull.orEmpty()

/**
 * The editor: a new quote ([order] null), or a saved one with the version it was opened on. [onDone] says
 * "{Quote #n} saved" or "{Quote #n} deleted", and whether it was deleted.
 */
@Composable
fun QuoteEditorSheet(
  context: NativePluginContext,
  quoteId: String?,
  order: HostOrder?,
  products: List<Pair<String, HostProduct>>,
  storeData: Map<String, Any?>?,
  onDismiss: () -> Unit,
  onDone: (String, Boolean) -> Unit,
) {
  val hostId = context.hostId.orEmpty()
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  val canEdit = rememberMemberPermissions(context).can(QUOTE_EDIT_PERMISSION)
  val byId = remember(products) { products.toMap() }
  @Suppress("UNCHECKED_CAST") val quotesSettings = storeData?.get("quotes") as? Map<String, Any?>
  @Suppress("UNCHECKED_CAST") val taxMap = storeData?.get("tax") as? Map<String, Any?>
  var draft by remember { mutableStateOf(order?.let(QuoteDraft::of) ?: QuoteDraft()) }
  var edited by remember { mutableStateOf(false) }
  var approvalSet by remember { mutableStateOf(false) }
  var signInSet by remember { mutableStateOf(false) }
  var attemptKey by remember { mutableStateOf<String?>(null) }
  var search by remember { mutableStateOf("") }
  var found by remember { mutableStateOf(emptyList<FoundQuoteCustomer>()) }
  var searchAvailable by remember { mutableStateOf(true) }
  var confirmingDelete by remember { mutableStateOf(false) }
  val baseUpdatedAtMs = remember { order?.quote?.updatedAtMs }

  fun change(next: QuoteDraft) {
    draft = next
    edited = true
    attemptKey = null
  }

  val paid = order != null && !isUnpaidQuote(order)
  val title = order?.let { formatQuoteNumber(it, quoteId) } ?: "New quote"
  val deletable = order != null && !paid && (order.quote?.stage ?: QuoteStage.DRAFT) == QuoteStage.DRAFT
  val proofOnly = draft.lines.isEmpty() && order?.quote?.let { quote -> quote.proofs.orEmpty().any { it.revision == quote.revision } } == true
  val requireProofApproval = if (order != null || approvalSet) draft.requireProofApproval else quoteRequiresProofApprovalByDefault(quotesSettings)
  val requireProofSignIn = if (order != null || signInSet) draft.requireProofSignIn else quoteRequiresProofSignInByDefault(quotesSettings)
  val priced = draft.lines.map { it.priced(byId) }
  val problems = priced.any { it is PricedQuoteLine.Refused }

  // Who matches what was typed, a moment after typing stops (the console's 250 ms).
  LaunchedEffect(search) {
    val typed = search.trim()
    if (typed.length < 2 || hostId.isEmpty()) {
      if (found.isNotEmpty()) found = emptyList()
      return@LaunchedEffect
    }
    delay(250)
    val answer = try {
      context.api.request(
        QUOTE_ROUTE, ApiMethod.POST,
        JsonObject(mapOf("action" to JsonPrimitive("search-customers"), "hostId" to JsonPrimitive(hostId), "text" to JsonPrimitive(typed))),
      ) as? JsonObject
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      null
    } ?: return@LaunchedEffect
    searchAvailable = (answer["available"] as? JsonPrimitive)?.booleanOrNull != false
    found = (answer["customers"] as? JsonArray).orEmpty().mapNotNull { raw ->
      val person = raw as? JsonObject ?: return@mapNotNull null
      val record = person["record"] as? JsonObject ?: return@mapNotNull null
      val kind = record["kind"].text().ifEmpty { return@mapNotNull null }
      val id = record["id"].text().ifEmpty { return@mapNotNull null }
      FoundQuoteCustomer(QuoteCustomerRecord(id = id, kind = kind), person["name"].text(), person["company"].text(), person["email"].text(), person["phone"].text())
    }
  }

  FormSheet(
    title = title,
    busy = busy,
    onDismiss = onDismiss,
    onConfirm = {
      val key = attemptKey ?: "${kotlin.random.Random.nextLong()}-${kotlin.random.Random.nextLong()}"
      attemptKey = key
      busy.run(scope) {
        val body = mutableMapOf<String, JsonElement>(
          "action" to JsonPrimitive(if (quoteId == null) "create" else "update"),
          "hostId" to JsonPrimitive(hostId),
          "quote" to draft.body(requireProofApproval, requireProofSignIn),
        )
        if (quoteId != null) {
          body["quoteId"] = JsonPrimitive(quoteId)
          baseUpdatedAtMs?.let { body["baseUpdatedAtMs"] = JsonPrimitive(it) }
        }
        val answer = try {
          context.api.request(QUOTE_ROUTE, ApiMethod.POST, JsonObject(body), idempotencyKey = key) as? JsonObject
        } catch (error: ConsoleApiError) {
          throw Exception(((error.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull ?: "The quote could not be saved")
        }
        val saved = formatQuoteNumber((answer?.get("number") as? JsonPrimitive)?.doubleOrNull, answer?.get("quoteId").text().ifEmpty { null })
        onDone("$saved saved", false)
      }
    },
    confirmLabel = if (order != null) "Save" else if (proofOnly) "Create proof" else "Create quote",
    confirmEnabled = !paid && canEdit && (draft.lines.isNotEmpty() || proofOnly) && !problems,
    modifier = Modifier.testTag("quote-editor"),
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      if (paid) {
        val paidAt = order?.quote?.paidAtMs
        NoticeBanner(
          if (paidAt != null) "Paid ${com.aglyn.contracts.formatLocalDay(paidAt.toLong(), "M/d/yyyy", com.aglyn.contracts.deviceTimeZone())}. It is an order now and can no longer be changed."
          else "This quote has been paid, so it is an order now and can no longer be changed.",
          tone = StatusTone.SUCCESS,
        )
      }
      if (!canEdit) NoticeBanner(permissionRefusalText(QUOTE_EDIT_PERMISSION), tone = StatusTone.INFO)
      val enabled = !paid && canEdit && !busy.busy

      // Customer
      SectionTitle("Customer")
      val record = draft.record
      if (record != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text(draft.name.ifEmpty { draft.email.ifEmpty { "Contact" } })
            Text("From your contacts", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          TextButton(onClick = { change(draft.copy(record = null)) }, enabled = enabled) { Text("Remove") }
        }
      } else if (searchAvailable) {
        OutlinedTextField(search, { search = it }, label = { Text("Find a contact") }, placeholder = { Text("Name, email or phone") }, singleLine = true, enabled = enabled,
          modifier = Modifier.fillMaxWidth().testTag("quote-find-contact"))
        found.forEach { person ->
          Column(
            Modifier.fillMaxWidth().clickable {
              change(draft.copy(record = person.record, name = person.name, company = person.company, email = person.email, phone = person.phone))
              search = ""
              found = emptyList()
            }.padding(vertical = space(0.5f)),
          ) {
            Text(person.name.ifEmpty { person.email.ifEmpty { "Contact" } })
            val more = listOf(person.company, person.email, person.phone).filter { it.isNotEmpty() }.joinToString(" · ")
            if (more.isNotEmpty()) Text(more, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
      field("Name", draft.name, enabled, Modifier.testTag("quote-customer-name")) { change(draft.copy(name = it)) }
      field("Company", draft.company, enabled) { change(draft.copy(company = it)) }
      field("Email", draft.email, enabled, keyboard = KeyboardType.Email) { change(draft.copy(email = it)) }
      field("Phone", draft.phone, enabled, keyboard = KeyboardType.Phone) { change(draft.copy(phone = it)) }

      // Items
      HorizontalDivider()
      SectionTitle("Items")
      if (draft.lines.isEmpty()) {
        Text("Add products from your catalog, or type an item that is made to order.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      draft.lines.forEachIndexed { index, line ->
        QuoteLineEditor(line, priced[index], products, byId, enabled, index,
          onChange = { next -> change(draft.copy(lines = draft.lines.map { if (it.key == line.key) next else it })) },
          onRemove = { change(draft.copy(lines = draft.lines.filter { it.key != line.key })) })
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        TextButton(onClick = { change(draft.copy(lines = draft.lines + QuoteLineDraft(custom = false))) }, enabled = enabled && products.isNotEmpty(),
          modifier = Modifier.testTag("quote-add-product")) { Text("Add product") }
        TextButton(onClick = { change(draft.copy(lines = draft.lines + QuoteLineDraft(custom = true))) }, enabled = enabled,
          modifier = Modifier.testTag("quote-add-custom")) { Text("Add custom item") }
      }

      // Discount and shipping
      if (!proofOnly) {
        SelectField(
          "Discount",
          listOf(SelectOption("none", "None"), SelectOption("amount", "Amount off"), SelectOption("percent", "Percent off")),
          draft.discountKind, { change(draft.copy(discountKind = it ?: "none")) }, Modifier.fillMaxWidth(), enabled = enabled,
        )
        if (draft.discountKind != "none") {
          field(if (draft.discountKind == "amount") "Amount ($)" else "Percent (%)", draft.discountValue, enabled, keyboard = KeyboardType.Decimal) {
            change(draft.copy(discountValue = it))
          }
        }
        OutlinedTextField(
          draft.shipping, { change(draft.copy(shipping = it)) }, label = { Text("Shipping ($)") }, singleLine = true, enabled = enabled,
          supportingText = { Text("Leave empty when nothing ships.") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
          isError = quoteCentsOf(draft.shipping) == null, modifier = Modifier.fillMaxWidth(),
        )
      }

      // Addresses
      HorizontalDivider()
      AddressFields("Ship to", draft.shipTo, enabled, "Where the order goes. Store tax rates use its state and country.") { change(draft.copy(shipTo = it)) }
      AddressFields("Bill to", draft.billTo, enabled, null) { change(draft.copy(billTo = it)) }

      // Notes, terms and the proof switches
      HorizontalDivider()
      OutlinedTextField(draft.notes, { change(draft.copy(notes = it)) }, label = { Text("Notes for the customer") }, minLines = 2, enabled = enabled, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(draft.terms, { change(draft.copy(terms = it)) }, label = { Text("Terms") }, minLines = 2, enabled = enabled, modifier = Modifier.fillMaxWidth())
      if (!proofOnly) {
        SwitchRow("Customers approve the proof before they can pay", requireProofApproval, {
          approvalSet = true
          change(draft.copy(requireProofApproval = it))
        }, enabled = enabled)
      }
      SwitchRow(
        "Customers sign in to see and approve proofs", requireProofSignIn, {
          signInSet = true
          change(draft.copy(requireProofSignIn = it))
        }, enabled = enabled,
        supporting = "For a customer with an account on your site. A customer without one keeps using the private link.",
      )

      // Totals
      if (!proofOnly) {
        HorizontalDivider()
        if (order != null && !edited) {
          // A saved quote left as it is shows what its customer's page shows, until a save re-prices it.
          val unpaid = isUnpaidQuote(order)
          val payTax = quotePayTax(order.quote, payLinkStoreOf(taxMap))
          QuoteTotals(order, payTax, unpaid)
        } else {
          val basis = quoteTaxBasisFromSettings(storeTaxSettingsOf(taxMap), draft.shipTo.country.trim().uppercase(), draft.shipTo.state.trim())
          val totals = computeQuoteTotals(
            priced.mapNotNull { (it as? PricedQuoteLine.Ok)?.line?.let(::quoteTotalsLineOf) }, draft.discount,
            (quoteCentsOf(draft.shipping) ?: 0L).toDouble(), basis,
          )
          QuoteTotalRows(totals.itemsCents, totals.discountCents, totals.shippingCents, totals.taxCents, totals.totalCents, describeQuoteTax(basis), totals.taxAtPayment)
        }
      }

      if (deletable) {
        HorizontalDivider()
        TextButton(onClick = { confirmingDelete = true }, enabled = canEdit && !busy.busy, modifier = Modifier.testTag("quote-delete")) {
          Text("Delete", color = MaterialTheme.colorScheme.error)
        }
      }
    }
  }

  if (confirmingDelete && quoteId != null) {
    AlertDialog(
      onDismissRequest = { if (!busy.busy) confirmingDelete = false },
      title = { Text("Delete $title?") },
      text = {
        Column {
          Text("The quote and everything on it is removed. This can’t be undone.")
          busy.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
      },
      confirmButton = {
        TextButton(
          onClick = {
            busy.run(scope, onDone = { confirmingDelete = false }) {
              try {
                context.api.request(
                  QUOTE_ROUTE, ApiMethod.POST,
                  JsonObject(mapOf("action" to JsonPrimitive("delete"), "hostId" to JsonPrimitive(hostId), "quoteId" to JsonPrimitive(quoteId))),
                )
              } catch (error: ConsoleApiError) {
                throw Exception(((error.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull ?: "The quote could not be deleted")
              }
              onDone("$title deleted", true)
            }
          },
          enabled = !busy.busy,
          modifier = Modifier.testTag("quote-delete-confirm"),
        ) { Text("Delete", color = MaterialTheme.colorScheme.error) }
      },
      dismissButton = { TextButton(onClick = { confirmingDelete = false }, enabled = !busy.busy) { Text("Cancel") } },
    )
  }
}

@Composable
private fun SectionTitle(text: String) {
  Text(text, style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
}

@Composable
private fun field(
  label: String, value: String, enabled: Boolean, modifier: Modifier = Modifier, keyboard: KeyboardType = KeyboardType.Text,
  placeholder: String? = null, isError: Boolean = false, onChange: (String) -> Unit,
) {
  OutlinedTextField(
    value, onChange, label = { Text(label) }, placeholder = placeholder?.let { { Text(it) } }, singleLine = true, enabled = enabled,
    isError = isError, keyboardOptions = KeyboardOptions(keyboardType = keyboard), modifier = modifier.fillMaxWidth(),
  )
}

/** One address on the quote. */
@Composable
private fun AddressFields(label: String, value: QuoteAddressDraft, enabled: Boolean, helper: String?, onChange: (QuoteAddressDraft) -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    SectionTitle(label)
    helper?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    field("Name", value.name, enabled) { onChange(value.copy(name = it)) }
    field("Address", value.line1, enabled) { onChange(value.copy(line1 = it)) }
    field("Apartment, suite, unit", value.line2, enabled) { onChange(value.copy(line2 = it)) }
    field("City", value.city, enabled) { onChange(value.copy(city = it)) }
    field("State or region", value.state, enabled) { onChange(value.copy(state = it)) }
    field("Postal code", value.postalCode, enabled) { onChange(value.copy(postalCode = it)) }
    field("Country code", value.country, enabled, placeholder = "US") { onChange(value.copy(country = it.take(2))) }
  }
}

/** One line of the quote: a product with its options and add-ons, or a typed item. */
@Composable
private fun QuoteLineEditor(
  line: QuoteLineDraft,
  priced: PricedQuoteLine,
  products: List<Pair<String, HostProduct>>,
  byId: Map<String, HostProduct>,
  enabled: Boolean,
  index: Int,
  onChange: (QuoteLineDraft) -> Unit,
  onRemove: () -> Unit,
) {
  val product = byId[line.productId]?.let(::liftLegacyProduct)
  com.aglyn.ui.SectionCard(title = null) {
    Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      if (!line.custom) {
        SelectField(
          "Product", products.map { (id, item) -> SelectOption(id, item.name ?: id) }, line.productId.ifEmpty { null },
          { onChange(line.copy(productId = it.orEmpty(), variantId = "", modifiers = emptyList())) }, Modifier.fillMaxWidth().testTag("quote-line-product-$index"),
          enabled = enabled,
        )
        val variants = product?.variants.orEmpty()
        if (variants.size > 1) {
          SelectField(
            "Option",
            variants.map { variant -> SelectOption(variant.id.orEmpty(), variant.options?.values?.joinToString(" / ")?.ifEmpty { null } ?: "Default") },
            line.variantId.ifEmpty { variants.first().id }, { onChange(line.copy(variantId = it.orEmpty())) }, Modifier.fillMaxWidth(), enabled = enabled,
          )
        }
        productModifierGroups(product).forEach { group -> ModifierField(group, line, enabled, onChange) }
      } else {
        field("Item", line.name, enabled, Modifier.testTag("quote-line-name-$index")) { onChange(line.copy(name = it)) }
        field("SKU (optional)", line.sku, enabled) { onChange(line.copy(sku = it)) }
      }
      OutlinedTextField(line.description, { onChange(line.copy(description = it)) }, label = { Text("Description (optional)") }, enabled = enabled, modifier = Modifier.fillMaxWidth())
      field("Quantity", line.quantity, enabled, keyboard = KeyboardType.Number) { onChange(line.copy(quantity = it.filter(Char::isDigit))) }
      if (line.custom) {
        field("Unit price ($)", if (line.included) "" else line.price, enabled && !line.included, Modifier.testTag("quote-line-price-$index"), KeyboardType.Decimal,
          isError = !line.included && quoteCentsOf(line.price) == null) { onChange(line.copy(price = it)) }
        SwitchRow("Ships", line.ships, { onChange(line.copy(ships = it)) }, enabled = enabled)
      }
      SwitchRow("Included at no charge", line.included, { onChange(line.copy(included = it)) }, enabled = enabled)
      Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onRemove, enabled = enabled) { Text("Remove") }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
          if (line.included) {
            Text("Included", fontWeight = FontWeight.SemiBold)
          } else if (priced is PricedQuoteLine.Ok) {
            Text(formatOrderMoney(quoteLineCents(quoteTotalsLineOf(priced.line))), fontWeight = FontWeight.SemiBold)
            if (priced.line.quantity > 1) {
              Text("${formatOrderMoney(priced.line.unitAmountCents)} each", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
      if (priced is PricedQuoteLine.Refused) Text(priced.error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
  }
}

/** One add-on group: a single choice with None, or several to tick. */
@Composable
private fun ModifierField(group: ProductModifierGroup, line: QuoteLineDraft, enabled: Boolean, onChange: (QuoteLineDraft) -> Unit) {
  val label = if (modifierGroupRequired(group)) group.name else "${group.name} (optional)"
  val variantId = line.variantId.ifEmpty { null }
  val chosen = line.modifiers.filter { it.groupId == group.id }.map { it.optionId }
  if (group.max > 1) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    group.options.forEach { option ->
      SwitchRow(quoteModifierOptionLabel(option, variantId), option.id in chosen, { on ->
        val rest = line.modifiers.filterNot { it.groupId == group.id && it.optionId == option.id }
        onChange(line.copy(modifiers = if (on) rest + ModifierSelection(groupId = group.id, optionId = option.id) else rest))
      }, enabled = enabled)
    }
  } else {
    SelectField(
      label, group.options.map { SelectOption(it.id, quoteModifierOptionLabel(it, variantId)) }, chosen.firstOrNull(),
      { picked ->
        val rest = line.modifiers.filterNot { it.groupId == group.id }
        onChange(line.copy(modifiers = if (picked.isNullOrEmpty()) rest else rest + ModifierSelection(groupId = group.id, optionId = picked)))
      },
      Modifier.fillMaxWidth(), enabled = enabled, noneLabel = "None",
    )
  }
}

/** The quote's totals as the customer reads them, for figures worked out here. */
@Composable
private fun QuoteTotalRows(items: Double, discount: Double, shipping: Double, tax: Double, total: Double, taxLabel: String, atPayment: Boolean) {
  @Composable fun line(label: String, value: String, strong: Boolean = false) = Row {
    Text(label, Modifier.weight(1f), color = if (strong) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = if (strong) FontWeight.SemiBold else null)
    Text(value, fontWeight = if (strong) FontWeight.SemiBold else null)
  }
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    line("Items", formatOrderMoney(items))
    if (discount != 0.0) line("Discount", "−${formatOrderMoney(discount)}")
    if (shipping != 0.0) line("Shipping", formatOrderMoney(shipping))
    if (atPayment) Text(taxLabel, color = MaterialTheme.colorScheme.onSurfaceVariant) else line(taxLabel, formatOrderMoney(tax))
    line(if (atPayment) "Total before tax" else "Total", formatOrderMoney(total), strong = true)
  }
}

/** The store's products the editor's picker offers, by id, leaving out deleted ones (the console's `!product.deletedAt`). */
fun quoteProductsOf(docs: List<com.aglyn.core.FirestoreDoc>): List<Pair<String, HostProduct>> =
  docs.take(QUOTE_PRODUCT_WINDOW).filter { doc ->
    val deleted = doc.data["deletedAt"]
    deleted == null || deleted == false
  }.map { doc -> doc.id to com.aglyn.plugins.commerce.products.hostProductFrom(doc) }
