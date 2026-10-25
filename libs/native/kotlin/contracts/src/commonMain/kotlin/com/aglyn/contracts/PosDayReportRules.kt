package com.aglyn.contracts

import kotlin.math.floor

/*
 * DAY AND EVENT TOTALS (AGL-4037), the console's commerce-pos-day-report.ts:
 * the range label, the amounts and the spreadsheet, replayed against the
 * console's own answers in function-cases.generated.json. The Apple kit's
 * `PosDayReportRules.swift`.
 */

/** Minor units as a spreadsheet number in the store's currency: `12.34`, `1200` for yen (`posDayAmount`). */
fun posDayAmount(cents: Double?, currency: String): String {
  if (cents == null) return ""
  val digits = currencyMinorDigits(currency)
  val rounded = floor(cents + 0.5).toLong()
  if (digits == 0) return rounded.toString()
  var scale = 1L
  repeat(digits) { scale *= 10 }
  val negative = rounded < 0
  val whole = kotlin.math.abs(rounded) / scale
  val rest = (kotlin.math.abs(rounded) % scale).toString().padStart(digits, '0')
  return (if (negative) "-" else "") + "$whole.$rest"
}

/** The range as a reader says it: `2026-10-24` or `2026-10-24 to 2026-10-26` (`posDayRangeLabel`). */
fun posDayRangeLabel(from: String, to: String): String = if (from == to) from else "$from to $to"

/** Whether the range had nothing to report: no sale, no return, no shift (`posDayReportIsEmpty`). */
fun posDayReportIsEmpty(report: PosDayReport): Boolean =
  report.totals.orderCount == 0.0 && report.totals.refundCount == 0.0 && report.shifts.isEmpty()

private val PLAIN_NUMBER = Regex("^-?\\d+(\\.\\d+)?$")

/** One spreadsheet cell, quoted when it needs to be and never read as a formula (`posCsvCell`). */
fun posCsvCell(value: String): String {
  var cell = value
  if (cell.isNotEmpty() && cell[0] in "=+-@\t\r" && !PLAIN_NUMBER.matches(cell)) cell = "'$cell"
  return if (cell.any { it == ',' || it == '"' || it == '\r' || it == '\n' }) "\"" + cell.replace("\"", "\"\"") + "\"" else cell
}

/** `new Date(ms).toISOString()`: `2026-10-24T13:00:00.000Z`, or `` for none. */
private fun isoInstant(ms: Double?): String {
  if (ms == null || ms == 0.0) return ""
  val total = ms.toLong()
  val millis = total.mod(1000L)
  val seconds = total.floorDiv(1000L)
  val days = seconds.floorDiv(86_400L)
  val secondOfDay = seconds.mod(86_400L)
  // Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
  val z = days + 719_468
  val era = z.floorDiv(146_097L)
  val doe = z - era * 146_097
  val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val day = doy - (153 * mp + 2) / 5 + 1
  val month = if (mp < 10) mp + 3 else mp - 9
  val year = yoe + era * 400 + (if (month <= 2) 1 else 0)
  fun two(value: Long) = value.toString().padStart(2, '0')
  return "${year.toString().padStart(4, '0')}-${two(month)}-${two(day)}T${two(secondOfDay / 3600)}:${two(secondOfDay % 3600 / 60)}:${two(secondOfDay % 60)}.${millis.toString().padStart(3, '0')}Z"
}

private fun count(value: Double) = value.toLong().toString()

/** The report as one spreadsheet, block by block, as the console exports it (`posDayReportCsv`). */
fun posDayReportCsv(report: PosDayReport): String {
  val money = { cents: Double? -> posDayAmount(cents, report.currency) }
  fun salesRow(section: String, name: String, orders: Double, gross: Double, discounts: Double, tax: Double, tips: Double, refunds: Double, refunded: Double, net: Double) =
    listOf(section, name, count(orders), money(gross), money(discounts), money(tax), money(tips), count(refunds), money(refunded), money(net))
  val t = report.totals
  val heading = buildList {
    add(listOf("Report", "Day totals"))
    add(listOf("Days", posDayRangeLabel(report.from, report.to)))
    add(listOf("Time zone", report.timeZone))
    add(listOf("Currency", report.currency.uppercase()))
    if (report.truncated == true) add(listOf("Note", "More activity than one report reads; the figures are partial."))
  }
  val sales = buildList {
    add(listOf("Section", "Name", "Orders", "Gross sales", "Discounts", "Tax", "Tips", "Refunds", "Refunded", "Net sales"))
    add(salesRow("Total", "Every register", t.orderCount, t.grossSalesCents, t.discountsCents, t.taxCents, t.tipsCents, t.refundCount, t.refundsCents, t.netSalesCents))
    report.byRegister.forEach { add(salesRow("Register", it.name, it.orderCount, it.grossSalesCents, it.discountsCents, it.taxCents, it.tipsCents, it.refundCount, it.refundsCents, it.netSalesCents)) }
    report.byCashier.forEach { add(salesRow("Cashier", it.name, it.orderCount, it.grossSalesCents, it.discountsCents, it.taxCents, it.tipsCents, it.refundCount, it.refundsCents, it.netSalesCents)) }
  }
  val tenders = listOf(listOf("Tender", "Sales", "Refunds", "Net")) +
    report.byTender.map { listOf(it.label, money(it.salesCents), money(it.refundsCents), money(it.netCents)) }
  val shifts = listOf(
    listOf("Shift", "Register", "Status", "Opened", "Opened by", "Closed", "Closed by", "Starting cash", "Net sales", "Expected cash", "Counted cash", "Variance"),
  ) + report.shifts.map {
    listOf(
      it.shiftId, it.registerName, if (it.status == PosDayShiftRowStatus.OPEN) "Open" else "Closed", isoInstant(it.openedAtMs), it.openedByName,
      isoInstant(it.closedAtMs), it.closedByName.orEmpty(), money(it.openingFloatCents), money(it.netSalesCents), money(it.expectedCashCents),
      money(it.countedCashCents), money(it.varianceCents),
    )
  }
  val c = report.cash
  val drawers = listOf(
    listOf("Cash drawers", "Amount"),
    listOf("Starting cash", money(c.openingFloatCents)),
    listOf("Cash sales", money(c.cashSalesCents)),
    listOf("Paid in", money(c.paidInCents)),
    listOf("Paid out", money(c.paidOutCents)),
    listOf("Safe drops", money(c.dropsCents)),
    listOf("Cash refunds", money(c.cashRefundsCents)),
    listOf("Expected in closed drawers", money(c.expectedCashCents)),
    listOf("Counted in closed drawers", money(c.countedCashCents)),
    listOf("Variance", money(c.varianceCents)),
    listOf("Expected in open drawers", money(c.openExpectedCashCents)),
  )
  return listOf(heading, sales, tenders, shifts, drawers)
    .joinToString("\r\n\r\n") { rows -> rows.joinToString("\r\n") { row -> row.joinToString(",", transform = ::posCsvCell) } }
}
