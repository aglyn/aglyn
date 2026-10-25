package com.aglyn.contracts

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// Check-in at the window (AGL-4043), ported once from libs/plugins/commerce/src/lib/model/commerce-check-in.ts: the labels
// the register prints for a person, a wristband and a time, and the wristband rule the route applies.
// function-cases.generated.json holds the answers the TypeScript gives, and FunctionCasesTest replays every one. The record
// (`HostCheckIn`), the customer row (`CheckInCustomer`) and the limits are generated contracts.

/** One check-in as the route answers it: the stored record and its document id. */
data class CheckInRow(val id: String, val record: HostCheckIn) {
  val checkedIn: Boolean get() = record.status == CheckInStatus.CHECKED_IN

  companion object {
    /** A row of the route's JSON (`{ id, ...record }`); null without an id. */
    fun parse(json: JsonElement?): CheckInRow? {
      val id = ((json as? JsonObject)?.get("id") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: return null
      val record = runCatching { ContractJsonFormat.decodeFromJsonElement(HostCheckIn.serializer(), json) }.getOrNull() ?: return null
      return CheckInRow(id, record)
    }
  }
}

/** One person's line, as the list and the spreadsheet name it: "Day pass · Adult (2 of 3)". */
fun checkInItemLabel(itemName: String, variantLabel: String?, unitIndex: Int, unitCount: Int): String {
  val item = variantLabel?.takeIf { it.isNotEmpty() }?.let { "$itemName · $it" } ?: itemName
  return if (unitCount > 1) "$item (${unitIndex + 1} of $unitCount)" else item
}

fun checkInItemLabel(row: HostCheckIn): String =
  checkInItemLabel(row.itemName.orEmpty(), row.variantLabel, row.unitIndex?.toInt() ?: 0, row.unitCount?.toInt() ?: 1)

/** A wristband as one line: "Blue #214". */
fun describeWristband(wristband: CheckInWristband?): String {
  if (wristband == null) return ""
  val number = wristband.number?.takeIf { it.isNotEmpty() }?.let { "#" + it.removePrefix("#") }
  return listOfNotNull(wristband.color?.takeIf { it.isNotEmpty() }, number).joinToString(" ")
}

/**
 * A time on the site's clock: "9:14 AM". An unknown zone reads in [fallbackZone] (null is the device's, as the console falls
 * back to the browser's).
 */
fun checkInTimeLabel(atMs: Double?, timeZone: String, fallbackZone: String? = null): String {
  if (atMs == null || atMs == 0.0) return ""
  val zone = if (timeZone == "UTC" || timeZone in knownTimeZones()) timeZone else fallbackZone
  val parts = localParts(atMs.toLong(), zone)
  val hour = if (parts.hour % 12 == 0) 12 else parts.hour % 12
  return "$hour:${parts.minute.toString().padStart(2, '0')} ${if (parts.hour < 12) "AM" else "PM"}"
}

/** "Already checked in at 9:14 AM by Sam". */
fun alreadyCheckedInLabel(checkedInAtMs: Double?, checkedInByName: String?, timeZone: String, fallbackZone: String? = null): String {
  val at = checkInTimeLabel(checkedInAtMs, timeZone, fallbackZone)
  val by = checkedInByName?.takeIf { it.isNotEmpty() }?.let { " by $it" }.orEmpty()
  return "Already checked in${if (at.isEmpty()) "" else " at $at"}$by"
}

/** What the row says under a person checked in: "Checked in at 9:14 AM by Sam · Blue #214", as the console's dialog says it. */
fun checkedInLine(row: HostCheckIn, timeZone: String, fallbackZone: String? = null): String {
  val at = "Checked in at ${checkInTimeLabel(row.checkedInAtMs, timeZone, fallbackZone)}" +
    row.checkedInByName?.takeIf { it.isNotEmpty() }?.let { " by $it" }.orEmpty()
  return listOf(at, describeWristband(row.wristband)).filter { it.isNotEmpty() }.joinToString(" · ")
}

/** A wristband as typed, made safe, as the route checks it. */
sealed interface WristbandCheck {
  data class Ok(val wristband: CheckInWristband?) : WristbandCheck
  data class Refused(val error: String) : WristbandCheck
}

private val WRISTBAND_NUMBER = Regex("^[A-Za-z0-9#-]+$")
private val WRISTBAND_COLOR = Regex("^[\\p{L} -]+$")

/** A number (letters, digits, `#`, a dash) and a color word, each optional; `Ok(null)` with neither. */
fun normalizeWristband(number: String?, color: String?): WristbandCheck {
  val max = Contracts.checkInWristbandMax.toInt()
  val n = number.orEmpty().trim()
  val c = color.orEmpty().trim()
  if (n.length > max || c.length > max) return WristbandCheck.Refused("A wristband number or color is $max characters at most.")
  if (n.isNotEmpty() && !WRISTBAND_NUMBER.matches(n)) return WristbandCheck.Refused("A wristband number is letters, digits and dashes.")
  if (c.isNotEmpty() && !WRISTBAND_COLOR.matches(c)) return WristbandCheck.Refused("A wristband color is a word, such as Blue.")
  if (n.isEmpty() && c.isEmpty()) return WristbandCheck.Ok(null)
  return WristbandCheck.Ok(CheckInWristband(color = c.ifEmpty { null }, number = n.ifEmpty { null }))
}

// The product setting (commerce-check-in-product.ts).

/**
 * People one item admits, from a stored or typed value: JavaScript's `Math.round(Number(value))`, from 1 to
 * `CHECK_IN_MAX_HEADCOUNT`, and 1 for anything else (blank too).
 */
fun checkInHeadcount(value: Any?): Int {
  val number = when (value) {
    is Boolean -> if (value) 1.0 else 0.0
    is Number -> value.toDouble()
    is String -> value.trim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
    else -> Double.NaN
  }
  val count = kotlin.math.floor(number + 0.5)
  if (!count.isFinite() || count < 1) return 1
  return kotlin.math.min(count, Contracts.checkInMaxHeadcount.toDouble()).toInt()
}

/** A stored check-in setting made safe, or null when it says nothing (`enabled` not a boolean). */
fun normalizeProductCheckIn(value: Any?): ProductCheckIn? {
  val raw = value as? Map<*, *> ?: return null
  val enabled = raw["enabled"] as? Boolean ?: return null
  return if (enabled) ProductCheckIn(enabled = true, headcount = checkInHeadcount(raw["headcount"]).toLong()) else ProductCheckIn(enabled = false)
}
