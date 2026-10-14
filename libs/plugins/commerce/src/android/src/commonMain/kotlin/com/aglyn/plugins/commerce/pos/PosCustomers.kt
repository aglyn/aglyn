package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * THE CUSTOMER AT THE REGISTER (AGL-3609, AGL-3651, AGL-3652): search the
 * workspace's people by name, email or phone, see what they have bought here
 * before, attach them to the sale, or add a new one in a few taps. Where the
 * workspace keeps no people, the register falls back to an email typed for
 * the receipt. The Apple app's `PosCustomers.swift`, line for line.
 *
 * The app calls the SAME route the console register's customer lookup calls,
 * `commerce/pos-customer` (`search`, `stats`, `create`), as the signed-in
 * member. The sale then carries the customer the way the console's does:
 * `customer` {kind, id, name, email, phone} plus `customerEmail`.
 */

const val POS_CUSTOMER_ROUTE = "/api/commerce/pos-customer"

/** A search needs this many characters before the register asks. */
const val POS_CUSTOMER_SEARCH_MINIMUM = 2

/** How long typing pauses before the register asks. */
const val POS_CUSTOMER_DEBOUNCE_MS = 250L

/** The customer a sale is rung for. `id` is empty (and `kind` "none") when no record system keeps people. */
@Serializable
data class PosCustomer(
  val kind: String,
  val id: String = "",
  val name: String = "",
  val email: String? = null,
  val phone: String? = null,
) {
  /** What the basket calls them. */
  val title: String get() = name.ifEmpty { email?.takeIf { it.isNotEmpty() } ?: "Customer" }

  fun toJson(): JsonObject = buildJsonObject {
    put("kind", kind)
    put("id", id)
    put("name", name)
    email?.let { put("email", it) }
    phone?.let { put("phone", it) }
  }

  companion object {
    /** Only an email typed for the receipt, with no record behind it. */
    fun typed(email: String) = PosCustomer(kind = "none", email = email.lowercase())

    fun read(element: JsonElement?): PosCustomer? {
      val record = element as? JsonObject ?: return null
      return PosCustomer(
        kind = record["kind"].str() ?: return null,
        id = record["id"].str().orEmpty(),
        name = record["name"].str().orEmpty(),
        email = record["email"].str()?.ifEmpty { null },
        phone = record["phone"].str()?.ifEmpty { null },
      )
    }
  }
}

data class PosCustomerSearch(
  /** False when the workspace keeps no people: the register takes an email instead. */
  val available: Boolean,
  val customers: List<PosCustomer>,
)

data class PosCustomerStats(val orderCount: Int, val lifetimeSpendCents: Long)

private val CUSTOMER_EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

/** A text that is an email address, the same test the console uses. */
fun isCustomerEmail(text: String): Boolean = CUSTOMER_EMAIL.matches(text)

/** The customer route, as the signed-in member. */
interface PosCustomersApi {
  suspend fun search(text: String): PosCustomerSearch
  suspend fun stats(email: String): PosCustomerStats
  suspend fun create(name: String, email: String, phone: String): PosCustomer
}

class ConsolePosCustomersApi(private val api: ConsoleApiClient, private val hostId: String) : PosCustomersApi {
  private suspend fun call(action: String, extra: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}): JsonObject =
    api.request(
      POS_CUSTOMER_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("action", action)
        extra()
      },
    ).obj()

  override suspend fun search(text: String): PosCustomerSearch {
    val answer = call("search") { put("text", text) }
    return PosCustomerSearch(
      available = answer["available"]?.let { it.bool() } ?: true,
      customers = answer["customers"].arr().mapNotNull(PosCustomer::read),
    )
  }

  override suspend fun stats(email: String): PosCustomerStats {
    val answer = call("stats") { put("email", email) }
    return PosCustomerStats(answer["orderCount"].cents().toInt(), answer["lifetimeSpendCents"].cents())
  }

  override suspend fun create(name: String, email: String, phone: String): PosCustomer {
    val answer = call("create") {
      put("name", name.trim())
      put("email", email.trim())
      put("phone", phone.trim())
    }
    return PosCustomer.read(answer["customer"]) ?: throw ConsoleApiError("The register did not answer with a customer.", 502, null)
  }
}

/** The customer route where there is no console to ask: every call finds it unreachable. */
object OfflinePosCustomers : PosCustomersApi {
  private fun unreachable(): Nothing = throw ConsoleApiError("The register is offline. Check the connection and try again.", 0, null)
  override suspend fun search(text: String): PosCustomerSearch = unreachable()
  override suspend fun stats(email: String): PosCustomerStats = unreachable()
  override suspend fun create(name: String, email: String, phone: String): PosCustomer = unreachable()
}

/** The lookup beside the basket: the search, the quick-add form and the attached customer's history. */
class PosCustomerModel(private val api: PosCustomersApi, private val scope: CoroutineScope) {
  var text by mutableStateOf("")
    private set
  var results by mutableStateOf<List<PosCustomer>>(emptyList())
    private set

  /** False when the workspace keeps no people. */
  var available by mutableStateOf(true)
    private set
  var stats by mutableStateOf<PosCustomerStats?>(null)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var busy by mutableStateOf(false)
    private set

  /** The quick-add form is open. */
  var adding by mutableStateOf(false)
    private set
  var draftName by mutableStateOf("")
  var draftEmail by mutableStateOf("")
  var draftPhone by mutableStateOf("")

  private var searching: Job? = null

  /** The text is an email the cashier can use as it is. */
  val typedEmail: String? get() = text.trim().takeIf(::isCustomerEmail)?.lowercase()

  /** Typing: waits out the pause, then asks; a newer keystroke cancels the wait and any answer still coming. */
  fun type(next: String) {
    text = next
    searching?.cancel()
    val typed = next.trim()
    if (typed.length < POS_CUSTOMER_SEARCH_MINIMUM) {
      results = emptyList()
      return
    }
    searching = scope.launch {
      delay(POS_CUSTOMER_DEBOUNCE_MS)
      try {
        val answer = api.search(typed)
        available = answer.available
        results = answer.customers
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        results = emptyList()
      }
    }
  }

  /** Reads what the attached customer has bought here; nothing for a customer with no email. */
  fun loadStats(email: String?) {
    stats = null
    if (email == null || !isCustomerEmail(email)) return
    scope.launch {
      try {
        stats = api.stats(email)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
      }
    }
  }

  /** A customer was attached: the search starts over. */
  fun clearSearch() {
    searching?.cancel()
    text = ""
    results = emptyList()
  }

  fun startAdding() {
    draftName = ""
    draftEmail = typedEmail.orEmpty()
    draftPhone = ""
    error = null
    adding = true
  }

  fun cancelAdding() {
    if (busy) return
    adding = false
    error = null
  }

  /** Adds the customer through the route and hands them to [onAdded]; on a refusal the reason is in [error]. */
  fun create(onAdded: (PosCustomer) -> Unit) {
    if (busy) return
    if (!isCustomerEmail(draftEmail.trim())) {
      error = "Add the customer’s email address."
      return
    }
    busy = true
    error = null
    scope.launch {
      try {
        val customer = api.create(draftName, draftEmail, draftPhone)
        adding = false
        onAdded(customer)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.message ?: "Could not add the customer."
      } finally {
        busy = false
      }
    }
  }
}
