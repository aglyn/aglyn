// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// How a site is filled: its pages as they are, or by the AI site start (`SiteStarterMode`).
public enum SiteStarterMode: String, CaseIterable, Sendable {
  case base, ai
}

/// One starter as a list shows it (`SiteStarterSummary`). Core names the shape; a plugin supplies the rows.
public struct SiteStarterSummary: Identifiable, Equatable, Sendable {
  public let listingID: String
  public let displayName: String
  public let description: String
  public let authorName: String
  public let official: Bool
  public let priceUsd: Double
  public let previewImageURL: String?
  public let kind: String?
  public let pages: Int
  public let mode: SiteStarterMode
  /// Nil is "the search does not know", as on a free starter, which needs no purchase.
  public let owned: Bool?

  public var id: String { listingID }

  public init(
    listingID: String, displayName: String, description: String = "", authorName: String = "", official: Bool = false,
    priceUsd: Double = 0, previewImageURL: String? = nil, kind: String? = nil, pages: Int = 0,
    mode: SiteStarterMode = .base, owned: Bool? = nil
  ) {
    self.listingID = listingID
    self.displayName = displayName
    self.description = description
    self.authorName = authorName
    self.official = official
    self.priceUsd = priceUsd
    self.previewImageURL = previewImageURL
    self.kind = kind
    self.pages = pages
    self.mode = mode
    self.owned = owned
  }

  /// The same starter, with what is now known about owning it.
  public func owned(_ owned: Bool) -> SiteStarterSummary {
    SiteStarterSummary(
      listingID: listingID, displayName: displayName, description: description, authorName: authorName, official: official,
      priceUsd: priceUsd, previewImageURL: previewImageURL, kind: kind, pages: pages, mode: mode, owned: owned)
  }
}

/// What stands between a pick and Create site (`SiteStarterPickBlock`): nothing picked, or a price not paid.
public enum SiteStarterPickBlock: String, Equatable, Sendable {
  case none, purchase
}

/// `siteStarterPickBlock`: nil when a site can be created from the pick. `owned` is what the surface knows better than the
/// search's own answer.
public func siteStarterPickBlock(_ pick: SiteStarterSummary?, owned: Bool? = nil) -> SiteStarterPickBlock? {
  guard let pick else { return SiteStarterPickBlock.none }
  return pick.priceUsd > 0 && !(owned ?? (pick.owned == true)) ? .purchase : nil
}

/// A starter's price as a list shows it (`starterPriceLabel`): "Free" at zero, whole dollars as "$12", and cents only where
/// there are some.
public func siteStarterPriceLabel(_ usd: Double) -> String {
  guard usd.isFinite, usd > 0 else { return "Free" }
  return usd == usd.rounded() ? "$\(Int(usd))" : String(format: "$%.2f", usd)
}

/// What a pick needs next, said where it stays in view: a price to pay or an AI starter's questions, both on the web, or
/// a purchase already made. The apps do not take payment for a starter yet, and do not ask an AI starter's questions.
public struct SiteStarterPickNote: Equatable, Sendable {
  public let message: String
  /// The button that opens the console's Create site on the pick; nil when nothing is left to do there.
  public let webAction: String?

  public init(message: String, webAction: String?) {
    self.message = message
    self.webAction = webAction
  }
}

/// Nil for a pick that needs saying nothing: a free base starter creates at once.
public func siteStarterPickNote(_ pick: SiteStarterSummary?) -> SiteStarterPickNote? {
  guard let pick else { return nil }
  let name = pick.displayName.isEmpty ? "This starter" : pick.displayName
  if siteStarterPickBlock(pick) == .purchase {
    return SiteStarterPickNote(
      message: "\(name) costs \(siteStarterPriceLabel(pick.priceUsd)). Buy it on the web, then create your site from it.",
      webAction: "Buy on the web")
  }
  if pick.mode == .ai {
    return SiteStarterPickNote(message: "An AI starter asks a few questions, on the web.", webAction: "Continue on the web")
  }
  return pick.priceUsd > 0
    ? SiteStarterPickNote(message: "You own this starter. Create your site from it whenever you are ready.", webAction: nil) : nil
}

/// What Create site does with a create that refused the starter it was asked for (`SiteStarterPickRefused`).
public struct SiteStarterPickRefused: Equatable, Sendable {
  /// The pick stays: it can still be created from, once bought.
  public let keep: Bool
  /// It is the price that stands in the way.
  public let purchase: Bool
  /// The create's own words for why.
  public let message: String

  public init(keep: Bool, purchase: Bool, message: String) {
    self.keep = keep
    self.purchase = purchase
    self.message = message
  }
}

/// `readSiteStarterPickRefusal`: the create's refusal of THIS pick, which names its listing, or nil for a refusal about
/// anything else (the name, the address, the plan's site count). A 402 keeps the pick; anything else clears it.
public func readSiteStarterPickRefusal(status: Int, payload: JSONValue?, listingID: String) -> SiteStarterPickRefused? {
  guard case .object? = payload, !listingID.isEmpty, payload?["listingId"]?.stringValue == listingID else { return nil }
  let words = payload?["error"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  let message = words.isEmpty ? "That starter cannot be used." : words
  return status == 402
    ? SiteStarterPickRefused(keep: true, purchase: true, message: message)
    : SiteStarterPickRefused(keep: false, purchase: false, message: message)
}

/// `siteCreateReturnQuery`: the query that reopens the console's Create site on a starter, in one order; nil for an id no
/// listing can have, so a malformed one is never written into an address.
public func siteCreateReturnQuery(listingID: String) -> [(String, String)]? {
  let id = listingID.trimmingCharacters(in: .whitespacesAndNewlines)
  guard id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else { return nil }
  return [("create", "site"), ("starter", id)]
}

/// The console's Sites page with Create site open on a starter: where a person buys one, or answers an AI starter's
/// questions, which the apps do not do themselves. Nil without a workspace address.
public func siteCreateWebURL(origin: String, orgSlug: String?, listingID: String) -> URL? {
  guard let orgSlug, !orgSlug.isEmpty, let query = siteCreateReturnQuery(listingID: listingID) else { return nil }
  var base = origin
  while base.hasSuffix("/") { base.removeLast() }
  var parts = URLComponents(string: "\(base)/\(orgSlug)/hosts")
  parts?.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) }
  return parts?.url
}
