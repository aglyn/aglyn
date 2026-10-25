package com.aglyn.plugins.commerce.products

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.newDocumentId
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * THE PRODUCTS LIST'S ROW ACTIONS (AGL-3841): Duplicate, Archive or Activate,
 * Delete and a digital product's license Keys, and the plan's product count
 * under the list, as the console's products card has them. Duplicate and
 * Delete go through the commerce routes that run the console's own copy and
 * soft delete; Archive and Activate save the stored product with its status
 * changed through the product save route; keys are written to the store's
 * `licenseKeys` as the console's dialog writes them. The Apple plugin's
 * ProductActions.swift.
 */

/** A product's status changed, saved as the whole stored product (the save route keeps what the app does not show). */
fun productStatusSaveJson(stored: Map<String, Any?>, status: String): JsonObject =
  JsonObject(storedProductJson(stored) + ("status" to JsonPrimitive(status)))

/** Duplicates a product as a draft; the answer is the copy's id. The id is minted by the caller so a retry finds the same copy. */
suspend fun duplicateProduct(api: ConsoleApiClient, hostId: String, productId: String, newProductId: String): String {
  val answer = api.request(
    "/api/commerce/products/duplicate",
    ApiMethod.POST,
    JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "productId" to JsonPrimitive(productId), "newProductId" to JsonPrimitive(newProductId))),
  ) as? JsonObject
  return (answer?.get("id") as? JsonPrimitive)?.contentOrNull ?: newProductId
}

/** Deletes a product: it stops being purchasable, and blocks pointing at it show a checkout error until repointed. */
suspend fun deleteProduct(api: ConsoleApiClient, hostId: String, productId: String) {
  api.request("/api/commerce/products/delete", ApiMethod.POST, JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "productId" to JsonPrimitive(productId))))
}

/** Whether any variant still needs its price (`productPriceMissing`): a price is a number at or above zero. */
fun productPriceMissing(data: Map<String, Any?>): Boolean =
  (data["variants"] as? List<*>).orEmpty().any { variant ->
    val price = (variant as? Map<*, *>)?.get("priceUsd")
    !(price is Number && price !is Boolean && price.toDouble().isFinite() && price.toDouble() >= 0)
  }

/** The notice over the list for products listed before they have a price (AGL-3676), in the console's words. */
fun comingSoonNotice(names: List<String>): String? {
  val first = names.firstOrNull() ?: return null
  val one = names.size == 1
  return "Set prices to start selling: ${if (one) "$first shows" else "${names.size} products show"} “Price coming soon” on your store until you set ${if (one) "its price" else "their prices"}. Open each one and give every variant a price."
}

/** What activating an unpriced product tells the owner (AGL-3676): it goes live, and says "Price coming soon". */
fun activatingUnpricedNotice(name: String) = "$name has no price yet: visitors will see “Price coming soon” and can’t buy it."

/** The plan's product cap, as `/api/orgs/entitlements` answers it: null is unlimited. */
suspend fun productsPerHostLimit(api: ConsoleApiClient, hostId: String): Double? {
  val answer = api.request("/api/orgs/entitlements", ApiMethod.GET, query = mapOf("hostId" to hostId)) as? JsonObject
  return ((answer?.get("quotas") as? JsonObject)?.get("productsPerHost") as? JsonPrimitive)?.doubleOrNull
}

/** `3/25 products on your plan`, `∞` for unlimited, and a checking line until the plan is known (`QuotaReadout`). */
fun productQuotaReadout(used: Long, limit: Double?, ready: Boolean): String {
  val noun = if (used == 1L) "product" else "products"
  if (!ready) return "$used $noun · checking your plan…"
  val cap = limit?.takeIf { it.isFinite() }?.toLong()?.toString() ?: "∞"
  return "$used/$cap products on your plan"
}

// License keys

/** One stored license key. */
data class LicenseKeyRow(val id: String, val key: String, val assigned: Boolean, val revoked: Boolean)

