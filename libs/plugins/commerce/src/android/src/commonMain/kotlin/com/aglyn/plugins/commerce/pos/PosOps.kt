package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.PosCashEventType
import com.aglyn.contracts.PosShift
import com.aglyn.contracts.PosShiftReport
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * RUNNING THE REGISTER (AGL-3609, AGL-3651, AGL-3652): shifts and the cash
 * drawer, and the staff PINs that say who is ringing.
 *
 * The app calls the SAME two routes the console register calls, as the signed
 * in member, so every gate holds on the device unchanged:
 *
 * - `commerce/pos-shift`: `current`, `open`, `cash-event`, `x-report`,
 *   `close`, `print-report`;
 * - `commerce/pos-staff-pin`: `roster`, `verify` (a right PIN buys a signed,
 *   short-lived statement that this member is at this register: the
 *   cashier assertion every sale, payment and shift call then carries),
 *   `refresh`.
 */

const val POS_SHIFT_ROUTE = "/api/commerce/pos-shift"
const val POS_STAFF_PIN_ROUTE = "/api/commerce/pos-staff-pin"

/** The site's register rules (`posOpsSettings`), as the context route reports them. */
data class PosOpsSettings(
  val requireOpenShift: Boolean = false,
  val refundLimitCents: Long = 0,
  /** Minutes without a touch before the register locks; 0 never locks. */
  val autoLockMinutes: Int = 0,
  val receiptAddress: String = "",
  val returnPolicy: String = "",
)

/** What a right PIN buys: a signed statement that this member is at this register. */
data class PosStaffAssertion(
  val assertion: String,
  val expiresAtMs: Long,
  val memberUid: String,
  val name: String,
  /** `cashier` switches who is ringing; `manager` approves one action. */
  val purpose: String,
)

/** A member who can switch in at this register: one with a PIN on this site. */
data class PosRosterMember(val uid: String, val name: String)

/** Whether the signed-in member has a PIN on this site, and whether they may manage everyone's. */
data class PosPinStatus(val hasPin: Boolean, val isManager: Boolean)

/** A shift with the id of its document. */
data class PosShiftRecord(val id: String, val shift: PosShift)

/** The open shift's figures so far. */
data class PosXReport(val shift: PosShiftRecord, val report: PosShiftReport)

/** A shift the close just froze, with its Z report. */
data class PosClosedShift(val shift: PosShiftRecord, val report: PosShiftReport?)

fun readPosOpsSettings(body: JsonElement?): PosOpsSettings {
  val record = body.obj()
  return PosOpsSettings(
    requireOpenShift = record["requireOpenShift"].bool(),
    refundLimitCents = record["refundLimitCents"].cents(),
    autoLockMinutes = record["autoLockMinutes"].cents().toInt().coerceIn(0, 240),
    receiptAddress = record["receiptAddress"].str().orEmpty(),
    returnPolicy = record["returnPolicy"].str().orEmpty(),
  )
}

fun readShiftRecord(element: JsonElement?): PosShiftRecord? {
  val record = element as? JsonObject ?: return null
  val id = record["id"].str() ?: return null
  val shift = runCatching { ContractJsonFormat.decodeFromJsonElement(PosShift.serializer(), record) }.getOrNull() ?: return null
  return PosShiftRecord(id, shift)
}

internal fun readShiftReport(element: JsonElement?): PosShiftReport? =
  (element as? JsonObject)?.let { runCatching { ContractJsonFormat.decodeFromJsonElement(PosShiftReport.serializer(), it) }.getOrNull() }

fun readStaffAssertion(body: JsonElement?): PosStaffAssertion? {
  val record = body.obj()
  return PosStaffAssertion(
    assertion = record["assertion"].str() ?: return null,
    expiresAtMs = record["expiresAtMs"].num()?.let(::jsRound) ?: return null,
    memberUid = record["memberUid"].str() ?: return null,
    name = record["name"].str() ?: "Staff member",
    purpose = record["purpose"].str() ?: "cashier",
  )
}

