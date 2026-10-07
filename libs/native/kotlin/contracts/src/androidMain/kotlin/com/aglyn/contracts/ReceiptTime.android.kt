package com.aglyn.contracts

import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val RECEIPT_TIME = DateTimeFormatter.ofPattern("MMM d, yyyy, h:mm a", Locale.US)

actual fun formatReceiptTime(atMs: Long, timeZone: String?): String {
  val zone = timeZone?.takeIf { it.isNotEmpty() }?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneOffset.UTC
  return RECEIPT_TIME.format(Instant.ofEpochMilli(atMs).atZone(zone))
}
