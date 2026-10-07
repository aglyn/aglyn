package com.aglyn.core

import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/** Now, in epoch milliseconds. */
@OptIn(ExperimentalTime::class)
fun nowMillis(): Long = Clock.System.now().toEpochMilliseconds()

/**
 * How long ago [thenMillis] was, in the short words an activity list uses:
 * `Just now`, `12 min ago`, `3 hr ago`, `Yesterday`, `4 days ago`, `2 wk ago`,
 * `5 mo ago`, `2 yr ago`. A time in the future reads as `Just now`.
 */
fun relativeTime(thenMillis: Long, nowMillis: Long): String {
  val minutes = (nowMillis - thenMillis) / 60_000
  val hours = minutes / 60
  val days = hours / 24
  return when {
    minutes < 1 -> "Just now"
    minutes < 60 -> "$minutes min ago"
    hours < 24 -> "$hours hr ago"
    days < 2 -> "Yesterday"
    days < 7 -> "$days days ago"
    days < 30 -> "${days / 7} wk ago"
    days < 365 -> "${days / 30} mo ago"
    else -> "${days / 365} yr ago"
  }
}
