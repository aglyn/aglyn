// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

// The media library's search normalizer (`MEDIA_NAME_NORMALIZERS`,
// libs/aglyn app-utils/media-filter.ts): a file name's punctuation is a word
// break, so `hero-banner_2024.jpg` is found by `hero`, `banner` or `2024`.

/// A file name's words: every run of letters and digits, space separated (`mediaNameWords`).
public func mediaNameWords(_ fileName: String?) -> String {
  (fileName ?? "")
    .replacingOccurrences(of: "[^\\p{L}\\p{N}]+", with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

/// The token a library search asks for (`mediaSearchToken`).
public func mediaSearchToken(_ query: String?) -> String {
  nameSearchToken(mediaNameWords(query))
}

/// A file's family from its type, as the Type filter names it (`mediaKindOf`).
public func mediaKindOf(_ contentType: String?) -> String {
  let type = (contentType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  if type.hasPrefix("image/") { return "image" }
  if type.hasPrefix("video/") { return "video" }
  if type.hasPrefix("audio/") { return "audio" }
  if type == "application/pdf" { return "pdf" }
  return "document"
}

/// The planner's normalizers for a media library query.
public struct MediaNameNormalizers: ListQueryNormalizers {
  public init() {}
  public func key(_ value: String) -> String { nameSearchKey(value) }
  public func token(_ value: String) -> String { mediaSearchToken(value) }
  public func reversed(_ value: String) -> String { nameSearchReversed(value) }
  public var maxPrefix: Int { ContractValues.shared.nameTokenMaxPrefix }
}