/** The cash movements the drawer records, in the order the dialog offers them. */
val POS_CASH_TYPES: List<PosCashEventType> = listOf(PosCashEventType.PAID_IN, PosCashEventType.PAID_OUT, PosCashEventType.DROP)

/** The register's shift and PIN routes, as the signed-in member. */
interface PosOpsApi {
  suspend fun currentShift(registerId: String, assertion: String?): PosShiftRecord?
  suspend fun openShift(registerId: String, assertion: String?, floatCents: Long): PosShiftRecord
  suspend fun cashEvent(registerId: String, assertion: String?, type: PosCashEventType, amountCents: Long, reason: String, eventId: String): PosShiftRecord
  suspend fun xReport(registerId: String, assertion: String?): PosXReport
  suspend fun closeShift(registerId: String, assertion: String?, shiftId: String, countedCents: Long, note: String): PosClosedShift

  /** True when a cloud receipt printer took the report; false leaves the report on screen. */
  suspend fun printReport(registerId: String, assertion: String?, shiftId: String?, attemptKey: String): Boolean
  suspend fun roster(): List<PosRosterMember>
  suspend fun pinStatus(): PosPinStatus

  /** Sets a PIN; [memberUid] null is the signed-in member's own, anyone else's needs a workspace admin. */
  suspend fun setPin(memberUid: String?, pin: String)
  suspend fun clearPin(memberUid: String?)
  suspend fun verifyPin(registerId: String, memberUid: String, pin: String, purpose: String): PosStaffAssertion
  suspend fun refresh(registerId: String, assertion: String): PosStaffAssertion?
}

class ConsolePosOpsApi(private val api: ConsoleApiClient, private val hostId: String) : PosOpsApi {
  private suspend fun shiftCall(registerId: String, assertion: String?, action: String, extra: JsonObjectBuilder.() -> Unit = {}): JsonObject {
    val body = buildJsonObject {
      put("hostId", hostId)
      put("registerId", registerId)
      put("action", action)
      assertion?.let { put("cashierAssertion", it) }
      extra()
    }
    return api.request(POS_SHIFT_ROUTE, ApiMethod.POST, body).obj()
  }

  override suspend fun currentShift(registerId: String, assertion: String?): PosShiftRecord? =
    readShiftRecord(shiftCall(registerId, assertion, "current")["shift"])

  override suspend fun openShift(registerId: String, assertion: String?, floatCents: Long): PosShiftRecord =
    readShiftRecord(shiftCall(registerId, assertion, "open") { put("openingFloatCents", floatCents) }["shift"])
      ?: throw IllegalStateException("The register did not answer with a shift.")

  override suspend fun cashEvent(registerId: String, assertion: String?, type: PosCashEventType, amountCents: Long, reason: String, eventId: String): PosShiftRecord =
    readShiftRecord(
      shiftCall(registerId, assertion, "cash-event") {
        put("type", type.raw)
        put("amountCents", amountCents)
        put("reason", reason.trim())
        put("eventId", eventId)
      }["shift"],
    ) ?: throw IllegalStateException("The register did not answer with a shift.")

  override suspend fun xReport(registerId: String, assertion: String?): PosXReport {
    val answer = shiftCall(registerId, assertion, "x-report")
    return PosXReport(
      shift = readShiftRecord(answer["shift"]) ?: throw IllegalStateException("The register did not answer with a shift."),
      report = readShiftReport(answer["report"]) ?: throw IllegalStateException("The register did not answer with a report."),
    )
  }

  override suspend fun closeShift(registerId: String, assertion: String?, shiftId: String, countedCents: Long, note: String): PosClosedShift {
    val answer = shiftCall(registerId, assertion, "close") {
      put("shiftId", shiftId)
      put("countedCashCents", countedCents)
      if (note.isNotBlank()) put("note", note.trim())
    }
    return PosClosedShift(
      shift = readShiftRecord(answer["shift"]) ?: throw IllegalStateException("The register did not answer with a shift."),
      report = readShiftReport(answer["report"]),
    )
  }

