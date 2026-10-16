package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.OpenDisputeSummary
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreQuery
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.pos.newAttemptKey
import com.aglyn.plugins.commerce.products.productRow
import com.aglyn.plugins.commerce.products.productsPath
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/*
 * THE ORDERS LIST'S OWN ACTIONS (AGL-3841), beside the console's grid: the
 * banner for charges a shopper's bank is disputing (its own query, whatever
 * the list is filtered to), Draft order (a payment link for someone you sell to
 * directly), and the shipping tools' Export for shipping and Import tracking.
 * The Apple plugin's OrdersListExtras.swift.
 */

/** How many open disputes the banner reads (`OPEN_DISPUTE_CEILING`). */
const val OPEN_DISPUTE_CEILING = 50

/** The banner's headline (the console's words). */
fun openDisputesTitle(summary: OpenDisputeSummary, more: Boolean): String = when {
  more -> "More than $OPEN_DISPUTE_CEILING charges are disputed with the shopper’s bank"
  summary.count == 1 -> "A shopper has disputed a charge with their bank"
  else -> "${summary.count} charges are disputed with the shopper’s bank"
}

/** The banner's sentence: the tightest evidence deadline. */
fun openDisputesDetail(summary: OpenDisputeSummary): String {
  val left = summary.soonestDaysLeft ?: return "Answer in the Stripe dashboard while the case is open — an unanswered dispute is decided for the shopper."
  if (left < 0) return "The evidence deadline has passed on at least one of these. Stripe decides an unanswered dispute for the shopper."
  return "Evidence is due to Stripe in $left day${if (left == 1L) "" else "s"} on the tightest of these. An unanswered dispute is decided for the shopper."
}

/** The open disputes' own query (`disputeKey == open`). */
fun openDisputesQuery(hostId: String) =
  FirestoreQuery(ordersPath(hostId), filters = listOf(com.aglyn.core.FirestoreFilter("disputeKey", com.aglyn.core.FilterOp.EQ, "open")), limit = OPEN_DISPUTE_CEILING + 1)

/** JSON as the plain values the export sheet's scope takes. */
fun plainOf(element: JsonElement): Any? = when (element) {
  is JsonNull -> null
  is JsonObject -> element.mapValues { plainOf(it.value) }
  is JsonArray -> element.map(::plainOf)
  is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull
}

/** The orders export's scope for a shipping tool: the open orders still to ship (`OrderShippingActions`). */
fun shippingExportScope(): Map<String, Any?> = mapOf("kind" to "filter", "filter" to plainOf(Contracts.ordersToShipFilterValue))

/**
 * Orders written before the shipping fields carry no `requiresShipping`; stamping the open ones first lets the export
 * find them. Best effort: the export still opens, and shows what is already stamped.
 */
suspend fun prepareOrdersForShipping(api: ConsoleApiClient, hostId: String) {
  try {
    api.request("/api/commerce/orders-shipping-prepare", ApiMethod.POST, JsonObject(mapOf("hostId" to JsonPrimitive(hostId))))
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
  }
}

/** The import screen's parameters for tracking numbers (the console's Import tracking). */
fun trackingImportParams(hostId: String?): Map<String, String> = buildMap {
  put("resource", "commerce.tracking")
  put("title", "Import tracking numbers")
  if (hostId != null) put("hostId", hostId)
}

/** What the draft order route still needs to know, read off its refusal (`needsShippingCountry`), or null. */
data class DraftDestination(val countries: List<String>, val postalCode: Boolean)

