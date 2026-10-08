package com.aglyn.plugins.commerce.products

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ProductStatus
import com.aglyn.contracts.ProductType
import com.aglyn.contracts.commerceSlug
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.plugins.commerce.orders.parseMoneyCents
import com.aglyn.plugins.commerce.pos.newAttemptKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * Product writes from the Aglyn app (AGL-3652): New product, Edit and Adjust
 * stock. The console computes a save's derived fields in the browser; the app
 * sends the product to `commerce/products/save` and a stock change to
 * `commerce/products/stock`, which run the console's own computation
 * (`model/product-write.ts`) under the gate the Firestore rules apply.
 *
 * An edit is the console's full replace, so the app sends the WHOLE stored
 * product with its edits on top, never just the fields it shows: a field the
 * app does not know about survives. Stored timestamps stay as stored (the
 * route keeps them); everything else round-trips as JSON.
 */

const val PRODUCT_SAVE_ROUTE = "/api/commerce/products/save"
const val PRODUCT_STOCK_ROUTE = "/api/commerce/products/stock"

/** The reasons Adjust stock offers, as the console's dialog names them. */
val STOCK_REASONS = listOf("restock" to "Restock", "correction" to "Correction", "damage" to "Damaged", "refund" to "Refund return")

/** A stored value as JSON; a Firestore timestamp is left out (the route keeps the stored one). */
private fun jsonOf(value: Any?): JsonElement? = when (value) {
  null -> JsonNull
  is FirestoreTimestamp -> null
  is Boolean -> JsonPrimitive(value)
  is Number -> JsonPrimitive(value)
  is String -> JsonPrimitive(value)
  is List<*> -> JsonArray(value.mapNotNull(::jsonOf))
  is Map<*, *> -> JsonObject(value.entries.mapNotNull { (k, v) -> jsonOf(v)?.let { k.toString() to it } }.toMap())
  else -> JsonPrimitive(value.toString())
}

/** A stored product document as the JSON a save sends. */
fun storedProductJson(data: Map<String, Any?>): JsonObject =
  JsonObject(data.entries.mapNotNull { (key, value) -> jsonOf(value)?.let { key to it } }.toMap())

/** One variant as the editor shows it. */
data class VariantDraft(
  val id: String,
  val label: String,
  val price: String,
  val compareAt: String = "",
  val sku: String = "",
  val barcode: String = "",
  /** Starting stock; a new product only (an edit adjusts stock separately). */
  val stock: String = "",
)

/** What the editor edits. */
data class ProductDraft(
  val productId: String,
  val create: Boolean,
  val name: String = "",
  val description: String = "",
  val status: ProductStatus = ProductStatus.DRAFT,
  val type: ProductType = ProductType.PHYSICAL,
  val variants: List<VariantDraft> = listOf(VariantDraft("default", "Default", "")),
)

@OptIn(ExperimentalUuidApi::class)
fun newProductId(): String = "p" + Uuid.random().toHexString().take(19)

/** The editor opened on a stored product: its own fields, its variants with their prices and codes. */
fun productDraftOf(productId: String, data: Map<String, Any?>): ProductDraft {
  val product = hostProductFrom(com.aglyn.core.FirestoreDoc(productId, "", data))
  fun money(value: Double?) = value?.let { dollars -> kotlin.math.round(dollars * 100).toLong().let { "${it / 100}.${(it % 100).toString().padStart(2, '0')}" } }.orEmpty()
  return ProductDraft(
    productId = productId,
    create = false,
    name = product.name.orEmpty(),
    description = product.description.orEmpty(),
    status = product.status ?: ProductStatus.ACTIVE,
    type = product.type ?: ProductType.PHYSICAL,
    variants = product.variants.orEmpty().map { variant ->
      VariantDraft(
        id = variant.id.orEmpty(),
        label = variantLabel(variant),
        price = money(variant.priceUsd),
        compareAt = money(variant.compareAtPriceUsd),
        sku = variant.sku.orEmpty(),
        barcode = variant.barcode.orEmpty(),
      )
    },
  )
}

/** Why the draft cannot be sent, or null. The route validates again. */
fun checkProductDraft(draft: ProductDraft): String? {
  if (draft.name.isBlank()) return "Product name is required"
  for (variant in draft.variants) {
    if (parseMoneyCents(variant.price) == null) return "Enter a price for ${variant.label}"
    if (variant.compareAt.isNotBlank() && parseMoneyCents(variant.compareAt) == null) return "Enter a compare-at price for ${variant.label}, or leave it empty"
    if (draft.create && variant.stock.isNotBlank() && variant.stock.trim().toLongOrNull()?.takeIf { it >= 0 } == null) return "Enter a whole number of units, or leave stock empty"
  }
  return null
}

/**
 * The product a save sends: the stored product (or the console's blank one)
 * with the editor's fields on top. Codes and compare-at prices left empty
 * are removed, as the console's editor removes them.
 */
