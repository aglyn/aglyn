package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.CheckInCustomer
import com.aglyn.contracts.CheckInRow
import com.aglyn.contracts.CheckInWristband
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.HostCheckInSource
import com.aglyn.contracts.WristbandCheck
import com.aglyn.contracts.alreadyCheckedInLabel
import com.aglyn.contracts.checkedInLine
import com.aglyn.contracts.normalizeWristband
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/*
 * CHECK-IN AT THE WINDOW (AGL-4043, AGL-4063): a rider who bought a day pass online, a camper, a guest whose stay covers
 * today walks up; the register finds them by name, email, phone or order number and checks each person in, with an
 * optional wristband. The Apple app's `PosCheckIn.swift`, line for line.
 *
 * The app calls the SAME route the console register calls (`POS_CHECK_IN_ROUTE`), as the signed-in member with the
 * register and the PIN's cashier, so every gate holds on the device unchanged:
 *   `search` {text} -> {dayKey, timeZone, customers}
 *   `customer` {customerKey | email | contactId} -> {dayKey, timeZone, customer, checkIns}
 *   `check_in` {checkIns: [{id, wristband?}]} with an Idempotency-Key -> {checkedIn, alreadyCheckedIn, missing}
 *   `undo` {id} -> {checkIn}
 */

/** How long typing pauses before the register asks (the console's `SEARCH_DEBOUNCE_MS`). */
const val POS_CHECK_IN_DEBOUNCE_MS = 250L

/** The day the route answered for: its key in the site's time zone, and that zone. */
data class PosCheckInDay(val dayKey: String, val timeZone: String)

/** Who to open, as the register's customer panel names them. */
data class PosCheckInTarget(
  val customerKey: String? = null,
  val email: String? = null,
  val contactId: String? = null,
  /** `if-used`: bring the day in line only on a day the window is already checking people in. */
  val reconcile: String? = null,
) {
  val isEmpty: Boolean get() = listOf(customerKey, email, contactId).all { it.isNullOrEmpty() }
}

data class PosCheckInCustomerAnswer(val day: PosCheckInDay?, val customer: CheckInCustomer?, val rows: List<CheckInRow>)

data class PosCheckInResult(val checkedIn: List<CheckInRow>, val alreadyCheckedIn: List<CheckInRow>)

/** One check-in the register sends: the person, and the wristband handed over (if any). */
data class PosCheckInPick(val id: String, val wristband: CheckInWristband?)

interface PosCheckInApi {
  suspend fun search(text: String): Pair<PosCheckInDay?, List<CheckInCustomer>>
  suspend fun customer(target: PosCheckInTarget): PosCheckInCustomerAnswer
  suspend fun checkIn(picks: List<PosCheckInPick>, registerId: String?, assertion: String?, attemptKey: String): PosCheckInResult
  suspend fun undo(id: String, registerId: String?, assertion: String?): CheckInRow
}

/** The answer's rows: each `{ id, ...record }` decoded through the generated record. */
internal fun readCheckInRows(value: JsonElement?): List<CheckInRow> = (value as? JsonArray).orEmpty().mapNotNull { CheckInRow.parse(it) }

internal fun readCheckInCustomer(value: JsonElement?): CheckInCustomer? =
  (value as? JsonObject)?.let { runCatching { ContractJsonFormat.decodeFromJsonElement(CheckInCustomer.serializer(), it) }.getOrNull() }

