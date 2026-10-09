package com.aglyn.plugins.commerce.orders

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreReader
import com.aglyn.core.listquery.planListQuery
import com.aglyn.plugins.commerce.pos.Load
import com.aglyn.plugins.commerce.pos.newAttemptKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** How long typing rests before the search runs. */
const val ORDERS_SEARCH_DEBOUNCE_MS = 300L

/**
 * The orders list for one site: the chip, the search, the rows read so far
 * and whether more are left. Screens read it and call it.
 */
class OrdersListModel(
  private val hostId: String,
  private val firestore: FirestoreReader,
  private val scope: CoroutineScope,
) {
  var filter by mutableStateOf(OrderFilter.ALL)
    private set
  var search by mutableStateOf("")
    private set
  var rows by mutableStateOf<Load<List<OrderRow>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var loadingMore by mutableStateOf(false)
    private set

  /** What the planner could not serve (a second search word, say), in its own words. */
  var notice by mutableStateOf<String?>(null)
    private set

  private var cursor: List<Any?>? = null
  private var job: Job? = null

  fun pick(next: OrderFilter) {
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
    val askedFilter = filter
    val askedSearch = search
    if (!debounce) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(ORDERS_SEARCH_DEBOUNCE_MS)
      rows = Load.Loading
      val plan = planListQuery(Contracts.orderListQuery, ordersListRequest(askedFilter, askedSearch))
      notice = plan.refused.firstOrNull()?.reason?.let { "Some of the search was left out: $it." }
      rows = try {
        val page = firestore.page(ordersQuery(hostId, askedFilter, askedSearch))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(::orderRow))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("Orders could not be loaded. Check the connection and try again.")
      }
    }
  }

  fun loadMore() {
    val after = cursor ?: return
    val shown = (rows as? Load.Ready)?.value ?: return
    if (job?.isActive == true) return
    val askedFilter = filter
    val askedSearch = search
    loadingMore = true
    job = scope.launch {
      try {
        val page = firestore.page(ordersQuery(hostId, askedFilter, askedSearch, startAfter = after))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(::orderRow).filter { row -> shown.none { it.id == row.id } })
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
      } finally {
        loadingMore = false
      }
    }
  }
}

/** The dialogs an order's screen opens, one at a time. */
enum class OrderDialog { FULFILL, DELIVERED, REFUND, CANCEL, RECEIPT, NOTE }

/**
 * One order's actions: which dialog is open, whether its call is running,
 * why the last one failed, and what just happened. Each dialog that moves
 * money or ships goods gets one attempt key when it opens, so a retry of the
 * same press is the same attempt to the route.
 */
class OrderActionsModel(
  private val api: OrderActionsApi,
  private val scope: CoroutineScope,
  private val mintKey: () -> String = { newAttemptKey("orders-app") },
) {
  var dialog by mutableStateOf<OrderDialog?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var done by mutableStateOf<String?>(null)

  var attemptKey: String = mintKey()
    private set

  var receiptChannels by mutableStateOf(setOf(ReceiptChannel.EMAIL))
    private set

  fun open(next: OrderDialog) {
    dialog = next
    error = null
    attemptKey = mintKey()
    if (next == OrderDialog.RECEIPT) scope.launch { receiptChannels = api.receiptChannels().ifEmpty { setOf(ReceiptChannel.EMAIL) } }
  }

  fun close() {
    if (!busy) dialog = null
  }

  /**
   * Answers the order's open restock question. The route re-reads the order,
   * so an answer someone else already gave, or a newer question, is said so
   * and nothing is written (the console's words for each).
   */
  fun answerRestock(orderId: String, choice: RestockAnswerChoice, flaggedAtMs: Double) {
    if (busy) return
    busy = true
    error = null
    scope.launch {
      try {
        done = when (api.answerRestock(orderId, choice, flaggedAtMs)) {
          "answered" -> "This restock question was already answered — nothing changed."
          "changed" -> "The restock question changed since this screen loaded — nothing was written. Reload the order to see the current one."
          else -> choice.recorded
        }
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.message ?: "That did not go through. Check the connection and try again."
        done = null
      } finally {
        busy = false
      }
    }
  }

  /** Runs [call]; on success closes the dialog and says [success], else keeps it open with the reason. */
  fun run(success: String, call: suspend OrderActionsApi.(attemptKey: String) -> Unit) {
    if (busy) return
    busy = true
    error = null
    val key = attemptKey
    scope.launch {
      try {
        api.call(key)
        dialog = null
        done = success
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.message ?: "That did not go through. Check the connection and try again."
      } finally {
        busy = false
      }
    }
  }
}
