package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.PosCashEventType
import com.aglyn.contracts.PosShift
import com.aglyn.contracts.PosShiftReport
import com.aglyn.contracts.PosShiftStatus
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun shiftOf(status: PosShiftStatus = PosShiftStatus.OPEN, float: Double = 15_000.0) = PosShift(
  cashEvents = emptyList(), hostId = "h1", openedAtMs = 1_700_000_000_000.0, openedBy = "u1", openingFloatCents = float,
  registerId = "r1", status = status,
)

private fun report(expected: Double = 21_240.0) = PosShiftReport(
  cashRefundsCents = 0.0, cashSalesCents = 6_240.0, discountsCents = 0.0, dropsCents = 0.0, expectedCashCents = expected,
  grossSalesCents = 6_240.0, netSalesCents = 6_240.0, openingFloatCents = 15_000.0, orderCount = 3.0, paidInCents = 0.0,
  paidOutCents = 0.0, refundCount = 0.0, refundsByTender = emptyMap(), refundsCents = 0.0, salesByTender = mapOf("cash" to 6_240.0),
  taxCents = 0.0, tipsCents = 0.0,
)

/** A script of answers for the shift and PIN routes, recording what was asked. */
private class FakeOps : PosOpsApi {
  val calls = mutableListOf<String>()
  var current: PosShiftRecord? = null
  var failWith: Throwable? = null
  var roster = listOf(PosRosterMember("u1", "Ana"), PosRosterMember("u2", "Ben"))
  var refreshed: PosStaffAssertion? = null
  var printed = false

  private fun note(call: String) {
    calls += call
    failWith?.let { throw it }
  }

  override suspend fun currentShift(registerId: String, assertion: String?): PosShiftRecord? = current.also { note("current $registerId $assertion") }
  override suspend fun openShift(registerId: String, assertion: String?, floatCents: Long): PosShiftRecord {
    note("open $registerId $assertion $floatCents")
    return PosShiftRecord("s1", shiftOf(float = floatCents.toDouble())).also { current = it }
  }
  override suspend fun cashEvent(registerId: String, assertion: String?, type: PosCashEventType, amountCents: Long, reason: String, eventId: String): PosShiftRecord {
    note("cash $type $amountCents '$reason' $eventId")
    return current ?: PosShiftRecord("s1", shiftOf())
  }
  override suspend fun xReport(registerId: String, assertion: String?): PosXReport {
    note("x-report")
    return PosXReport(current ?: PosShiftRecord("s1", shiftOf()), report())
  }
  override suspend fun closeShift(registerId: String, assertion: String?, shiftId: String, countedCents: Long, note: String): PosClosedShift {
    note("close $shiftId $countedCents '$note'")
    return PosClosedShift(PosShiftRecord(shiftId, shiftOf(PosShiftStatus.CLOSED)), report())
  }
  override suspend fun printReport(registerId: String, assertion: String?, shiftId: String?, attemptKey: String): Boolean {
    note("print $shiftId")
    return printed
  }
  override suspend fun roster(): List<PosRosterMember> = roster.also { note("roster") }
  var status = PosPinStatus(hasPin = false, isManager = false)
  override suspend fun pinStatus(): PosPinStatus = status.also { note("status") }
  override suspend fun setPin(memberUid: String?, pin: String) {
    note("set-pin ${memberUid ?: "me"} $pin")
    status = status.copy(hasPin = true)
  }
  override suspend fun clearPin(memberUid: String?) {
    note("clear-pin ${memberUid ?: "me"}")
    status = status.copy(hasPin = false)
  }
  override suspend fun verifyPin(registerId: String, memberUid: String, pin: String, purpose: String): PosStaffAssertion {
    note("verify $memberUid $pin $purpose")
    return PosStaffAssertion("assert-$memberUid", 10_000_000, memberUid, roster.first { it.uid == memberUid }.name, purpose)
  }
  override suspend fun refresh(registerId: String, assertion: String): PosStaffAssertion? {
    note("refresh $assertion")
    return refreshed
  }
}

private val ana = PosStaffAssertion("a-1", 1_000_000, "u1", "Ana", "cashier")

