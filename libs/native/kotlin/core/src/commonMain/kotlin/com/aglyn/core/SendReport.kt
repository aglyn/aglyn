// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

/*
 * A send's rates and its link table (`send-report.ts` in the shared email-campaigns lib): a campaign's report and a
 * sequence's Results read them alike, so they live here rather than in either plugin. Replayed from the console's own
 * cases (`sendLinkReport`); the Swift kit's SendReport.swift holds the same.
 */

/** A rate and the denominator it was taken over (`SendRate`). */
data class SendRate(val value: Double, val numerator: Double, val denominator: Double, val denominatorLabel: String)

/** `sendRate`: numerator over denominator, or null when there is no positive denominator to take it over. */
fun sendRate(numerator: Number?, denominator: Number?, label: String): SendRate? {
  val top = numerator?.toDouble() ?: 0.0
  val bottom = denominator?.toDouble() ?: 0.0
  if (!top.isFinite() || !bottom.isFinite() || bottom <= 0) return null
  return SendRate(top / bottom, top, bottom, label)
}

/** One destination of the link table. */
data class LinkRow(val url: String, val clicks: Long, val share: SendRate?)

/** The link table (`SendLinkReport`). */
data class LinkReport(val rows: List<LinkRow>, val attributedClicks: Long, val overflowClicks: Long, val unattributedClicks: Long, val truncated: Boolean)

/** `sendLinkReport`: a stored link rollup as the table reads it, most clicked first. */
@Suppress("UNCHECKED_CAST")
fun sendLinkReport(rollup: Map<String, Any?>?): LinkReport {
  val entries = (rollup?.get("links") as? Map<String, Any?>).orEmpty().values.mapNotNull { raw ->
    val entry = raw as? Map<String, Any?> ?: return@mapNotNull null
    val url = entry["url"] as? String ?: ""
    val clicks = (entry["clicks"] as? Number)?.toLong() ?: 0L
    if (url.isEmpty()) null else url to clicks
  }
  val attributed = entries.sumOf { it.second }
  val rows = entries.sortedWith(compareByDescending<Pair<String, Long>> { it.second }.thenBy { it.first })
    .map { (url, clicks) -> LinkRow(url, clicks, sendRate(clicks, attributed, "link clicks counted")) }
  val overflow = (rollup?.get("overflowClicks") as? Number)?.toLong() ?: 0L
  return LinkReport(rows, attributed, overflow, (rollup?.get("unattributedClicks") as? Number)?.toLong() ?: 0L, entries.size >= 50 || overflow > 0)
}

/** A rate as the reports print it, `12.5%`, or the em dash for a rate that was not taken. */
fun percent(rate: SendRate?): String = rate?.let { r -> "${(kotlin.math.round(r.value * 1000) / 10.0)}%" } ?: "—"

/** A whole number as the reports print one, `1,234` (`toLocaleString` in the console's en-US). */
fun grouped(value: Long): String = value.toString().reversed().chunked(3).joinToString(",").reversed().replace("-,", "-")