private fun readDay(answer: JsonObject): PosCheckInDay? {
  val key = (answer["dayKey"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: return null
  return PosCheckInDay(key, (answer["timeZone"] as? JsonPrimitive)?.contentOrNull ?: "UTC")
}

class ConsolePosCheckInApi(private val api: ConsoleApiClient, private val hostId: String) : PosCheckInApi {
  private suspend fun call(action: String, attemptKey: String? = null, extra: JsonObjectBuilder.() -> Unit): JsonObject {
    val body = buildJsonObject {
      put("hostId", hostId)
      put("action", action)
      extra()
    }
    return api.request(Contracts.posCheckInRoute, ApiMethod.POST, body, idempotencyKey = attemptKey).obj()
  }

  private fun JsonObjectBuilder.cashier(registerId: String?, assertion: String?) {
    registerId?.takeIf { it.isNotEmpty() }?.let { put("registerId", it) }
    assertion?.takeIf { it.isNotEmpty() }?.let { put("cashierAssertion", it) }
  }

  override suspend fun search(text: String): Pair<PosCheckInDay?, List<CheckInCustomer>> {
    val answer = call("search") { put("text", text) }
    return readDay(answer) to (answer["customers"] as? JsonArray).orEmpty().mapNotNull { readCheckInCustomer(it) }
  }

  override suspend fun customer(target: PosCheckInTarget): PosCheckInCustomerAnswer {
    val answer = call("customer") {
      target.customerKey?.takeIf { it.isNotEmpty() }?.let { put("customerKey", it) }
      target.email?.takeIf { it.isNotEmpty() }?.let { put("email", it) }
      target.contactId?.takeIf { it.isNotEmpty() }?.let { put("contactId", it) }
      target.reconcile?.let { put("reconcile", it) }
    }
    return PosCheckInCustomerAnswer(readDay(answer), readCheckInCustomer(answer["customer"]), readCheckInRows(answer["checkIns"]))
  }

  override suspend fun checkIn(picks: List<PosCheckInPick>, registerId: String?, assertion: String?, attemptKey: String): PosCheckInResult {
    val answer = call("check_in", attemptKey) {
      cashier(registerId, assertion)
      put(
        "checkIns",
        buildJsonArray {
          for (pick in picks) {
            add(
              buildJsonObject {
                put("id", pick.id)
                pick.wristband?.let { band ->
                  put("wristband", buildJsonObject { put("number", band.number.orEmpty()); put("color", band.color.orEmpty()) })
                }
              },
            )
          }
        },
      )
    }
    return PosCheckInResult(readCheckInRows(answer["checkedIn"]), readCheckInRows(answer["alreadyCheckedIn"]))
  }

  override suspend fun undo(id: String, registerId: String?, assertion: String?): CheckInRow {
    val answer = call("undo") {
      cashier(registerId, assertion)
      put("id", id)
    }
    return CheckInRow.parse(answer["checkIn"]) ?: throw IllegalStateException("The check-in could not be undone.")
  }
}

/** The register's check-in route where there is no console to ask. */
object OfflinePosCheckIn : PosCheckInApi {
  private fun unreachable() = ConsoleApiError("The register is offline. Check the connection and try again.", 0, null)
  override suspend fun search(text: String): Pair<PosCheckInDay?, List<CheckInCustomer>> = throw unreachable()
  override suspend fun customer(target: PosCheckInTarget): PosCheckInCustomerAnswer = throw unreachable()
  override suspend fun checkIn(picks: List<PosCheckInPick>, registerId: String?, assertion: String?, attemptKey: String): PosCheckInResult = throw unreachable()
  override suspend fun undo(id: String, registerId: String?, assertion: String?): CheckInRow = throw unreachable()
}

/** A wristband as it is being typed for one person. */
data class PosWristbandDraft(val number: String = "", val color: String = "")

private fun Throwable.said(fallback: String): String = (this as? ConsoleApiError)?.message?.takeIf { it.isNotEmpty() } ?: fallback

/**
 * The check-in sheet's state: the search, the customer open on it, their rows and the wristbands being typed. The words are the
 * console dialog's (`pos-check-in-dialog.component.tsx`).
 */
class PosCheckInModel(
  private val api: PosCheckInApi,
  private val scope: CoroutineScope,
  private val registerId: () -> String?,
  private val assertion: () -> String?,
) {
  var text by mutableStateOf("")
    private set
  var customers by mutableStateOf<List<CheckInCustomer>>(emptyList())
    private set
  var searched by mutableStateOf(false)
    private set
  var day by mutableStateOf<PosCheckInDay?>(null)
    private set
  var customer by mutableStateOf<CheckInCustomer?>(null)
    private set
  var rows by mutableStateOf<List<CheckInRow>>(emptyList())
    private set
  val drafts = mutableStateMapOf<String, PosWristbandDraft>()
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf("")
  var notice by mutableStateOf("")

  private var searching: Job? = null
  private var ticket = 0

  /** The people still to check in. */
  val waiting: List<CheckInRow> get() = rows.filter { !it.checkedIn }
  val checkedInCount: Int get() = rows.count { it.checkedIn }
  val title: String
    get() = customer?.let { one -> listOfNotNull(one.name, one.email).firstOrNull { it.isNotEmpty() } ?: "Customer" } ?: "Check in"

  /** Typing: waits out the pause, then asks; a newer keystroke cancels the wait and any answer still coming. */
  fun type(next: String) {
    text = next
    searching?.cancel()
    val typed = next.trim()
    val mine = ++ticket
    if (typed.length < 2) {
      customers = emptyList()
      searched = false
      return
    }
    searching = scope.launch {
      delay(POS_CHECK_IN_DEBOUNCE_MS)
      try {
        val (answerDay, found) = api.search(typed)
        if (mine != ticket) return@launch
        error = ""
        answerDay?.let { day = it }
        customers = found
        searched = true
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        if (mine == ticket) error = failure.said("The search did not run.")
      }
    }
  }

  suspend fun open(target: PosCheckInTarget) {
    busy = true
    error = ""
    notice = ""
    try {
      val answer = api.customer(target)
      answer.day?.let { day = it }
      customer = answer.customer
      rows = answer.rows
      drafts.clear()
      if (answer.rows.isEmpty()) notice = "Nothing to check in today for this customer."
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = failure.said("That customer could not be opened.")
    } finally {
      busy = false
    }
  }

  fun backToSearch() {
    customer = null
    rows = emptyList()
    notice = ""
  }

  suspend fun checkIn(targets: List<CheckInRow>) {
    if (targets.isEmpty()) return
    val picks = mutableListOf<PosCheckInPick>()
    for (row in targets) {
      val draft = drafts[row.id] ?: PosWristbandDraft()
      when (val check = normalizeWristband(draft.number, draft.color)) {
        is WristbandCheck.Ok -> picks += PosCheckInPick(row.id, check.wristband)
        is WristbandCheck.Refused -> {
          error = check.error
          return
        }
      }
    }
    busy = true
    error = ""
    notice = ""
    try {
      val answer = api.checkIn(picks, registerId(), assertion(), newAttemptKey("pos-check-in"))
      merge(answer.checkedIn + answer.alreadyCheckedIn)
      val first = answer.alreadyCheckedIn.firstOrNull()
      val zone = day?.timeZone
      if (first != null && zone != null) notice = alreadyCheckedInLabel(first.record.checkedInAtMs, first.record.checkedInByName, zone)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = failure.said("They could not be checked in.")
    } finally {
      busy = false
    }
  }

  suspend fun undo(row: CheckInRow) {
    busy = true
    error = ""
    notice = ""
    try {
      merge(listOf(api.undo(row.id, registerId(), assertion())))
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = failure.said("The check-in could not be undone.")
    } finally {
      busy = false
    }
  }

  /** What a row says under its name: when and by whom it was checked in and the wristband, else its order or "Stay". */
  fun detail(row: CheckInRow): String {
    val zone = day?.timeZone
    if (row.checkedIn && zone != null) return checkedInLine(row.record, zone)
    return row.record.orderLabel ?: if (row.record.source == HostCheckInSource.RESERVATION) "Stay" else ""
  }

  private fun merge(changed: List<CheckInRow>) {
    val byId = changed.associateBy { it.id }
    rows = rows.map { byId[it.id] ?: it }
  }
}

/** A customer search row's second line, as the console lists it: "1 of 3 checked in · Day pass, RV camping · email · phone". */
fun checkInCustomerLine(customer: CheckInCustomer): String =
  listOf(
    "${customer.unitsCheckedIn ?: 0} of ${customer.unitsDue ?: 0} checked in",
    customer.items.orEmpty().joinToString(", "),
    customer.email.orEmpty(),
    customer.phone.orEmpty(),
  ).filter { it.isNotEmpty() }.joinToString(" · ")

/**
 * The `posCheckIn` zone's params for one customer on one day, as the console hands its widgets (`ConsolePosCheckInZoneProps`):
 * never why anybody is checking them.
 */
fun posCheckInZoneParams(hostId: String, contactId: String?, email: String?, dayKey: String, name: String?, unitsDue: Int, placement: String): Map<String, String> =
  buildMap {
    put("hostId", hostId)
    put("dayKey", dayKey)
    put("unitsDue", unitsDue.toString())
    put("placement", placement)
    contactId?.takeIf { it.isNotEmpty() }?.let { put("contactId", it) }
    email?.takeIf { it.isNotEmpty() }?.let { put("email", it.lowercase()) }
    name?.takeIf { it.isNotEmpty() }?.let { put("name", it) }
  }

/** The customer a sale is rung for, as the check-in route finds them: by email, else by their contact. */
fun checkInTarget(customer: PosCustomer): PosCheckInTarget? = when {
  !customer.email.isNullOrEmpty() -> PosCheckInTarget(email = customer.email)
  customer.kind == "contact" && customer.id.isNotEmpty() -> PosCheckInTarget(contactId = customer.id)
  else -> null
}

/**
 * What the attached customer has to check in today (the console's customer panel): the day, how many still wait and how many in
 * all. Nothing when the route has nothing for the day or cannot be asked.
 */
class PosCheckInDue(private val api: PosCheckInApi) {
  var dayKey by mutableStateOf<String?>(null)
    private set
  var waiting by mutableStateOf(0)
    private set
  var total by mutableStateOf(0)
    private set

  suspend fun load(customer: PosCustomer?) {
    dayKey = null
    waiting = 0
    total = 0
    val target = customer?.let { checkInTarget(it) }?.copy(reconcile = "if-used") ?: return
    val answer = try {
      api.customer(target)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      return
    }
    val day = answer.day ?: return
    dayKey = day.dayKey
    waiting = answer.rows.count { !it.checkedIn }
    total = answer.rows.size
  }
}
