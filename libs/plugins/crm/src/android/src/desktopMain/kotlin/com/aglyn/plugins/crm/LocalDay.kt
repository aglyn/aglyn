package com.aglyn.plugins.crm

import java.time.Instant
import java.time.ZoneId

actual fun startOfLocalDay(nowMs: Long): Long {
  val zone = ZoneId.systemDefault()
  return Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()
}