class PosCashierTest {
  @Test
  fun anIdleRegisterLocksAndDropsTheCashier() = runTest {
    var clock = 0L
    val cashier = PosCashier(FakeOps(), { "r1" }, { 5 }, { clock })
    cashier.switchTo(ana)
    clock = 4 * 60_000
    cashier.tick()
    assertFalse(cashier.locked)
    clock = 5 * 60_000 + 1
    cashier.tick()
    assertTrue(cashier.locked)
    assertNull(cashier.cashier, "the next person enters their own PIN")
  }

  @Test
  fun aTouchKeepsTheRegisterAwakeAndZeroMinutesNeverLocks() = runTest {
    var clock = 0L
    val busy = PosCashier(FakeOps(), { "r1" }, { 5 }, { clock })
    clock = 4 * 60_000
    busy.touch()
    clock = 8 * 60_000
    busy.tick()
    assertFalse(busy.locked)
    val never = PosCashier(FakeOps(), { "r1" }, { 0 }, { clock })
    clock = 10 * 60 * 60_000
    never.tick()
    assertFalse(never.locked)
  }

  @Test
  fun aWorkingCashierEarnsAFreshAssertionBeforeItExpires() = runTest {
    var clock = 0L
    val ops = FakeOps().apply { refreshed = PosStaffAssertion("a-2", 2_000_000, "u1", "Ana", "cashier") }
    val cashier = PosCashier(ops, { "r1" }, { 0 }, { clock })
    cashier.switchTo(ana.copy(expiresAtMs = 5 * 60_000))
    clock = 3 * 60_000
    cashier.touch()
    cashier.tick()
    assertEquals("a-2", cashier.assertion)
    assertEquals(2_000_000, cashier.cashier?.expiresAtMs)
  }

  @Test
  fun anAssertionThatExpiredOrWasRefusedDropsBackToTheSignedInMember() = runTest {
    var clock = 0L
    val ops = FakeOps()
    val cashier = PosCashier(ops, { "r1" }, { 0 }, { clock })
    cashier.switchTo(ana.copy(expiresAtMs = 100_000))
    clock = 100_001
    cashier.tick()
    assertNull(cashier.cashier, "an expired assertion is dropped")

    cashier.switchTo(ana.copy(expiresAtMs = 5 * 60_000))
    clock = 100_001 + 3 * 60_000
    cashier.touch()
    ops.failWith = ConsoleApiError("Not permitted", 403, null)
    cashier.tick()
    assertNull(cashier.cashier, "a refused refresh drops the cashier")
  }

  @Test
  fun switchingRegistersLeavesNobodyAtTheNewTill() {
    val cashier = PosCashier(FakeOps(), { "r1" }, { 0 })
    cashier.switchTo(ana)
    cashier.lock()
    cashier.reset()
    assertNull(cashier.cashier)
    assertFalse(cashier.locked)
  }
}

class PosPinPadTest {
  @Test
  fun aPinPadPicksYourNameTapsDigitsAndGetsAnAssertion() = runTest {
    val ops = FakeOps()
    var verified: PosStaffAssertion? = null
    val pad = PosPinPadModel(ops, this, "r1", "cashier") { verified = it }
    pad.load()
    advanceUntilIdle()
    assertEquals(2, pad.members?.size)
    assertFalse(pad.canSubmit)
    pad.pick("u2")
    "12345678".forEach { pad.press(it.toString()) }
    assertEquals("123456", pad.pin, "a PIN is at most six digits")
    pad.press("back")
    assertEquals("12345", pad.pin)
    pad.press("clear")
    "4321".forEach { pad.press(it.toString()) }
    pad.submit()
    advanceUntilIdle()
    assertEquals("verify u2 4321 cashier", ops.calls.last())
    assertEquals("Ben", verified?.name)
    assertEquals("", pad.pin, "the digits are cleared once sent")
  }

  @Test
  fun aWrongPinShowsTheRoutesWordsAndClearsTheDigits() = runTest {
    val ops = FakeOps()
    val pad = PosPinPadModel(ops, this, "r1", "cashier") {}
    pad.load()
    advanceUntilIdle()
    pad.pick("u1")
    "9999".forEach { pad.press(it.toString()) }
    ops.failWith = ConsoleApiError("That PIN is not right. 4 tries left.", 401, null)
    pad.submit()
    advanceUntilIdle()
    assertEquals("That PIN is not right. 4 tries left.", pad.error)
    assertEquals("", pad.pin)
  }

