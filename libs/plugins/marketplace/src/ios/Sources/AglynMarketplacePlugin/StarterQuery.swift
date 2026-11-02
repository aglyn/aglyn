// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/// The starter search as a request and an answer (`model/starter-query.ts`), line for line: the same parameters in the same
/// order, the same defensive read of the answer, the same "3 pages". derived-values.generated.json's `siteStarters`
/// holds the console's own answers, which the tests replay on both platforms.
enum StarterQuery {
  /// The query string for one search, its parameters always in one order.
  static func params(orgID: String, mode: SiteStarterMode, word: String = "", limit: Int = SiteStarterSearch.max) -> [(String, String)] {
    var params: [(String, String)] = [("orgId", clean(orgID)), ("mode", mode.rawValue)]
    let word = String(clean(word).prefix(SiteStarterSearch.wordMax))
    if !word.isEmpty { params.append(("q", word)) }
    params.append(("limit", String(limit > 0 ? min(limit, SiteStarterSearch.max) : SiteStarterSearch.max)))
    return params
  }

  /// One starter as a row shows it, read field by field, or nil for a row with no listing id. Each field falls back the way
  /// a row needs it to: a missing price is free, a missing picture is none, a mode is `base` unless it says `ai`, and
  /// `owned` is kept only where the answer gave it as a yes or a no.
  static func readSummary(_ value: JSONValue?) -> SiteStarterSummary? {
    guard case .object? = value, let listingID = idOrNil(value?["listingId"]) else { return nil }
    let price = number(value?["priceUsd"]) ?? 0
    let pages = number(value?["facets"]?["pages"]) ?? 0
    let preview = value?["previewImageUrl"]?.stringValue
    return SiteStarterSummary(
      listingID: listingID, displayName: value?["displayName"]?.stringValue ?? "",
      description: value?["description"]?.stringValue ?? "", authorName: value?["authorName"]?.stringValue ?? "",
      official: value?["official"] == .bool(true), priceUsd: price > 0 ? price : 0,
      previewImageURL: preview?.isEmpty == false ? preview : nil, kind: idOrNil(value?["facets"]?["kind"]),
      pages: pages > 0 ? Int(pages.rounded(.down)) : 0, mode: value?["facets"]?["mode"] == .string("ai") ? .ai : .base,
      owned: { if case .bool(let owned)? = value?["owned"] { owned } else { nil } }())
  }

  /// The route's answer, read defensively: rows that are not starters are dropped, as is a duplicate of one already read.
  static func parseAnswer(_ json: JSONValue?) -> [SiteStarterSummary] {
    var seen = Set<String>()
    return (json?["rows"]?.arrayValue ?? []).compactMap(readSummary).filter { seen.insert($0.listingID).inserted }
  }

  /// How many pages a starter creates, or nil when it does not say.
  static func pagesLabel(_ pages: Double) -> String? {
    guard pages.isFinite, pages >= 1 else { return nil }
    let whole = Int(pages.rounded(.down))
    return whole == 1 ? "1 page" : "\(whole) pages"
  }

  private static func clean(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  private static func idOrNil(_ value: JSONValue?) -> String? {
    let text = clean(value?.stringValue ?? "")
    return text.isEmpty ? nil : text
  }

  private static func number(_ value: JSONValue?) -> Double? {
    switch value {
    case .number(let number)?: number.isFinite ? number : nil
    case .string(let text)?: Double(clean(text)).flatMap { $0.isFinite ? $0 : nil }
    default: nil
    }
  }
}

/// A starter's picture as an app can read it. The platform's own starters show the style pictures on a path that answers
/// URLSession with a challenge, and each has a path an app can read (AGL-4127).
func starterPicture(_ row: SiteStarterSummary, origin: String, width: Int) -> URL? {
  let stored = row.previewImageURL.flatMap { url in
    SiteStyles.all.first { url.hasSuffix("/_static/starter/styles/\($0.id).webp") }?.preview ?? url
  }
  return mediaPreviewURL(stored, origin: origin, hostID: nil, width: width)
}
