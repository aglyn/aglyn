package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.ProductModifierOption
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import kotlinx.serialization.json.JsonPrimitive

/*
 * WHAT THE TILL SELLS.
 *
 * The item grid reads the catalog the console's register reads: live, ACTIVE
 * products in name order (the products hub's PRODUCT_LIST_QUERY), with a
 * typed word as the name search and a scan as a whole-code lookup over the
 * flattened `barcodes`/`skus` arrays. A category tile is one more predicate
 * on that query (`categoryIds` contains); quick keys are the products the
 * merchant marked `posQuickKey`. Firestore takes one array clause per query,
 * so the grid offers a search, a category or the quick keys, never two.
 *
 * Reads go through the member's own Firestore access under the console's
 * rules; prices here are a preview the server re-prices when the sale opens.
 */

/** How many tiles one read fills; the grid pages further on scroll. */
const val POS_GRID_PAGE_SIZE = 60

/** Categories are a short taxonomy; the grid reads them whole. */
const val POS_CATEGORY_CEILING = 200

data class PosVariant(
  val id: String,
  /** "Large / Blue"; null for a product's default variant. */
  val label: String?,
  /** Null while the variant has no price: the till refuses to ring it up. */
  val unitCents: Long?,
  val sku: String?,
  val barcode: String?,
  /** Tracked units, or null when not tracked. */
  val inventory: Long?,
)

data class PosItem(
  val id: String,
  val name: String,
  val imageUrl: String?,
  val variants: List<PosVariant>,
  val categoryIds: List<String>,
  val modifierGroups: List<ProductModifierGroup>,
  val quickKey: Boolean,
  /** Lowest and highest priced variant, for the tile. */
  val fromCents: Long?,
  val toCents: Long?,
)

private fun Any?.asText(): String? = (this as? String)?.trim()?.ifEmpty { null }
private fun Any?.asDouble(): Double? = (this as? Number)?.toDouble()?.takeIf { it.isFinite() }
private fun Any?.asMap(): Map<*, *>? = this as? Map<*, *>
private fun Any?.asList(): List<*> = this as? List<*> ?: emptyList<Any?>()

fun variantLabelOf(options: Map<*, *>?): String? =
  options?.values?.mapNotNull { it.asText() }?.joinToString(" / ")?.ifEmpty { null }

fun posVariantFrom(raw: Map<*, *>): PosVariant {
  val price = raw["priceUsd"].asDouble()?.takeIf { it >= 0 }
  return PosVariant(
    id = raw["id"].asText() ?: "default",
    label = variantLabelOf(raw["options"].asMap()),
    unitCents = price?.let { jsRound(it * 100) },
    sku = raw["sku"].asText(),
    barcode = raw["barcode"].asText(),
    inventory = raw["inventory"].asDouble()?.toLong(),
  )
}

/** A product's modifier groups as stored, or none when they are malformed. */
fun modifierGroupsFrom(raw: Any?): List<ProductModifierGroup> {
  val groups = raw.asList().map { entry ->
    val group = entry.asMap() ?: return emptyList()
    ProductModifierGroup(
      id = group["id"] as? String ?: "",
      name = group["name"] as? String ?: "",
      min = group["min"].asDouble() ?: return emptyList(),
      max = group["max"].asDouble() ?: return emptyList(),
      options = group["options"].asList().map { item ->
        val option = item.asMap() ?: return emptyList()
        ProductModifierOption(
          id = option["id"] as? String ?: "",
          name = option["name"] as? String ?: "",
          priceCents = option["priceCents"].asDouble() ?: return emptyList(),
        )
      },
    )
  }
  return usableModifierGroups(groups)
}

/** A product document as the till sells it; a legacy product without variants has one `default`. */
fun posItemFrom(doc: FirestoreDoc): PosItem {
  val data = doc.data
  val stored = data["variants"].asList().mapNotNull { it.asMap() }
  val variants = if (stored.isNotEmpty()) {
    stored.map(::posVariantFrom)
  } else {
    listOf(
      PosVariant(
        id = "default",
        label = null,
        unitCents = jsRound((data["priceUsd"].asDouble() ?: 0.0) * 100),
        sku = null,
        barcode = null,
        inventory = data["inventory"].asDouble()?.toLong(),
      ),
    )
  }
  val prices = variants.mapNotNull { it.unitCents }
  return PosItem(
    id = doc.id,
    name = data["name"].asText() ?: "Product",
    imageUrl = data["mediaUrls"].asList().firstOrNull().asText() ?: data["imageUrl"].asText(),
    variants = variants,
    categoryIds = data["categoryIds"].asList().mapNotNull { it as? String },
    modifierGroups = modifierGroupsFrom(data["modifierGroups"]),
    quickKey = data["posQuickKey"] == true,
    fromCents = prices.minOrNull(),
    toCents = prices.maxOrNull(),
  )
}

/** A product with options or modifiers opens the item sheet; anything else goes straight in. */
fun PosItem.needsSheet(): Boolean = variants.size > 1 || modifierGroups.isNotEmpty()

/** Sold out by the tracked count: the till warns, the server decides. */
fun PosVariant.soldOut(): Boolean = inventory != null && inventory <= 0

sealed interface PickResult {
  data class Ok(val pick: CartPick) : PickResult
  data class Problem(val message: String) : PickResult
}