  @Test
  fun aSiteWithNoPinsLetsTheLockBeClosed() = runTest {
    val ops = FakeOps().apply { roster = emptyList() }
    val pad = PosPinPadModel(ops, this, "r1", "cashier") {}
    pad.load()
    advanceUntilIdle()
    assertTrue(pad.nobodyHasAPin)
  }

  @Test
  fun aSingleMemberIsPickedForYou() = runTest {
    val ops = FakeOps().apply { roster = listOf(PosRosterMember("u1", "Ana")) }
    val pad = PosPinPadModel(ops, this, "r1", "manager") {}
    pad.load()
    advanceUntilIdle()
    assertEquals("u1", pad.memberUid)
  }
}

class PosShiftModelTest {
  private fun model(ops: FakeOps, scope: kotlinx.coroutines.CoroutineScope, assertion: () -> String? = { "a-1" }) =
    PosShiftModel(ops, scope, { "r1" }, assertion) { "key-1" }

  @Test
  fun opensWithTheStartingFloatInCentsAsTheNamedCashier() = runTest {
    val ops = FakeOps()
    val shift = model(ops, this)
    shift.open(ShiftDialog.OPEN)
    shift.submitOpen("150.00")
    advanceUntilIdle()
    assertEquals("open r1 a-1 15000", ops.calls.last())
    assertEquals("s1", shift.shift?.id)
    assertNull(shift.dialog)
    assertEquals("Shift opened", shift.notice)
  }

  @Test
  fun anEmptyFloatIsZeroAndNonsenseIsRefusedWithoutACall() = runTest {
    val ops = FakeOps()
    val shift = model(ops, this)
    shift.submitOpen("")
    advanceUntilIdle()
    assertEquals("open r1 a-1 0", ops.calls.last())
    ops.calls.clear()
    shift.open(ShiftDialog.OPEN)
    shift.submitOpen("lots")
    assertEquals("Enter the starting cash, like 150.00.", shift.error)
    assertTrue(ops.calls.isEmpty())
  }

  @Test
  fun aCashMovementNeedsAnAmountAndAReasonExceptForADrop() = runTest {
    val ops = FakeOps()
    val shift = model(ops, this)
    shift.open(ShiftDialog.CASH)
    shift.submitCash(PosCashEventType.PAID_OUT, "0", "milk")
    assertEquals("Enter an amount above zero.", shift.error)
    shift.submitCash(PosCashEventType.PAID_OUT, "12.50", " ")
    assertEquals("Say what the cash was for.", shift.error)
    assertTrue(ops.calls.isEmpty())
    shift.submitCash(PosCashEventType.DROP, "200", "")
    advanceUntilIdle()
    assertEquals("cash DROP 20000 '' key-1", ops.calls.last())
    assertEquals("Safe drop recorded", shift.notice)
  }

  @Test
  fun aRetriedCashTapIsTheSameEvent() = runTest {
    val ops = FakeOps()
    var minted = 0
    val shift = PosShiftModel(ops, this, { "r1" }, { null }) { "evt-${++minted}" }
    shift.open(ShiftDialog.CASH)
    val first = shift.eventKey
    ops.failWith = ConsoleApiError("Server hiccup", 503, null)
    shift.submitCash(PosCashEventType.PAID_IN, "5", "float top-up")
    advanceUntilIdle()
    assertEquals("Server hiccup", shift.error)
    ops.failWith = null
    shift.submitCash(PosCashEventType.PAID_IN, "5", "float top-up")
    advanceUntilIdle()
    assertEquals(listOf("cash PAID_IN 500 'float top-up' $first", "cash PAID_IN 500 'float top-up' $first"), ops.calls.filter { it.startsWith("cash") })
    shift.open(ShiftDialog.CASH)
    assertTrue(shift.eventKey != first, "a new dialog is a new event")
  }

  @Test
  fun closingShowsTheVarianceAgainstTheXReportThenFreezesTheZReport() = runTest {
    val ops = FakeOps().apply { current = PosShiftRecord("s1", shiftOf()) }
    val shift = model(ops, this)
    shift.refresh()
    advanceUntilIdle()
    assertEquals("s1", shift.shift?.id)
    shift.open(ShiftDialog.CLOSE)
    advanceUntilIdle()
    assertEquals(21_240.0, shift.report?.expectedCashCents)
    shift.submitClose("212.40", "Counted twice")
    advanceUntilIdle()
    assertEquals("close s1 21240 'Counted twice'", ops.calls.last())
    assertNotNull(shift.closed)
    assertNull(shift.shift, "the register has no open shift once it closes")
  }

