// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

// The fonts plugin's picker (the console's `FontPicker`, `FontBrowserDialog`, `FontDetail`, AGL-3656): the site's body
// font and heading font, the whole Google Fonts catalog to choose from, a family's weights and italics, suggested pairings
// and what the fonts cost to download. Ports of `font-choice.ts`, `font-pairings.ts` and `expandCatalogRow`, replayed from
// the console's own cases; the catalog comes from the fonts plugin's `fonts/catalog` route and a choice is saved through
// the theme editor's `fonts` edit. The Kotlin kit's FontPicker.kt holds the same.

/// Which role a picker choice is for (the console's `FontRole`).
public enum FontPickerRole: String, Sendable, CaseIterable, Identifiable {
  case body, heading
  public var id: String { rawValue }
  public var label: String { self == .body ? "Body text" : "Headings" }
}

/// One family of the Google Fonts catalog (`GoogleFontFamily`).
public struct GoogleFontFamily: Hashable, Identifiable, Sendable {
  public let family: String
  public let category: String
  public let weights: [Int]
  public let italics: [Int]
  public let axes: [Axis]
  public let subsets: [String]
  public let popularity: Int
  public var id: String { family }

  public struct Axis: Hashable, Sendable {
    public let tag: String
    public let min: Double
    public let max: Double
  }

  public init(family: String, category: String, weights: [Int], italics: [Int] = [], axes: [Axis] = [], subsets: [String] = ["latin"], popularity: Int = 0) {
    self.family = family
    self.category = category
    self.weights = weights
    self.italics = italics
    self.axes = axes
    self.subsets = subsets
    self.popularity = popularity
  }
}

