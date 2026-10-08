package com.aglyn.contracts

import kotlin.math.floor

/*
 * The Analytics page's figures (`analytics-summary.ts`,
 * `screen-analytics-aggregate.ts`), ported once and held to the console's
 * answers by the function cases. Map keys are read in Firestore's order
 * (sorted), which is the order the console's reads hand them out in, so a
 * tie breaks the same way on every platform.
 */

private fun jsRound(value: Double): Long = floor(value + 0.5).toLong()

/** The change against the window before, to one decimal; null when there was nothing before. */
fun trafficDeltaPct(current: Double, prior: Double): Double? {
  if (prior == 0.0) return null
  return jsRound((current - prior) / prior * 1000) / 10.0
}

/** The device split, largest first, in whole percents. */
fun deviceSplit(devices: Map<String, Double>): List<DeviceSplitEntry> {
  val entries = devices.entries.sortedBy { it.key }.filter { it.value.isFinite() && it.value > 0 }
  val sum = entries.sumOf { it.value }
  if (sum == 0.0) return emptyList()
  return entries.sortedByDescending { it.value }.map {
    DeviceSplitEntry(count = it.value.toLong(), device = it.key, percent = jsRound(it.value / sum * 100))
  }
}

/** `Mobile / Desktop`. */
fun deviceSplitLabel(split: List<DeviceSplitEntry>): String =
  split.joinToString(" / ") { entry -> entry.device.replaceFirstChar { it.uppercaseChar() } }

/** `61% / 39%`. */
fun deviceSplitValue(split: List<DeviceSplitEntry>): String = split.joinToString(" / ") { "${it.percent}%" }

/** One field's counts summed over days (oldest first), largest first. */
fun rollUp(days: List<Map<String, Double>>): List<Pair<String, Double>> {
  val totals = linkedMapOf<String, Double>()
  for (day in days) for ((key, count) in day.entries.sortedBy { it.key }) totals[key] = (totals[key] ?: 0.0) + count
  return totals.entries.sortedByDescending { it.value }.map { it.key to it.value }
}

/** Dwell time as `4s`, `1m 05s` or `1h 02m`. */
fun formatDwell(ms: Double): String {
  val totalSeconds = maxOf(0L, jsRound(ms / 1000))
  val minutes = totalSeconds / 60
  val seconds = totalSeconds % 60
  if (minutes == 0L) return "${seconds}s"
  if (minutes < 60) return "${minutes}m ${seconds.toString().padStart(2, '0')}s"
  return "${minutes / 60}h ${(minutes % 60).toString().padStart(2, '0')}m"
}

private fun Any?.jsNumberOrNaN(): Double = when (this) {
  null -> 0.0
  is Number -> toDouble()
  is String -> trim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
  is Boolean -> if (this) 1.0 else 0.0
  else -> Double.NaN
}

/** The per-page table: screen day documents (their fields) folded per page, most viewed first. */
fun aggregateScreenDays(docs: List<Map<String, Any?>>): List<ScreenTrafficRow> {
  data class Acc(val screenId: String, var total: Double = 0.0, val devices: LinkedHashMap<String, Double> = linkedMapOf(), val referrers: LinkedHashMap<String, Double> = linkedMapOf())
  val byScreen = linkedMapOf<String, Acc>()
  for (data in docs) {
    val screenId = data["screenId"] as? String ?: ""
    val total = data["total"].jsNumberOrNaN()
    if (screenId.isEmpty() || !total.isFinite() || total <= 0) continue
    val row = byScreen.getOrPut(screenId) { Acc(screenId) }
    row.total += total
    for (field in listOf("devices", "referrers")) {
      val target = if (field == "devices") row.devices else row.referrers
      val map = (data[field] as? Map<*, *>).orEmpty().entries.sortedBy { it.key.toString() }
      for ((key, count) in map) {
        val n = count.jsNumberOrNaN()
        if (n.isFinite() && n > 0) target[key.toString()] = (target[key.toString()] ?: 0.0) + n
      }
    }
  }
  return byScreen.values.sortedByDescending { it.total }.map {
    ScreenTrafficRow(devices = it.devices, referrers = it.referrers, screenId = it.screenId, total = it.total.toLong())
  }
}

private fun topOf(map: Map<String, Double>): String = map.entries.sortedBy { it.key }.sortedByDescending { it.value }.firstOrNull()?.key ?: ""

/** The device a page was viewed on most, or empty. */
fun topDevice(row: ScreenTrafficRow): String = topOf(row.devices)

/** The site that sent a page the most visitors, or empty. */
fun topReferrer(row: ScreenTrafficRow): String = topOf(row.referrers)

/** A UTC day id, `YYYY-MM-DD`: how `hosts/{id}/analytics/{day}` is keyed. */
fun analyticsDayId(atMs: Long): String = localParts(atMs, "UTC").dayKey

/** The ids of the [days] UTC days ending today, newest first (`recentDayIds`). */
fun recentDayIds(nowMs: Long, days: Int): List<String> = (0 until days).map { analyticsDayId(nowMs - it * 86_400_000L) }
