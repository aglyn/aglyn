package com.aglyn.contracts

import kotlin.math.roundToLong

/*
 * The one rule of the media library's Filters that is code rather than data,
 * ported once from libs/aglyn/src/lib/app-utils/media-filter.ts
 * (`mediaQueryRequest`). The cases in function-cases.generated.json are the
 * TypeScript's own answers, and the tests replay every one.
 */

private const val BYTES_PER_MEGABYTE = 1024.0 * 1024.0

/**
 * The Size filter is typed in megabytes and stored in bytes, so its value is
 * converted before the query plan reads it. Anything that is not a number
 * (empty, blank, words) is left as typed and the plan refuses it.
 */
fun mediaQueryRequest(clause: ListFilterRequest): ListFilterRequest {
  if (clause.field != "sizeMb") return clause
  val trimmed = clause.value.trim()
  val megabytes = trimmed.toDoubleOrNull()
  if (trimmed.isEmpty() || megabytes == null || megabytes.isNaN() || megabytes.isInfinite()) return clause
  return clause.copy(value = (megabytes * BYTES_PER_MEGABYTE).roundToLong().toString())
}