fun draftOrderDestination(body: JsonElement?): DraftDestination? {
  val o = body as? JsonObject ?: return null
  if ((o["needsShippingCountry"] as? JsonPrimitive)?.booleanOrNull != true) return null
  val listed = (o["shippingCountries"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
  return DraftDestination(listed.ifEmpty { Contracts.checkoutShippingCountryCodes }, (o["needsShippingPostalCode"] as? JsonPrimitive)?.booleanOrNull == true)
}

/**
 * Draft order: a product, its variant and how many, an optional buyer email, and — once the store asks — where it
 * ships. Creates the payment link and copies it, as the console's dialog does.
 */
@Composable
fun DraftOrderDialog(context: NativePluginContext, onDismiss: () -> Unit, onDone: (String) -> Unit) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val clipboard = LocalClipboardManager.current
  var products by remember { mutableStateOf(emptyList<Pair<com.aglyn.core.FirestoreDoc, com.aglyn.plugins.commerce.products.ProductRow>>()) }
  var productId by remember { mutableStateOf<String?>(null) }
  var variantId by remember { mutableStateOf<String?>(null) }
  var quantity by remember { mutableStateOf("1") }
  var email by remember { mutableStateOf("") }
  var destination by remember { mutableStateOf<DraftDestination?>(null) }
  var country by remember { mutableStateOf<String?>(null) }
  var postal by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var problem by remember { mutableStateOf<String?>(null) }
  var attemptKey by remember { mutableStateOf(newAttemptKey("draft")) }
  LaunchedEffect(hostId) {
    products = try {
      context.firestore.page(FirestoreQuery(productsPath(hostId), filters = listOf(com.aglyn.core.FirestoreFilter("status", com.aglyn.core.FilterOp.EQ, "active")), limit = 200))
        .docs.filter { it.data["deletedAt"] == null }.map { it to productRow(it) }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      emptyList()
    }
  }
  val picked = products.firstOrNull { it.first.id == productId }
  val variants = (picked?.first?.data?.get("variants") as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
  val ready = productId != null && (destination == null || country != null) && (destination?.postalCode != true || postal.isNotBlank())
  ActionDialog(
    title = "Draft order",
    icon = "add_link",
    confirmLabel = "Create & copy link",
    confirmEnabled = ready,
    busy = busy,
    error = problem,
    dismissLabel = "Cancel",
    onDismiss = onDismiss,
    onConfirm = {
      val id = productId ?: return@ActionDialog
      busy = true
      problem = null
      scope.launch {
        try {
          val body = buildMap<String, JsonElement> {
            put("hostId", JsonPrimitive(hostId))
            put("productId", JsonPrimitive(id))
            variantId?.let { put("variantId", JsonPrimitive(it)) }
            put("quantity", JsonPrimitive(maxOf(1, quantity.toIntOrNull() ?: 1)))
            email.trim().ifEmpty { null }?.let { put("email", JsonPrimitive(it)) }
            // A request, never an instruction: the server restricts the link's addresses to the country it prices for.
            country?.let { put("shippingCountry", JsonPrimitive(it)) }
            postal.trim().ifEmpty { null }?.let { put("shippingPostalCode", JsonPrimitive(it)) }
          }
          val answer = context.api.request("/api/commerce/draft-order", ApiMethod.POST, JsonObject(body), idempotencyKey = attemptKey) as? JsonObject
          val url = (answer?.get("url") as? JsonPrimitive)?.contentOrNull
          if (url == null) {
            problem = "Draft order failed"
          } else {
            clipboard.setText(AnnotatedString(url))
            onDone("Draft created — payment link copied")
          }
        } catch (error: Throwable) {
          if (error is CancellationException) throw error
          val refused = error as? ConsoleApiError
          if (refused != null && refused.status in 1..499) {
            attemptKey = newAttemptKey("draft")
            draftOrderDestination(refused.body)?.let { destination = it }
            problem = refused.message.ifEmpty { "Draft order failed" }
          } else {
            problem = "It is not known whether the draft was created. Trying again is safe; it will not make two links."
          }
        } finally {
          busy = false
        }
      }
    },
    modifier = Modifier.testTag("draft-dialog"),
  ) {
    SelectField(
      label = "Product",
      options = products.map { SelectOption(it.first.id, it.second.name) },
      selected = productId,
      onSelect = { productId = it; variantId = null },
      supporting = if (products.isEmpty()) "Add a product to this store first — a draft order is built from one." else null,
      modifier = Modifier.fillMaxWidth().testTag("draft-product"),
    )
    if (variants.size > 1) {
      SelectField(
        label = "Variant",
        options = variants.mapNotNull { variant ->
          val id = variant["id"] as? String ?: return@mapNotNull null
          val options = (variant["options"] as? Map<*, *>).orEmpty().values.joinToString(" / ").ifEmpty { "Default" }
          SelectOption(id, "$options — $${variant["priceUsd"] ?: ""}")
        },
        selected = variantId,
        onSelect = { variantId = it },
        modifier = Modifier.fillMaxWidth().testTag("draft-variant"),
      )
    }
    OutlinedTextField(
      quantity,
      { quantity = it.filter(Char::isDigit) },
      label = { Text("Quantity") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
      modifier = Modifier.fillMaxWidth().testTag("draft-quantity"),
    )
    OutlinedTextField(
      email,
      { email = it },
      label = { Text("Buyer email (optional)") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
      modifier = Modifier.fillMaxWidth().testTag("draft-email"),
    )
    destination?.let { asked ->
      SelectField(
        label = "Ships to",
        options = asked.countries.map { SelectOption(it, Contracts.checkoutShippingCountryNames[it] ?: it) },
        selected = country,
        onSelect = { country = it },
        supporting = "This store’s shipping rates differ by destination, so the payment link has to be priced for one.",
        modifier = Modifier.fillMaxWidth().testTag("draft-country"),
      )
      if (asked.postalCode) {
        OutlinedTextField(
          postal,
          { postal = it },
          label = { Text("Postal code") },
          supportingText = { Text("This store prices shipping by carrier, which needs the postal code.", style = MaterialTheme.typography.bodySmall) },
          singleLine = true,
          modifier = Modifier.fillMaxWidth().testTag("draft-postal"),
        )
      }
    }
  }
}