private let axisPattern = try! NSRegularExpression(pattern: #"^([A-Za-z]{4}):(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$"#)

/// `expandCatalogRow`: one compact catalog row (`f`, `c`, `w`, `i`, `a`, `s`, `p`) as a family; nil without a name.
public func expandCatalogRow(_ row: JSONValue) -> GoogleFontFamily? {
  guard let family = row["f"]?.stringValue else { return nil }
  let ints = { (key: String) in row[key]?.arrayValue?.compactMap { $0.numberValue.map { Int($0) } } ?? [] }
  let axes = (row["a"]?.stringValue ?? "").split(separator: ",").compactMap { entry -> GoogleFontFamily.Axis? in
    let text = String(entry)
    guard let match = axisPattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
      let tag = Range(match.range(at: 1), in: text), let min = Range(match.range(at: 2), in: text),
      let max = Range(match.range(at: 3), in: text)
    else { return nil }
    return GoogleFontFamily.Axis(tag: String(text[tag]), min: Double(text[min]) ?? 0, max: Double(text[max]) ?? 0)
  }
  return GoogleFontFamily(
    family: family, category: row["c"]?.stringValue ?? "sans-serif", weights: ints("w"), italics: ints("i"), axes: axes,
    subsets: row["s"]?.arrayValue?.compactMap(\.stringValue) ?? [], popularity: Int(row["p"]?.numberValue ?? 0))
}

/// The catalog route's answer, most used first.
public func googleFontsCatalog(of json: JSONValue?) -> [GoogleFontFamily] {
  json?["families"]?.arrayValue?.compactMap(expandCatalogRow) ?? []
}

/// A font for one role (`ThemeFontChoice`): a Google family or the site's own, its upright weights and its italics.
public struct ThemeFontChoice: Hashable, Sendable {
  public var family: String
  public var category: String
  public var weights: [Int]
  public var italics: [Int]
  /// `google` or `custom`.
  public var source: String

  public init(family: String, category: String, weights: [Int], italics: [Int] = [], source: String = "google") {
    self.family = family
    self.category = category
    self.weights = weights
    self.italics = italics
    self.source = source
  }

  init?(_ json: JSONValue?) {
    guard let json, let family = json["family"]?.stringValue else { return nil }
    self.family = family
    category = json["category"]?.stringValue ?? "sans-serif"
    weights = json["weights"]?.arrayValue?.compactMap { $0.numberValue.map { Int($0) } } ?? [400]
    italics = json["italics"]?.arrayValue?.compactMap { $0.numberValue.map { Int($0) } } ?? []
    source = json["source"]?.stringValue == "custom" ? "custom" : "google"
  }

  var body: [String: Any] {
    var out: [String: Any] = ["family": family, "category": category, "weights": weights, "source": source]
    if !italics.isEmpty { out["italics"] = italics }
    return out
  }
}

/// The body font and the heading font (`ThemeFontSelection`); nil is the theme default, or "same as body text".
public struct ThemeFontSelection: Hashable, Sendable {
  public var body: ThemeFontChoice?
  public var heading: ThemeFontChoice?

  public init(body: ThemeFontChoice? = nil, heading: ThemeFontChoice? = nil) {
    self.body = body
    self.heading = heading
  }

  /// The editor values' `fonts`.
  public init(_ json: JSONValue?) {
    body = ThemeFontChoice(json?["body"])
    heading = ThemeFontChoice(json?["heading"])
  }

  /// The theme editor's `fonts` edit.
  public var edit: [String: Any?] {
    ["control": "fonts", "value": ["body": body?.body as Any? ?? NSNull(), "heading": heading?.body as Any? ?? NSNull()] as [String: Any]]
  }
}

/// The categories the browser filters by, in the console's order and words (`FONT_CATEGORY_LABELS`).
public let fontCategoryLabels: [(value: String, label: String)] = [
  ("sans-serif", "Sans serif"), ("serif", "Serif"), ("display", "Display"), ("handwriting", "Handwriting"),
  ("monospace", "Monospace"),
]

/// `categoryLabel`.
public func fontCategoryLabel(_ category: String) -> String {
  fontCategoryLabels.first { $0.value == category }?.label ?? category
}

private let weightNames: [Int: String] = [
  100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold",
  800: "Extra bold", 900: "Black", 1000: "Extra black",
]

/// `weightLabel`: `Bold 700`, or the bare number for a weight with no name.
public func fontWeightLabel(_ weight: Int) -> String { weightNames[weight].map { "\($0) \(weight)" } ?? String(weight) }

/// `nearestWeights`: each wanted weight as the nearest one offered, without repeats, ascending.
public func nearestWeights(_ wanted: [Int], offered: [Int]) -> [Int] {
  guard let first = offered.first else { return wanted }
  let picked = wanted.map { weight in offered.reduce(first) { abs($1 - weight) < abs($0 - weight) ? $1 : $0 } }
  return Array(Set(picked)).sorted()
}

/// `defaultFontChoice`: body text in its regular and bold with a true italic, headings in its bold.
public func defaultFontChoice(_ family: GoogleFontFamily, role: FontPickerRole) -> ThemeFontChoice {
  let weights = nearestWeights(role == .body ? [400, 700] : [700], offered: family.weights)
  let italics = role == .body && !family.italics.isEmpty ? nearestWeights([400], offered: family.italics) : []
  return ThemeFontChoice(family: family.family, category: family.category, weights: weights, italics: italics)
}

/// `choiceStylesLabel`: `Regular 400, Bold 700 + italic`.
public func fontChoiceStylesLabel(_ choice: ThemeFontChoice) -> String {
  let weights = choice.weights.map(fontWeightLabel).joined(separator: ", ")
  return choice.italics.isEmpty ? weights : "\(weights) + italic"
}

/// `searchFontFamilies`: families matching a search, most used first, names that start with it before the rest.
public func searchFontFamilies(_ catalog: [GoogleFontFamily], query: String, category: String) -> [GoogleFontFamily] {
  let words = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  let inCategory = category.isEmpty ? catalog : catalog.filter { $0.category == category }
  guard !words.isEmpty else { return inCategory }
  let starts = inCategory.filter { $0.family.lowercased().hasPrefix(words) }
  let contains = inCategory.filter { !$0.family.lowercased().hasPrefix(words) && $0.family.lowercased().contains(words) }
  return starts + contains
}

/// Pairs designers keep coming back to (`CURATED_FONT_PAIRS`): heading, body.
public let curatedFontPairs: [(heading: String, body: String)] = [
  ("Playfair Display", "Source Sans 3"), ("Playfair Display", "Lato"), ("Montserrat", "Merriweather"), ("Oswald", "Open Sans"),
  ("Raleway", "Lora"), ("Merriweather", "Open Sans"), ("Roboto Slab", "Roboto"), ("Libre Baskerville", "Source Sans 3"),
  ("Bebas Neue", "Montserrat"), ("DM Serif Display", "DM Sans"), ("Fraunces", "Inter"), ("Space Grotesk", "Inter"),
  ("Archivo Black", "Roboto"), ("Abril Fatface", "Lato"), ("Cormorant Garamond", "Proza Libre"), ("Josefin Sans", "Merriweather"),
  ("Poppins", "Lora"), ("Work Sans", "Bitter"), ("EB Garamond", "Lato"), ("Pacifico", "Open Sans"), ("Cinzel", "Fira Sans"),
  ("Syne", "Manrope"), ("IBM Plex Serif", "IBM Plex Sans"), ("Zilla Slab", "Karla"),
]

/// One suggested pairing and why.
public struct FontPairing: Equatable, Sendable {
  public let family: GoogleFontFamily
  public let reason: String
}

private func contrasting(_ category: String, _ role: FontPickerRole) -> [String] {
  if role == .heading {
    if category == "serif" { return ["sans-serif", "display"] }
    if category == "monospace" { return ["sans-serif", "serif"] }
    return ["serif", "display"]
  }
  if category == "serif" { return ["sans-serif"] }
  if category == "sans-serif" { return ["serif", "sans-serif"] }
  return ["sans-serif", "serif"]
}

private func fitsRole(_ family: GoogleFontFamily, _ role: FontPickerRole) -> Bool {
  guard family.subsets.contains("latin") else { return false }
  if role == .body {
    return (family.category == "sans-serif" || family.category == "serif") && family.weights.contains(400)
      && family.weights.contains { $0 >= 600 }
  }
  return family.weights.contains { $0 >= 600 } || family.category == "display" || family.weights.count == 1
}

/// `suggestFontPairings`: for a family in one role, families for the OTHER role — the classic pairs first, then two of
/// each contrasting category, most used first.
public func suggestFontPairings(_ family: GoogleFontFamily, role: FontPickerRole, catalog: [GoogleFontFamily], limit: Int = 4) -> [FontPairing] {
  var byName: [String: GoogleFontFamily] = [:]
  for entry in catalog where byName[entry.family.lowercased()] == nil { byName[entry.family.lowercased()] = entry }
  let name = family.family.lowercased()
  var picked: [FontPairing] = []
  var seen: Set<String> = [name]
  func add(_ entry: GoogleFontFamily?, _ reason: String) {
    guard let entry, !seen.contains(entry.family.lowercased()), picked.count < limit else { return }
    seen.insert(entry.family.lowercased())
    picked.append(FontPairing(family: entry, reason: reason))
  }
  for pair in curatedFontPairs {
    if role == .heading && pair.body.lowercased() == name { add(byName[pair.heading.lowercased()], "A classic pairing") }
    if role == .body && pair.heading.lowercased() == name { add(byName[pair.body.lowercased()], "A classic pairing") }
  }
  for category in contrasting(family.category, role) {
    let reason =
      role == .heading
      ? "\(capitalized(category)) headings over \(family.category) text"
      : "\(capitalized(category)) text under \(family.category) headings"
    var taken = 0
    for entry in catalog {
      if taken >= 2 || picked.count >= limit { break }
      if entry.category != category || !fitsRole(entry, role) || seen.contains(entry.family.lowercased()) { continue }
      add(entry, reason)
      taken += 1
    }
  }
  return picked
}

private func capitalized(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

/// One family's share of a cost (`FontFamilyCost`).
public struct FontFamilyCost: Equatable, Sendable {
  public let family: String
  public let bytes: Int
  public let files: Int
  public let complete: Bool

  public init(family: String, bytes: Int, files: Int, complete: Bool) {
    self.family = family
    self.bytes = bytes
    self.files = files
    self.complete = complete
  }
}

/// What the site's fonts cost a visitor to download, as the console's badge reads the `fonts/cost` route.
public struct FontCost: Equatable, Sendable {
  public let bytes: Int
  public let files: Int
  public let complete: Bool
  public let families: [FontFamilyCost]

  public init(bytes: Int, files: Int, complete: Bool, families: [FontFamilyCost] = []) {
    self.bytes = bytes
    self.files = files
    self.complete = complete
    self.families = families
  }

  /// What a theme with no web font costs: nothing, and nothing to ask (`NO_FONT_COST`).
  public static let none = FontCost(bytes: 0, files: 0, complete: true)

  /// The route's answer.
  public init(_ json: JSONValue?) {
    self.init(
      bytes: Int(json?["bytes"]?.numberValue ?? 0), files: Int(json?["files"]?.numberValue ?? 0),
      complete: json?["complete"]?.boolValue != false,
      families: json?["families"]?.arrayValue?.compactMap { row in
        guard let family = row["family"]?.stringValue else { return nil }
        return FontFamilyCost(
          family: family, bytes: Int(row["bytes"]?.numberValue ?? 0), files: row["files"]?.arrayValue?.count ?? 0,
          complete: row["complete"]?.boolValue != false)
      } ?? [])
  }

  /// One family's share, by name (`familyCost`).
  public func share(of family: String) -> FontFamilyCost? {
    let wanted = family.trimmed.lowercased()
    return families.first { $0.family.trimmed.lowercased() == wanted }
  }
}

/// The fonts plugin's routes the picker reads.
public struct FontPickerAPI: Sendable {
  public let api: ConsoleAPIClient
  public let hostID: String

  public init(api: ConsoleAPIClient, hostID: String) {
    self.api = api
    self.hostID = hostID
  }

  /// The whole catalog, most used first.
  public func catalog() async throws -> [GoogleFontFamily] {
    googleFontsCatalog(of: try await api.request("/api/fonts/catalog"))
  }

  /// What the site's fonts would cost a visitor with `selection` written into its theme (`/api/fonts/cost`).
  public func cost(_ selection: ThemeFontSelection) async throws -> FontCost {
    let fonts: [String: Any] = ["body": selection.body?.body ?? NSNull(), "heading": selection.heading?.body ?? NSNull()]
    let answer = try await api.request("/api/fonts/cost", method: .post, body: jsonBody(["hostId": hostID, "fonts": fonts]))
    guard answer?["bytes"]?.numberValue != nil else { throw ConsoleAPIError(status: 0, message: "The size could not be measured.") }
    return FontCost(answer)
  }
}

/// `formatDownloadSize`: `0 KB`, `38 KB`, `1.2 MB` (kilobytes of 1,024 bytes).
public func formatDownloadSize(_ bytes: Int) -> String {
  guard bytes > 0 else { return "0 KB" }
  if bytes >= 1024 * 1024 { return String(format: "%.1f MB", Double(bytes) / (1024 * 1024)) }
  return "\(max(1, Int((Double(bytes) / 1024).rounded()))) KB"
}

/// `downloadCostLabel`: `38 KB · 2 files`, `≈` when part of it could not be measured.
public func fontCostLabel(_ cost: FontCost) -> String {
  let size = (cost.complete ? "" : "≈ ") + formatDownloadSize(cost.bytes)
  return cost.files == 0 ? size : "\(size) · \(cost.files) \(cost.files == 1 ? "file" : "files")"
}

/// The words a font preview is drawn in (`SiteSample`): the site's own, where it has them.
public struct SiteSample: Equatable, Sendable {
  /// The site's name.
  public let title: String
  /// A headline.
  public let heading: String
  /// A sentence of running text.
  public let paragraph: String

  public static let fallback = SiteSample(
    title: "Your site", heading: "A headline that sets the tone",
    paragraph: "Running text reads like this, sentence after sentence, on every page of your site.")
}

/// Trims a site's text to a preview's length, on a word (in UTF-16 units, as the console's slice counts them).
private func clipSample(_ text: String, _ max: Int) -> String {
  let clean = text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
  let units = Array(clean.utf16)
  guard units.count > max else { return clean }
  let cut = String(decoding: units.prefix(max), as: UTF16.self)
  return cut.replacingOccurrences(of: #"\s+\S*$"#, with: "", options: .regularExpression) + "…"
}

/// `siteSampleFrom`: the sample for a site document as it was read.
public func siteSampleFrom(_ host: JSONValue?) -> SiteSample {
  let named = [host?["displayName"], host?["name"]].compactMap { $0?.stringValue }.first { !$0.trimmed.isEmpty }
  let name = named.map { clipSample($0, 48) } ?? ""
  let seoTitle = host?["seo"]?["title"]?.stringValue ?? ""
  let title = seoTitle.trimmed.isEmpty ? "" : clipSample(seoTitle, 70)
  let description = host?["seo"]?["description"]?.stringValue ?? ""
  let paragraph = description.trimmed.isEmpty ? "" : clipSample(description, 160)
  return SiteSample(
    title: !name.isEmpty ? name : !title.isEmpty ? title : SiteSample.fallback.title,
    heading: !title.isEmpty && title != name ? title : !name.isEmpty ? "Welcome to \(name)" : SiteSample.fallback.heading,
    paragraph: paragraph.isEmpty ? SiteSample.fallback.paragraph : paragraph)
}