fun productSaveJson(draft: ProductDraft, stored: Map<String, Any?>?): JsonObject {
  val base: MutableMap<String, JsonElement> = stored?.let(::storedProductJson)?.toMutableMap() ?: mutableMapOf(
    "name" to JsonPrimitive(""),
    "slug" to JsonPrimitive(""),
    "type" to JsonPrimitive(ProductType.PHYSICAL.raw),
    "status" to JsonPrimitive(ProductStatus.DRAFT.raw),
  )
  val storedVariants = (base["variants"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
  fun dollars(text: String): JsonPrimitive = JsonPrimitive((parseMoneyCents(text) ?: 0L) / 100.0)
  val variants = draft.variants.map { edit ->
    val fields: MutableMap<String, JsonElement> =
      (storedVariants.firstOrNull { (it["id"] as? JsonPrimitive)?.content == edit.id } ?: JsonObject(mapOf("id" to JsonPrimitive(edit.id)))).toMutableMap()
    fields["priceUsd"] = dollars(edit.price)
    if (edit.compareAt.isBlank()) fields.remove("compareAtPriceUsd") else fields["compareAtPriceUsd"] = dollars(edit.compareAt)
    if (edit.sku.isBlank()) fields.remove("sku") else fields["sku"] = JsonPrimitive(edit.sku.trim())
    if (edit.barcode.isBlank()) fields.remove("barcode") else fields["barcode"] = JsonPrimitive(edit.barcode.trim())
    if (draft.create) {
      edit.stock.trim().toLongOrNull()?.let { fields["inventory"] = JsonPrimitive(it) } ?: fields.put("inventory", JsonNull)
    }
    JsonObject(fields)
  }
  base["name"] = JsonPrimitive(draft.name)
  base["description"] = JsonPrimitive(draft.description)
  base["status"] = JsonPrimitive(draft.status.raw)
  base["type"] = JsonPrimitive(draft.type.raw)
  base["variants"] = JsonArray(variants)
  if (draft.create) base["slug"] = JsonPrimitive(commerceSlug(draft.name))
  return JsonObject(base)
}

/** The two product routes, as the app calls them. */
interface ProductWriteApi {
  suspend fun save(productId: String, create: Boolean, product: JsonObject, attemptKey: String)
  suspend fun adjustStock(productId: String, variantId: String, delta: Long, reason: String, attemptKey: String)
}

class ConsoleProductWriteApi(private val api: ConsoleApiClient, private val hostId: String) : ProductWriteApi {
  override suspend fun save(productId: String, create: Boolean, product: JsonObject, attemptKey: String) {
    api.request(
      PRODUCT_SAVE_ROUTE,
      ApiMethod.POST,
      JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "productId" to JsonPrimitive(productId), "create" to JsonPrimitive(create), "product" to product)),
      idempotencyKey = attemptKey,
    )
  }

  override suspend fun adjustStock(productId: String, variantId: String, delta: Long, reason: String, attemptKey: String) {
    api.request(
      PRODUCT_STOCK_ROUTE,
      ApiMethod.POST,
      JsonObject(
        mapOf(
          "hostId" to JsonPrimitive(hostId),
          "productId" to JsonPrimitive(productId),
          "variantId" to JsonPrimitive(variantId),
          "delta" to JsonPrimitive(delta),
          "reason" to JsonPrimitive(reason),
        ),
      ),
      idempotencyKey = attemptKey,
    )
  }
}

/** One stock change being entered. */
data class StockDraft(val productId: String, val variantId: String, val label: String, val change: String = "", val reason: String = "restock")

/** Units from the typed change (`+3`, `-2`, `5`), or null. */
fun stockDelta(text: String): Long? = text.trim().removePrefix("+").toLongOrNull()?.takeIf { it != 0L }

/** The editor and Adjust stock for one site: what is open, whether it is saving, why it failed. */
class ProductEditorModel(private val api: ProductWriteApi, private val scope: CoroutineScope, private val mintKey: () -> String = { newAttemptKey("products-app") }) {
  var draft by mutableStateOf<ProductDraft?>(null)
    private set
  var stock by mutableStateOf<StockDraft?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var done by mutableStateOf<String?>(null)
  private var stored: Map<String, Any?>? = null
  private var attemptKey = mintKey()

  fun create() = open(ProductDraft(productId = newProductId(), create = true), null)

  fun edit(productId: String, data: Map<String, Any?>) = open(productDraftOf(productId, data), data)

  private fun open(next: ProductDraft, data: Map<String, Any?>?) {
    stored = data
    error = null
    attemptKey = mintKey()
    draft = next
  }

  fun change(next: ProductDraft) {
    draft = next
  }

  fun adjust(productId: String, variantId: String, label: String) {
    error = null
    attemptKey = mintKey()
    stock = StockDraft(productId, variantId, label)
  }

  fun changeStock(next: StockDraft) {
    stock = next
  }

  fun close() {
    if (busy) return
    draft = null
    stock = null
  }

  fun save() {
    val asked = draft ?: return
    checkProductDraft(asked)?.let { error = it; return }
    val key = attemptKey
    launchWrite {
      api.save(asked.productId, asked.create, productSaveJson(asked, stored), key)
      draft = null
      done = if (asked.create) "${asked.name.trim()} is added." else "${asked.name.trim()} is saved."
    }
  }

  fun applyStock() {
    val asked = stock ?: return
    val delta = stockDelta(asked.change)
    if (delta == null) {
      error = "Enter a number of units, like +5 or -2"
      return
    }
    val key = attemptKey
    launchWrite {
      api.adjustStock(asked.productId, asked.variantId, delta, asked.reason, key)
      stock = null
      done = "Stock adjusted."
    }
  }

  private fun launchWrite(block: suspend () -> Unit) {
    if (busy) return
    busy = true
    error = null
    scope.launch {
      try {
        block()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.takeIf { it.status != 0 }?.message ?: "That did not go through. Check the connection and try again."
      } finally {
        busy = false
      }
    }
  }
}