  @Test
  fun aShiftTheOtherTabletOpenedIsReadAfterTheRefusal() = runTest {
    val ops = FakeOps()
    val shift = model(ops, this)
    shift.open(ShiftDialog.OPEN)
    ops.failWith = ConsoleApiError("This register already has a shift open. Close it before opening another.", 409, null)
    ops.current = PosShiftRecord("s9", shiftOf())
    shift.submitOpen("10")
    advanceUntilIdle()
    assertEquals("This register already has a shift open. Close it before opening another.", shift.error)
    ops.failWith = null
    advanceUntilIdle()
    assertEquals("current r1 a-1", ops.calls.last())
  }

  @Test
  fun printingSaysWhetherAPrinterTookTheReport() = runTest {
    val ops = FakeOps()
    val shift = model(ops, this)
    shift.print("s1")
    advanceUntilIdle()
    assertEquals("This register has no receipt printer. The report stays on screen.", shift.notice)
    ops.printed = true
    shift.print("s1")
    advanceUntilIdle()
    assertEquals("Sent to the receipt printer", shift.notice)
  }

  @Test
  fun aClosedShiftIsNotTheOpenOne() = runTest {
    val ops = FakeOps().apply { current = PosShiftRecord("s1", shiftOf(PosShiftStatus.CLOSED)) }
    val shift = model(ops, this)
    shift.refresh()
    advanceUntilIdle()
    assertNull(shift.shift)
    assertTrue(shift.loaded)
  }
}

class PosStaffPinsTest {
  @Test
  fun aMemberSetsTheirOwnPinAfterTheSamePinChecksAsTheConsole() = runTest {
    val ops = FakeOps()
    val pins = PosStaffPinsModel(ops, this)
    pins.load()
    advanceUntilIdle()
    assertEquals(false, pins.status?.hasPin)
    pins.startEdit(null)
    pins.save("12", "12")
    assertEquals("A PIN is 4 to 6 digits.", pins.error)
    pins.save("1234", "1234")
    assertEquals("Pick a PIN that is not a straight run like 1234.", pins.error)
    pins.save("4821", "4822")
    assertEquals("The two PINs do not match.", pins.error)
    assertTrue(ops.calls.none { it.startsWith("set-pin") })
    pins.save("4821", "4821")
    advanceUntilIdle()
    assertEquals("set-pin me 4821", ops.calls.single { it.startsWith("set-pin") })
    assertEquals("Your PIN is set", pins.notice)
    assertEquals(true, pins.status?.hasPin)
    assertFalse(pins.dialogOpen)
  }

  @Test
  fun aWorkspaceAdminSeesTheStaffWithPinsAndResetsOne() = runTest {
    val ops = FakeOps().apply { status = PosPinStatus(hasPin = true, isManager = true) }
    val pins = PosStaffPinsModel(ops, this)
    pins.load()
    advanceUntilIdle()
    assertEquals(2, pins.roster.size)
    pins.startEdit(pins.roster[1])
    pins.save("4821", "4821")
    advanceUntilIdle()
    assertEquals("set-pin u2 4821", ops.calls.single { it.startsWith("set-pin") })
    assertEquals("PIN reset for Ben", pins.notice)
    pins.remove(pins.roster[0])
    advanceUntilIdle()
    assertEquals("clear-pin u1", ops.calls.last { it.startsWith("clear-pin") })
  }

  @Test
  fun aMemberWhoCannotUseTheRegisterIsToldSoInTheRoutesWords() = runTest {
    val ops = FakeOps().apply { failWith = ConsoleApiError("Not permitted", 403, null) }
    val pins = PosStaffPinsModel(ops, this)
    pins.load()
    advanceUntilIdle()
    assertEquals("Not permitted", pins.refusal)
    assertNull(pins.status)
  }
}

class ConsolePosOpsApiTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val path: String, val body: JsonObject)

  private fun api(seen: MutableList<Seen>, answer: String): ConsolePosOpsApi {
    val engine = MockEngine { request ->
      seen += Seen(request.url.encodedPath, Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject)
      respond(answer, HttpStatusCode.OK, json)
    }
    return ConsolePosOpsApi(ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1), "h1")
  }

  private val shiftJson = """{"shift":{"id":"s1","hostId":"h1","registerId":"r1","status":"open","openedBy":"u1","openedAtMs":1700000000000,"openingFloatCents":15000,"cashEvents":[{"id":"e1","type":"drop","amountCents":2000,"reason":"","by":"u1","atMs":1700000100000}]}}"""

  @Test
  fun everyShiftCallNamesTheSiteTheRegisterAndTheCashier() = runTest {
    val seen = mutableListOf<Seen>()
    val api = api(seen, shiftJson)
    val opened = api.openShift("r1", "assert-1", 15_000)
    assertEquals("/api/commerce/pos-shift", seen.single().path)
    val body = seen.single().body
    assertEquals("open", body["action"]!!.jsonPrimitive.content)
    assertEquals("h1", body["hostId"]!!.jsonPrimitive.content)
    assertEquals("r1", body["registerId"]!!.jsonPrimitive.content)
    assertEquals("assert-1", body["cashierAssertion"]!!.jsonPrimitive.content)
    assertEquals(15_000L, body["openingFloatCents"]!!.jsonPrimitive.content.toLong())
    assertEquals("s1", opened.id)
    assertEquals(1, opened.shift.cashEvents.size)
    assertEquals(PosCashEventType.DROP, opened.shift.cashEvents.single().type)
  }

  @Test
  fun noCashierMeansNoAssertionIsSent() = runTest {
    val seen = mutableListOf<Seen>()
    api(seen, """{"shift":null}""").currentShift("r1", null)
    assertFalse("cashierAssertion" in seen.single().body)
    assertEquals("current", seen.single().body["action"]!!.jsonPrimitive.content)
  }

  @Test
  fun aCloseSendsTheShiftTheCountAndTheNote() = runTest {
    val seen = mutableListOf<Seen>()
    val answer = """{"shift":{"id":"s1","hostId":"h1","registerId":"r1","status":"closed","openedBy":"u1","openedAtMs":1,"openingFloatCents":0,"cashEvents":[],"countedCashCents":21240,"varianceCents":0},"report":{"orderCount":1,"grossSalesCents":100,"discountsCents":0,"taxCents":0,"tipsCents":0,"salesByTender":{"cash":100},"refundCount":0,"refundsCents":0,"refundsByTender":{},"netSalesCents":100,"openingFloatCents":0,"cashSalesCents":100,"paidInCents":0,"paidOutCents":0,"dropsCents":0,"cashRefundsCents":0,"expectedCashCents":100}}"""
    val closed = api(seen, answer).closeShift("r1", "a", "s1", 21_240, "Counted twice")
    val body = seen.single().body
    assertEquals("close", body["action"]!!.jsonPrimitive.content)
    assertEquals("s1", body["shiftId"]!!.jsonPrimitive.content)
    assertEquals(21_240L, body["countedCashCents"]!!.jsonPrimitive.content.toLong())
    assertEquals("Counted twice", body["note"]!!.jsonPrimitive.content)
    assertEquals(PosShiftStatus.CLOSED, closed.shift.shift.status)
    assertEquals(100.0, closed.report?.expectedCashCents)
  }

  @Test
  fun aPinVerifyAsksForThePurposeAndReadsTheAssertion() = runTest {
    val seen = mutableListOf<Seen>()
    val api = api(seen, """{"assertion":"sig","expiresAtMs":1700000900000,"memberUid":"u2","name":"Ben","purpose":"cashier"}""")
    val assertion = api.verifyPin("r1", "u2", "4321", "cashier")
    assertEquals("/api/commerce/pos-staff-pin", seen.single().path)
    assertEquals("verify", seen.single().body["action"]!!.jsonPrimitive.content)
    assertEquals("4321", seen.single().body["pin"]!!.jsonPrimitive.content)
    assertEquals("Ben", assertion.name)
    assertEquals(1_700_000_900_000L, assertion.expiresAtMs)
  }

  @Test
  fun theContextCarriesTheRegisterRules() {
    val context = readPosContext(Json.parseToJsonElement("""{"settings":{},"terminal":{},"ops":{"requireOpenShift":true,"refundLimitCents":5000,"autoLockMinutes":15,"receiptAddress":"1 Main St","returnPolicy":"30 days"}}"""))
    assertEquals(PosOpsSettings(true, 5000, 15, "1 Main St", "30 days"), context.ops)
    assertEquals(PosOpsSettings(), readPosContext(Json.parseToJsonElement("{}")).ops, "an older console names no rules")
  }
}