  override suspend fun printReport(registerId: String, assertion: String?, shiftId: String?, attemptKey: String): Boolean =
    shiftCall(registerId, assertion, "print-report") {
      shiftId?.let { put("shiftId", it) }
      put("attemptKey", attemptKey)
    }["printed"].bool()

  override suspend fun roster(): List<PosRosterMember> {
    val answer = api.request(POS_STAFF_PIN_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId); put("action", "roster") }).obj()
    return answer["members"].arr().mapNotNull { member ->
      val record = member.obj()
      PosRosterMember(uid = record["uid"].str() ?: return@mapNotNull null, name = record["name"].str() ?: "Staff member")
    }
  }

  override suspend fun pinStatus(): PosPinStatus {
    val answer = api.request(POS_STAFF_PIN_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId); put("action", "status") }).obj()
    return PosPinStatus(hasPin = answer["hasPin"].bool(), isManager = answer["isManager"].bool())
  }

  override suspend fun setPin(memberUid: String?, pin: String) {
    api.request(
      POS_STAFF_PIN_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("action", "set")
        put("pin", pin)
        memberUid?.let { put("memberUid", it) }
      },
    )
  }

  override suspend fun clearPin(memberUid: String?) {
    api.request(
      POS_STAFF_PIN_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("action", "clear")
        memberUid?.let { put("memberUid", it) }
      },
    )
  }

  override suspend fun verifyPin(registerId: String, memberUid: String, pin: String, purpose: String): PosStaffAssertion {
    val answer = api.request(
      POS_STAFF_PIN_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("registerId", registerId)
        put("action", "verify")
        put("purpose", purpose)
        put("memberUid", memberUid)
        put("pin", pin)
      },
    )
    return readStaffAssertion(answer) ?: throw IllegalStateException("That PIN did not work.")
  }

  override suspend fun refresh(registerId: String, assertion: String): PosStaffAssertion? =
    readStaffAssertion(
      api.request(
        POS_STAFF_PIN_ROUTE,
        ApiMethod.POST,
        buildJsonObject {
          put("hostId", hostId)
          put("registerId", registerId)
          put("action", "refresh")
          put("assertion", assertion)
        },
      ),
    )
}

/** The register's shift and PIN routes where there is no console to ask: every call finds it unreachable. */
object OfflinePosOps : PosOpsApi {
  private fun unreachable(): Nothing = throw com.aglyn.core.ConsoleApiError("The register is offline. Check the connection and try again.", 0, null)
  override suspend fun currentShift(registerId: String, assertion: String?): PosShiftRecord? = unreachable()
  override suspend fun openShift(registerId: String, assertion: String?, floatCents: Long): PosShiftRecord = unreachable()
  override suspend fun cashEvent(registerId: String, assertion: String?, type: PosCashEventType, amountCents: Long, reason: String, eventId: String): PosShiftRecord = unreachable()
  override suspend fun xReport(registerId: String, assertion: String?): PosXReport = unreachable()
  override suspend fun closeShift(registerId: String, assertion: String?, shiftId: String, countedCents: Long, note: String): PosClosedShift = unreachable()
  override suspend fun printReport(registerId: String, assertion: String?, shiftId: String?, attemptKey: String): Boolean = unreachable()
  override suspend fun roster(): List<PosRosterMember> = unreachable()
  override suspend fun pinStatus(): PosPinStatus = unreachable()
  override suspend fun setPin(memberUid: String?, pin: String) = unreachable()
  override suspend fun clearPin(memberUid: String?) = unreachable()
  override suspend fun verifyPin(registerId: String, memberUid: String, pin: String, purpose: String): PosStaffAssertion = unreachable()
  override suspend fun refresh(registerId: String, assertion: String): PosStaffAssertion? = unreachable()
}
