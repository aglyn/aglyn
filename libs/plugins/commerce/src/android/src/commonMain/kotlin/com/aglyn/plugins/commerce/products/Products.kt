package com.aglyn.plugins.commerce.products

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.HostProduct
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.contracts.ProductStatus
import com.aglyn.contracts.ProductType
import com.aglyn.contracts.ProductVariant
import com.aglyn.contracts.formatOrderMoney
import com.aglyn.contracts.isLowStock
import com.aglyn.contracts.liftLegacyProduct
import com.aglyn.contracts.productInventory
import com.aglyn.contracts.productPriceRange
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.decode
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.plugins.commerce.pos.Load
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * A site's products in the Aglyn app: the catalog, a product, and a scanned
 * code looked up. The list is the console's products hub query
 * (PRODUCT_LIST_QUERY over live products), so a status chip, the search and
 * a scanned code are each a clause on the one query.
 */

const val PRODUCTS_PAGE_SIZE = 30

fun productsPath(hostId: String) = "hosts/$hostId/products"

/** The chips above the catalog. */
enum class ProductFilter(val label: String, val status: ProductStatus?) {
  ALL("All", null),
  ACTIVE("Active", ProductStatus.ACTIVE),
  DRAFT("Draft", ProductStatus.DRAFT),
  ARCHIVED("Archived", ProductStatus.ARCHIVED),
}

/** The code fields a scan matches whole, barcode first. */
val PRODUCT_CODE_FIELDS = listOf("barcodes", "skus")

/** The hub's request: live products, the chip's status, and the search word or a whole code. */
fun productsListRequest(filter: ProductFilter, search: String = "", code: Pair<String, String>? = null): ListQueryRequest = ListQueryRequest(
  base = Contracts.productListBase,
  clauses = buildList {
    filter.status?.let { add(ListFilterRequest("status", "equals", it.raw)) }
    code?.let { (field, value) -> add(ListFilterRequest(field, "contains", value)) }
  },
  // A code and a search word would both be the query's one array clause.
  search = if (code != null) null else search.trim().ifEmpty { null }?.let { listOf(it) },
)

fun productsQuery(hostId: String, filter: ProductFilter, search: String = "", code: Pair<String, String>? = null, startAfter: List<Any?>? = null): FirestoreQuery =
  planListQuery(Contracts.productListQuery, productsListRequest(filter, search, code))
    .toFirestoreQuery(productsPath(hostId), PRODUCTS_PAGE_SIZE, startAfter)

/** A product as the console reads it ([liftLegacyProduct]). */
fun hostProductFrom(doc: FirestoreDoc): HostProduct = liftLegacyProduct(doc.decode(HostProduct.serializer()) ?: HostProduct())

/** One row of the catalog. */
data class ProductRow(
  val id: String,
  val name: String,
  val status: ProductStatus,
  val type: ProductType,
  val priceRange: Pair<Double, Double>,
  /** Tracked units across variants; null when nothing is tracked. */
  val inventory: Double?,
  val lowStock: Boolean,
  val variantCount: Int,
)

fun productRow(doc: FirestoreDoc): ProductRow {
  val product = hostProductFrom(doc)
  return ProductRow(
    id = doc.id,
    name = product.name ?: "Product",
    status = product.status ?: ProductStatus.ACTIVE,
    type = product.type ?: ProductType.PHYSICAL,
    priceRange = productPriceRange(product),
    inventory = productInventory(product),
    lowStock = isLowStock(product),
    variantCount = product.variants.orEmpty().size,
  )
}

/** Dollars as the store shows them, through the console's money formatter: `$12.50`, or a range `$5.00–$12.50`. */
fun priceLabel(range: Pair<Double, Double>): String {
  fun dollars(value: Double) = formatOrderMoney(value * 100)
  return if (range.first == range.second) dollars(range.first) else "${dollars(range.first)}–${dollars(range.second)}"
}

/** A variant's name from its option picks (`Large / Oat`), or the product's own when it has none. */
fun variantLabel(variant: ProductVariant): String = variant.options.orEmpty().values.filter { it.isNotBlank() }.joinToString(" / ").ifEmpty { "Default" }

/** Stock words: untracked, sold out, or a count. */
fun stockLabel(inventory: Double?): String = when {
  inventory == null -> "Not tracked"
  inventory <= 0 -> "Sold out"
  else -> "${inventory.toLong()} in stock"
}

/** The catalog for one site: the chip, the search, the rows read so far and whether more are left. */
class ProductsListModel(private val hostId: String, private val firestore: FirestoreReader, private val scope: CoroutineScope) {
  var filter by mutableStateOf(ProductFilter.ALL)
    private set
  var search by mutableStateOf("")
    private set
  var rows by mutableStateOf<Load<List<ProductRow>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null

  fun pick(next: ProductFilter) {
    if (next == filter) return
    filter = next
    reload()
  }

  fun type(next: String) {
    if (next == search) return
    search = next
    reload(debounce = true)
  }

  fun reload(debounce: Boolean = false) {
    job?.cancel()
    val asked = filter to search
    if (!debounce) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(300)
      rows = Load.Loading
      rows = try {
        val page = firestore.page(productsQuery(hostId, asked.first, asked.second))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(::productRow))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("Products could not be loaded. Check the connection and try again.")
      }
    }
  }

  fun loadMore() {
    val after = cursor ?: return
    val shown = (rows as? Load.Ready)?.value ?: return
    if (job?.isActive == true) return
    val asked = filter to search
    job = scope.launch {
      runCatching { firestore.page(productsQuery(hostId, asked.first, asked.second, startAfter = after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(::productRow).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }
}

/** What a scanned or typed code found: the products whose barcode, else SKU, is that whole code. */
suspend fun findProductsByCode(firestore: FirestoreReader, hostId: String, raw: String): List<ProductRow> {
  val code = raw.trim()
  if (code.isEmpty()) return emptyList()
  for (field in PRODUCT_CODE_FIELDS) {
    val found = firestore.page(productsQuery(hostId, ProductFilter.ALL, code = field to code)).docs
    if (found.isNotEmpty()) return found.map(::productRow)
  }
  return emptyList()
}