/** How many of one product's keys the dialog reads (`KEY_POOL_CEILING`). */
const val LICENSE_KEY_POOL_CEILING = 500

/** The pool's line: available, assigned and retired keys (AGL-2454), in the console's words. */
fun licenseKeyCounts(keys: List<LicenseKeyRow>, truncated: Boolean): String {
  val available = keys.count { !it.assigned && !it.revoked }
  val retired = keys.count { it.revoked }
  val assigned = keys.size - available - retired
  return "$available available · $assigned assigned" +
    (if (retired > 0) " · $retired retired (refunded or revoked — not reissued)" else "") +
    (if (truncated) ", of the $LICENSE_KEY_POOL_CEILING keys read" else "") +
    ". Keys deliver automatically on purchase (receipt + account)."
}

/** The keys typed one per line, trimmed, at most 200 at a time. */
fun licenseKeysFromText(text: String): List<String> = text.lines().map { it.trim() }.filter { it.isNotEmpty() }.take(200)

/** A digital product's license keys: what is left in the pool, revoke an unsold key, add keys one per line. */
@Composable
fun ProductKeysDialog(context: NativePluginContext, productId: String, productName: String, onDismiss: () -> Unit) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val flow = remember(hostId, productId, context.firestore) {
    context.firestore.observe(
      FirestoreQuery("hosts/$hostId/licenseKeys", filters = listOf(FirestoreFilter("productId", FilterOp.EQ, productId)), limit = LICENSE_KEY_POOL_CEILING + 1),
    )
  }
  val live by flow.collectAsState(Live.Loading)
  val docs = (live as? Live.Ready)?.value.orEmpty()
  val keys = docs.take(LICENSE_KEY_POOL_CEILING).map {
    LicenseKeyRow(it.id, it.data["key"] as? String ?: "", it.data["assignedAtMs"] is Number, it.data["revokedAtMs"] is Number)
  }
  var text by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var problem by remember { mutableStateOf<String?>(null) }
  var done by remember { mutableStateOf<String?>(null) }
  ActionDialog(
    title = "License keys — $productName",
    icon = "key",
    confirmLabel = "Add keys",
    confirmEnabled = licenseKeysFromText(text).isNotEmpty(),
    busy = busy,
    error = problem,
    dismissLabel = "Close",
    onDismiss = onDismiss,
    onConfirm = {
      val lines = licenseKeysFromText(text)
      busy = true
      problem = null
      scope.launch {
        var added = 0
        try {
          for (key in lines) {
            context.writer.merge(
              "hosts/$hostId/licenseKeys/${newDocumentId()}",
              mapOf("productId" to productId, "key" to key, "assignedAtMs" to null, "createdAtMs" to nowMillis()),
            )
            added += 1
          }
          text = ""
          done = "Added $added keys"
        } catch (error: Throwable) {
          if (error is CancellationException) throw error
          problem = "$added of ${lines.size} keys were added before the rest could not be: ${error.message}"
        } finally {
          busy = false
        }
      }
    },
    modifier = Modifier.testTag("product-keys-dialog"),
  ) {
    done?.let { NoticeBanner(it, StatusTone.SUCCESS) }
    Text(licenseKeyCounts(keys, docs.size > LICENSE_KEY_POOL_CEILING), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    keys.filter { !it.assigned && !it.revoked }.take(8).forEach { key ->
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(key.key, Modifier.weight(1f), fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
        TextButton(
          onClick = {
            scope.launch {
              try {
                context.writer.update("hosts/$hostId/licenseKeys/${key.id}", mapOf("revokedAtMs" to nowMillis(), "assignedAtMs" to nowMillis()))
              } catch (error: Throwable) {
                if (error is CancellationException) throw error
                problem = error.message
              }
            }
          },
          enabled = !busy,
        ) { Text("Revoke") }
      }
    }
    OutlinedTextField(text, { text = it }, label = { Text("Add keys (one per line)") }, minLines = 3, modifier = Modifier.fillMaxWidth().testTag("product-keys-add"))
  }
}
