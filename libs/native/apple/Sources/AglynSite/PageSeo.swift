// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

// A page's own SEO, as the console's page view SEO card reads and saves it (AGL-117, AGL-1337, AGL-2417, AGL-3197):
// the search title (which may name variables), the description, the breadcrumb label, and the social image with its
// size and description, all in the screen's `seo` map. The Kotlin kit's PageSeo.kt.

/// The card's limits (`SEO_LISTING_FIELDS`): what a search result shows before it truncates.
public enum PageSeoLimits {
  public static let title = 60
  public static let description = 155
  public static let breadcrumb = 40
  public static let imageAlt = 300
}

/// The variables a page title may name (`SEO_TITLE_VARIABLES`), in the console's menu order.
public let pageSeoTitleVariables: [(name: String, label: String)] = [
  ("page.name", "Page name"), ("site.separator", "Separator"), ("site.name", "Site name"),
]

/// The separator when the site sets none (`DEFAULT_TITLE_SEPARATOR`).
public let defaultSeoTitleSeparator = "\u{2013}"

/// Whether a written title names a variable (`hasSeoTitleVariables`).
public func hasSeoTitleVariables(_ value: String) -> Bool { value.contains("{{") }

/// The title as the live page renders it (`resolveSeoTitleVariables`): each known variable filled in, an unknown one
/// left as written, a separator kept only where something renders on each side of it, runs of spaces collapsed.
public func resolveSeoTitleVariables(_ written: String, pageName: String, siteName: String, separator: String) -> String {
  guard hasSeoTitleVariables(written) else { return written }
  let clean = { (value: String) in value.trimmingCharacters(in: .whitespacesAndNewlines) }
  let known = Set(pageSeoTitleVariables.map(\.name))
  guard let token = try? NSRegularExpression(pattern: "\\{\\{\\s*([a-zA-Z][\\w.]*)\\s*\\}\\}") else { return written }
  let source = written as NSString
  var parts: [(text: String, variable: String?)] = []
  var at = 0
  for match in token.matches(in: written, range: NSRange(location: 0, length: source.length)) {
    if match.range.location > at { parts.append((source.substring(with: NSRange(location: at, length: match.range.location - at)), nil)) }
    let name = source.substring(with: match.range(at: 1))
    let text: String
    if !known.contains(name) {
      text = source.substring(with: match.range)
    } else if name == "site.separator" {
      text = clean(separator).isEmpty ? defaultSeoTitleSeparator : clean(separator)
    } else {
      text = clean(name == "page.name" ? pageName : siteName)
    }
    parts.append((text, name))
    at = match.range.location + match.range.length
  }
  if at < source.length { parts.append((source.substring(from: at), nil)) }
  var rendered = parts.map(\.text)
  func live(_ range: Range<Int>) -> Bool { rendered[range].contains { !clean($0).isEmpty } }
  for (index, part) in parts.enumerated() where part.variable == "site.separator" {
    if !live(0..<index) || !live((index + 1)..<rendered.count) { rendered[index] = "" }
  }
  return clean(rendered.joined().replacingOccurrences(of: "\\s{2,}", with: " ", options: .regularExpression))
}

/// A staged social image (`ScreenSocialImageDraft`); an empty `image` clears it.
public struct PageSocialImage: Equatable, Sendable {
  public var image: String
  public var width: Int
  public var height: Int
  public var alt: String

  public init(image: String, width: Int, height: Int, alt: String) {
    self.image = image
    self.width = width
    self.height = height
    self.alt = alt
  }
}

/// What the card reads from the screen's `seo` map.
public struct PageSeo: Equatable, Sendable {
  public let title: String
  public let description: String
  public let breadcrumb: String
  public let image: PageSocialImage?

  public init(_ seo: [String: Any]?) {
    title = seo?["title"] as? String ?? ""
    description = seo?["description"] as? String ?? ""
    breadcrumb = seo?["breadcrumb"] as? String ?? ""
    if let image = seo?["image"] as? String, !image.isEmpty {
      self.image = PageSocialImage(
        image: image, width: (seo?["imageWidth"] as? NSNumber)?.intValue ?? 0,
        height: (seo?["imageHeight"] as? NSNumber)?.intValue ?? 0, alt: seo?["imageAlt"] as? String ?? "")
    } else {
      image = nil
    }
  }
}

/// The `seo` map a save writes (`buildScreenSeoUpdate`): everything the card does not edit carried forward; a typed
/// field trimmed, and removed when blank; the image group moving as one, its blank description removed; nil when
/// nothing is left, so the save deletes the map.
public func buildScreenSeoUpdate(
  _ existing: [String: Any]?, title: String?, description: String?, breadcrumb: String?, image: PageSocialImage?
) -> [String: Any]? {
  var seo = existing ?? [:]
  for (key, staged) in [("title", title), ("description", description), ("breadcrumb", breadcrumb)] {
    guard let staged else { continue }
    let value = staged.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty { seo.removeValue(forKey: key) } else { seo[key] = value }
  }
  if let image {
    if image.image.isEmpty {
      for key in ["image", "imageWidth", "imageHeight", "imageAlt"] { seo.removeValue(forKey: key) }
    } else {
      seo["image"] = image.image
      seo["imageWidth"] = image.width
      seo["imageHeight"] = image.height
      let alt = image.alt.trimmingCharacters(in: .whitespacesAndNewlines)
      if alt.isEmpty { seo.removeValue(forKey: "imageAlt") } else { seo["imageAlt"] = alt }
    }
  }
  return seo.isEmpty ? nil : seo
}

/// The description a picked file brings (`inheritedMediaAlt`): the file's own alt, only while the card has none.
public func inheritedSocialImageAlt(current: String, assetAlt: String) -> String {
  if !current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return current }
  let inherited = assetAlt.trimmingCharacters(in: .whitespacesAndNewlines)
  return inherited.isEmpty ? current : String(inherited.prefix(PageSeoLimits.imageAlt))
}

extension PageSettingsAPI {
  /// Saves the page's `seo` map (nil deletes it), then drops the live page's cached copy.
  public func saveSeo(_ id: String, seo: [String: Any]?, livePath: String?) async throws {
    try await writer.update(
      ["hosts", hostID, "screens", id], ["seo": seo ?? FirestoreSentinel.delete, "updatedAt": Date()])
    await announce(id, livePath: livePath)
  }
}
