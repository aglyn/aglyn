package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PosCashEventType
import com.aglyn.contracts.PosShiftReport
import com.aglyn.contracts.PosShiftStatus
import com.aglyn.contracts.posCashVarianceCents
import com.aglyn.contracts.posPinProblem
import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Refresh a cashier assertion this long before it expires (the console's margin). */
internal const val CASHIER_REFRESH_MARGIN_MS = 3 * 60 * 1000L

/** How often the register checks the idle clock and the expiry. */
internal const val CASHIER_TICK_MS = 15 * 1000L

/**
 * Who is at the register. Holds the cashier a PIN switched in, refreshes
 * their assertion while they keep working (the server re-checks their role
 * on every refresh), and LOCKS the register after the site's idle minutes,
 * dropping the assertion so the next person must enter their own PIN. An
 * expired assertion the refresh could not renew drops back to the signed-in
 * member rather than ringing sales under a name the server would refuse.
 */
class PosCashier(
  private val api: PosOpsApi,
  private val registerId: () -> String?,
  private val autoLockMinutes: () -> Int,
  private val now: () -> Long = ::nowMs,
) {
  /** The member a PIN switched in, or null for whoever is signed in. */
  var cashier by mutableStateOf<PosStaffAssertion?>(null)
    private set

  /** The register is locked and waits for a PIN. */
  var locked by mutableStateOf(false)
    private set

  /** The assertion every register call carries, or null. */
  val assertion: String? get() = cashier?.assertion

  private var lastActivity = now()
  private var refreshing = false

  /** A tap or a key: the register is in use. */
  fun touch() {
    lastActivity = now()
  }

  fun switchTo(next: PosStaffAssertion) {
    touch()
    cashier = next
    locked = false
  }

  /** Back to the signed-in member. */
  fun signOut() {
    cashier = null
  }

  fun lock() {
    cashier = null
    locked = true
  }

  /** Lifts a lock without a PIN: only for a site where nobody has one. */
  fun unlock() {
    touch()
    locked = false
  }

  /** A different register is a different till: nobody carries over. */
  fun reset() {
    cashier = null
    locked = false
    touch()
  }

  /** One beat of the clock: locks an idle register, renews a working cashier's assertion. */
  suspend fun tick() {
    val time = now()
    val minutes = autoLockMinutes()
    if (minutes > 0 && !locked && time - lastActivity > minutes * 60_000L) {
      cashier = null
      locked = true
      return
    }
    val current = cashier ?: return
    if (time >= current.expiresAtMs) {
      cashier = null
      return
    }
    if (current.expiresAtMs - time > CASHIER_REFRESH_MARGIN_MS || refreshing) return
    // Only a cashier who is still working earns a fresh assertion.
    if (time - lastActivity > CASHIER_REFRESH_MARGIN_MS) return
    val register = registerId() ?: return
    refreshing = true
    try {
      val fresh = api.refresh(register, current.assertion)
      if (fresh != null && cashier?.memberUid == current.memberUid) {
        cashier = current.copy(assertion = fresh.assertion, expiresAtMs = fresh.expiresAtMs)
      }
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      if (failure is ConsoleApiError && (failure.status == 401 || failure.status == 403)) cashier = null
    } finally {
      refreshing = false
    }
  }
}

/** The PIN pad for one prompt: the roster, the pick, the digits. */
class PosPinPadModel(
  private val api: PosOpsApi,
  private val scope: CoroutineScope,
  private val registerId: String,
  val purpose: String,
  private val onVerified: (PosStaffAssertion) -> Unit,
) {
  var members by mutableStateOf<List<PosRosterMember>?>(null)
    private set
  var memberUid by mutableStateOf("")
    private set
  var pin by mutableStateOf("")
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var busy by mutableStateOf(false)
    private set

  /** Nobody on the site has a PIN: a lock nobody can open is no lock, so the pad may close. */
  val nobodyHasAPin: Boolean get() = members?.isEmpty() == true && error == null

  fun load() {
    scope.launch {
      try {
        val list = api.roster()
        members = list
        if (list.size == 1) memberUid = list.first().uid
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        members = emptyList()
        error = (failure as? ConsoleApiError)?.message ?: "Could not load the staff list."
      }
    }
  }

  fun pick(uid: String) {
    memberUid = uid
    error = null
  }

  fun press(key: String) {
    when (key) {
      "clear" -> pin = ""
      "back" -> pin = pin.dropLast(1)
      else -> if (key.length == 1 && key[0].isDigit() && pin.length < 6) pin += key
    }
  }

  val canSubmit: Boolean get() = !busy && memberUid.isNotEmpty() && pin.length >= 4

  fun submit() {
    if (!canSubmit) return
    val value = pin
    busy = true
    error = null
    scope.launch {
      try {
        val assertion = api.verifyPin(registerId, memberUid, value, purpose)
        pin = ""
        onVerified(assertion)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        pin = ""
        error = (failure as? ConsoleApiError)?.message ?: "That PIN did not work."
      } finally {
        busy = false
      }
    }
  }
}

/** The dialogs the shift opens, one at a time. */
enum class ShiftDialog { OPEN, CASH, REPORT, CLOSE }

/**
 * The register's shift: open it with a starting float, record cash paid in,
 * paid out and dropped to the safe, read the X report at any time, and close
 * with a count; the Z report freezes the figures and the variance. The
 * server decides every figure; this reads the shift it names.
 */
class PosShiftModel(
  private val api: PosOpsApi,
  private val scope: CoroutineScope,
  private val registerId: () -> String?,
  private val assertion: () -> String?,
  private val mintKey: () -> String = { newAttemptKey("pos-shift") },
) {
  /** The register's open shift; null while none is open (or before it is read). */
  var shift by mutableStateOf<PosShiftRecord?>(null)
    private set
  var loaded by mutableStateOf(false)
    private set
  var dialog by mutableStateOf<ShiftDialog?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var notice by mutableStateOf<String?>(null)

  /** The X report while its dialog is open. */
  var report by mutableStateOf<PosShiftReport?>(null)
    private set

  /** The shift a close just froze: the Z report. */
  var closed by mutableStateOf<PosClosedShift?>(null)
    private set

  /** One id per Cash in/out dialog, so a retried tap records one event. */
  var eventKey: String = mintKey()
    private set

  fun refresh() {
    val register = registerId() ?: return
    scope.launch {
      try {
        shift = api.currentShift(register, assertion())?.takeIf { it.shift.status == PosShiftStatus.OPEN }
        loaded = true
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        loaded = true
      }
    }
  }

  fun open(next: ShiftDialog) {
    dialog = next
    error = null
    report = null
    closed = null
    if (next == ShiftDialog.CASH) eventKey = mintKey()
    if (next == ShiftDialog.REPORT || next == ShiftDialog.CLOSE) loadReport()
  }

  fun dismiss() {
    if (busy) return
    dialog = null
    error = null
    report = null
    closed = null
  }

  private fun loadReport() {
    val register = registerId() ?: return
    scope.launch {
      try {
        val answer = api.xReport(register, assertion())
        shift = answer.shift
        report = answer.report
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = describe(failure, "Could not read the shift.")
      }
    }
  }

  private fun describe(failure: Throwable, fallback: String) = (failure as? ConsoleApiError)?.message ?: fallback

  /** Runs one shift call; keeps the dialog open with the reason when it fails. */
  private fun run(fallback: String, success: String?, call: suspend (register: String) -> Unit) {
    if (busy) return
    val register = registerId() ?: return
    busy = true
    error = null
    scope.launch {
      try {
        call(register)
        if (success != null) notice = success
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = describe(failure, fallback)
        // A shift another tablet opened or closed: read the register's own.
        if ((failure as? ConsoleApiError)?.status == 409) refresh()
      } finally {
        busy = false
      }
    }
  }

  fun submitOpen(amountText: String) {
    val cents = if (amountText.isBlank()) 0L else centsFromText(amountText) ?: return fail("Enter the starting cash, like 150.00.")
    run("Could not open the shift.", "Shift opened") { register ->
      shift = api.openShift(register, assertion(), cents)
      dialog = null
    }
  }

  fun submitCash(type: PosCashEventType, amountText: String, reason: String) {
    val cents = centsFromText(amountText)?.takeIf { it > 0 } ?: return fail("Enter an amount above zero.")
    if (type != PosCashEventType.DROP && reason.isBlank()) return fail("Say what the cash was for.")
    val label = cashLabel(type)
    run("Could not record the cash.", "$label recorded") { register ->
      shift = api.cashEvent(register, assertion(), type, cents, reason, eventKey)
      dialog = null
    }
  }

  fun submitClose(countedText: String, note: String) {
    val counted = centsFromText(countedText) ?: return fail("Enter the cash you counted, like 212.40.")
    val current = shift ?: return fail("No shift is open on this register.")
    run("Could not close the shift.", null) { register ->
      val answer = api.closeShift(register, assertion(), current.id, counted, note)
      closed = answer
      shift = null
    }
  }

  /** Sends the X report (or the frozen Z report) to the register's receipt printer. */
  fun print(shiftId: String?) {
    run("Could not print the report.", null) { register ->
      val printed = api.printReport(register, assertion(), shiftId, mintKey())
      notice = if (printed) "Sent to the receipt printer" else "This register has no receipt printer. The report stays on screen."
    }
  }

  private fun fail(message: String) {
    error = message
  }

  private fun cashLabel(type: PosCashEventType): String = Contracts.posCashEventLabels[type.raw] ?: type.raw
}

/**
 * Staff PINs: each member who works the register sets their own 4 to 6 digit
 * PIN, which switches the cashier on a shared tablet without signing anybody
 * out and never grants more than that member's role. A workspace admin can
 * reset or remove anyone's, which also lifts a lockout.
 */
class PosStaffPinsModel(private val api: PosOpsApi, private val scope: CoroutineScope) {
  var status by mutableStateOf<PosPinStatus?>(null)
    private set
  var roster by mutableStateOf<List<PosRosterMember>>(emptyList())
    private set
  var refusal by mutableStateOf<String?>(null)
    private set

  /** Whose PIN the dialog sets: null is the signed-in member's own. */
  var editing by mutableStateOf<PosRosterMember?>(null)
    private set
  var dialogOpen by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var notice by mutableStateOf<String?>(null)

  fun load() {
    scope.launch {
      try {
        val current = api.pinStatus()
        status = current
        refusal = null
        roster = if (current.isManager) runCatching { api.roster() }.getOrDefault(emptyList()) else emptyList()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        refusal = (failure as? ConsoleApiError)?.message ?: "Could not read your PIN."
      }
    }
  }

  fun startEdit(member: PosRosterMember?) {
    editing = member
    dialogOpen = true
    error = null
  }

  fun closeDialog() {
    if (busy) return
    dialogOpen = false
    editing = null
    error = null
  }

  fun save(pin: String, again: String) {
    if (busy) return
    posPinProblem(pin)?.let { error = it; return }
    if (pin != again) {
      error = "The two PINs do not match."
      return
    }
    busy = true
    error = null
    val target = editing
    scope.launch {
      try {
        api.setPin(target?.uid, pin)
        notice = if (target != null) "PIN reset for ${target.name}" else "Your PIN is set"
        dialogOpen = false
        editing = null
        load()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.message ?: "Could not save the PIN."
      } finally {
        busy = false
      }
    }
  }

  fun remove(member: PosRosterMember?) {
    if (busy) return
    busy = true
    scope.launch {
      try {
        api.clearPin(member?.uid)
        notice = if (member != null) "${member.name}'s PIN is removed" else "Your PIN is removed"
        load()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        notice = (failure as? ConsoleApiError)?.message ?: "Could not remove the PIN."
      } finally {
        busy = false
      }
    }
  }
}

/** Counted minus expected, in whole cents: positive is over, negative is short. */
fun shiftVarianceCents(countedCents: Long, expectedCents: Double): Long = posCashVarianceCents(countedCents.toDouble(), expectedCents)
