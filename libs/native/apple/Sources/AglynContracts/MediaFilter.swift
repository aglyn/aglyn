// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The one rule of the media library's Filters that is code rather than data,
// ported once from libs/aglyn/src/lib/app-utils/media-filter.ts
// (`mediaQueryRequest`). function-cases.generated.json holds the answers the
// TypeScript gives, and the tests replay every one.

private let bytesPerMegabyte = 1024.0 * 1024.0

/// The Size filter is typed in megabytes and stored in bytes, so its value is
/// converted before the query plan reads it. Anything that is not a number
/// (empty, blank, words) is left as typed and the plan refuses it.
public func mediaQueryRequest(_ clause: ListFilterRequest) -> ListFilterRequest {
  guard clause.field == "sizeMb" else { return clause }
  let trimmed = clause.value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty, let megabytes = Double(trimmed), megabytes.isFinite else { return clause }
  // JavaScript's Math.round: halves go toward positive infinity.
  let bytes = (megabytes * bytesPerMegabyte + 0.5).rounded(.down)
  return ListFilterRequest(field: clause.field, op: clause.op, value: String(Int64(bytes)))
}