/** What one variant with its modifier choices puts in the basket, or why it cannot be sold. */
fun pickOf(item: PosItem, variant: PosVariant, modifiers: List<ModifierSelection> = emptyList()): PickResult {
  val unit = variant.unitCents ?: return PickResult.Problem("Set a price for ${item.name} before selling it.")
  return when (val resolved = resolveLineModifiers(item.name, item.modifierGroups, modifiers)) {
    is ResolvedModifiers.Refused -> PickResult.Problem(resolved.error)
    is ResolvedModifiers.Ok -> PickResult.Ok(
      CartPick(
        productId = item.id,
        // A product without options has one `default` variant, which the
        // server rings up when no `variantId` is sent.
        variantId = variant.id.takeIf { it != "default" },
        name = item.name,
        variantLabel = lineLabelWithModifiers(variant.label, resolved.modifiers.map { it.name }).ifEmpty { null },
        modifiers = resolved.modifiers.map { ModifierSelection(it.groupId, it.optionId) },
        unitCents = unit + resolved.extraCents,
      ),
    )
  }
}

/** A scanned code as the catalog stores it: separators and spaces gone, lower case (`scannedProductCode`). */
fun scannedProductCode(raw: String?): String? {
  val code = (raw ?: "").replace("\u001d", "").replace(Regex("\\s+"), "").lowercase()
  return code.takeIf { it.isNotEmpty() && it.length <= 64 }
}

data class PosGridArgs(
  /** Typed words: the name search. */
  val search: String = "",
  /** A category tile: every product filed under it. */
  val categoryId: String? = null,
  /** The merchant's quick keys only. */
  val quickKeys: Boolean = false,
)

fun productsPath(hostId: String) = "hosts/$hostId/products"

/** The products hub's request for live, ACTIVE products (`productsListRequest({ filter: 'active' })`). */
private fun activeProductsRequest(search: String = "", extra: List<ListQueryFilter> = emptyList()) = ListQueryRequest(
  base = Contracts.productListBase + ListQueryFilter(ListQueryOp.EQUAL, "status", JsonPrimitive("active")) + extra,
  clauses = emptyList(),
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
)

/**
 * The grid's plan: the products hub's declaration (PRODUCT_LIST_QUERY),
 * narrowed to what the till may sell. A typed word searches the whole
 * catalog, past any category or the quick keys: a cashier who types is
 * looking for something else.
 */
fun posGridPlan(args: PosGridArgs): ListQueryPlan {
  val search = args.search.trim()
  val narrowed = when {
    search.isNotEmpty() -> emptyList()
    args.quickKeys -> listOf(ListQueryFilter(ListQueryOp.EQUAL, "posQuickKey", JsonPrimitive(true)))
    args.categoryId != null -> listOf(ListQueryFilter(ListQueryOp.ARRAY_CONTAINS, "categoryIds", JsonPrimitive(args.categoryId)))
    else -> emptyList()
  }
  return planListQuery(Contracts.productListQuery, activeProductsRequest(search, narrowed))
}

fun posGridQuery(hostId: String, args: PosGridArgs, pageSize: Int = POS_GRID_PAGE_SIZE, startAfter: List<Any?>? = null): FirestoreQuery =
  posGridPlan(args).toFirestoreQuery(productsPath(hostId), pageSize, startAfter)

/** A scan looked up by one code field (`barcodes`, then `skus`), as a whole-code match. */
fun posCodeQuery(hostId: String, field: String, code: String): FirestoreQuery =
  planListQuery(
    Contracts.productListQuery,
    activeProductsRequest().copy(clauses = listOf(ListFilterRequest(field, "contains", code))),
  ).toFirestoreQuery(productsPath(hostId), 1)

/** The variant a scanned code names: its barcode first, then its SKU. */
fun variantForCode(item: PosItem, code: String): PosVariant? {
  val needle = code.trim().lowercase()
  return item.variants.firstOrNull { it.barcode?.lowercase() == needle }
    ?: item.variants.firstOrNull { it.sku?.lowercase() == needle }
}

sealed interface ScanResult {
  data class Found(val item: PosItem, val variant: PosVariant) : ScanResult
  data class Missing(val code: String) : ScanResult
  data object Unreadable : ScanResult
}

data class PosCategory(val id: String, val name: String, val parentId: String?, val order: Double)

fun posCategoryFrom(doc: FirestoreDoc) = PosCategory(
  id = doc.id,
  name = doc.data["name"].asText() ?: "Category",
  parentId = doc.data["parentId"].asText(),
  order = doc.data["order"].asDouble() ?: Double.MAX_VALUE,
)

/** The merchant's order, then the name: how the console's category tree lists them. */
fun sortCategories(categories: List<PosCategory>): List<PosCategory> =
  categories.sortedWith(compareBy<PosCategory> { it.order }.thenBy { it.name.lowercase() }.thenBy { it.id })

/** The tiles for one level: top-level categories (orphans included), or one category's children. */
fun categoryLevel(categories: List<PosCategory>, parentId: String?): List<PosCategory> {
  val ids = categories.map { it.id }.toSet()
  return sortCategories(
    categories.filter { category ->
      if (parentId == null) category.parentId == null || category.parentId !in ids else category.parentId == parentId
    },
  )
}

fun categoriesQuery(hostId: String) = FirestoreQuery("hosts/$hostId/productCategories", limit = POS_CATEGORY_CEILING)
