// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

// A site's setup as the console's Setup pages read and save it
// (`hosts/[host]/setup/(sections)`): every field is a key of the host
// document, saved as the console's settings forms save it — a merge of the
// nested fields, a blank clearable field deleted, the date stamped — and then
// announced to the live site (`/api/screens/revalidate`, `entireHost`), as
// `writeSiteWideChange` does. The theme goes through `/api/hosts/theme`. The
// Kotlin kit's `Setup.kt`.

/// The setup sections, in the console's order (`setup-sections.ts`).
public enum SetupSection: String, CaseIterable, Identifiable, Sendable {
  case details, seo, tracking, theme, emails

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .details: "Basic details"
    case .seo: "SEO"
    case .tracking: "Tracking"
    case .theme: "Theme"
    case .emails: "Emails"
    }
  }

  public var supporting: String {
    switch self {
    case .details: "Logo, business details, layout and languages"
    case .seo: "Search title, social image, business profile and verification"
    case .tracking: "Analytics, ad tags and the consent banner"
    case .theme: "Colors, font, shape and your saved themes"
    case .emails: "The emails your site sends to customers"
    }
  }

  public var systemImage: String {
    switch self {
    case .details: "info.circle"
    case .seo: "magnifyingglass"
    case .tracking: "chart.xyaxis.line"
    case .theme: "paintpalette"
    case .emails: "envelope"
    }
  }

  /// A section by its id or by an old `?tab=` value (`SETUP_TAB_SECTIONS`); details otherwise.
  public static func of(_ value: String?) -> SetupSection {
    switch value {
    case "hostSeo": .seo
    case "hostTracking": .tracking
    case "hostDetails", "activity": .details
    default: SetupSection(rawValue: value ?? "") ?? .details
    }
  }
}

/// The value at a dotted `path` of a document's fields.
public func valueAt(_ fields: [String: Any]?, _ path: String) -> Any? {
  var current: Any? = fields
  for key in path.split(separator: ".", omittingEmptySubsequences: false) {
    guard let map = current as? [String: Any], let next = map[String(key)], !(next is NSNull) else { return nil }
    current = next
  }
  return current
}

/// The text at a dotted `path`, empty when it is missing or not text.
public func textAt(_ fields: [String: Any]?, _ path: String) -> String { valueAt(fields, path) as? String ?? "" }

/// A nested map from dotted paths, as a settings form submits its values:
/// `seo.title` becomes `[seo: [title]]`. A blank value at a `clearable` path
/// the document still holds becomes a delete (the form's way back to the
/// default); any other blank is written as the empty text the form holds.
public func settingsPayload(_ values: [String: Any], stored: [String: Any]?, clearable: Set<String> = []) -> [String: Any] {
  var root: [String: Any] = [:]
  for (path, raw) in values.sorted(by: { $0.key < $1.key }) {
    let value: Any = (raw as? String).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? raw
    let blank = (value as? String)?.isEmpty == true
    let written: Any
    if clearable.contains(path) && blank {
      guard let held = valueAt(stored, path), "\(held)" != "" else { continue }
      written = FirestoreSentinel.delete
    } else {
      written = value
    }
    insert(&root, path.split(separator: ".").map(String.init)[...], written)
  }
  return root
}

private func insert(_ node: inout [String: Any], _ keys: ArraySlice<String>, _ value: Any) {
  guard let key = keys.first else { return }
  if keys.count == 1 {
    node[key] = value
    return
  }
  var child = node[key] as? [String: Any] ?? [:]
  insert(&child, keys.dropFirst(), value)
  node[key] = child
}

private func matches(_ text: String, _ pattern: String) -> Bool {
  text.range(of: pattern, options: .regularExpression) != nil
}

/// One tracking field: its path, label, shape and an example.
public struct TrackingField: Sendable {
  public let path: String
  public let label: String
  public let pattern: String
  public let example: String
}

/// The Tracking form (`hostTracking`), every field clearable; the shapes are
/// `visitor-consent.ts`'s, which the tenant checks before it writes an ID into a page.
public let trackingFields: [TrackingField] = [
  TrackingField(path: "analytics.gaMeasurementId", label: "Google Analytics measurement ID", pattern: "^G-[A-Z0-9]{4,16}$", example: "G-XXXXXXXXXX"),
  TrackingField(path: "analytics.gtmContainerId", label: "Google Tag Manager container ID", pattern: "^GTM-[A-Z0-9]{5,10}$", example: "GTM-XXXXXXX"),
  TrackingField(path: "analytics.adTags.meta", label: "Meta pixel ID", pattern: "^[0-9]{8,20}$", example: "123456789012345"),
  TrackingField(path: "analytics.adTags.google-ads", label: "Google Ads conversion ID", pattern: "^AW-[0-9]{6,16}$", example: "AW-123456789"),
  TrackingField(path: "analytics.adTags.linkedin", label: "LinkedIn partner ID", pattern: "^[0-9]{4,10}$", example: "1234567"),
]

/// The tracking error for `value`, or nil when it is blank or fits.
public func trackingError(_ field: TrackingField, _ value: String) -> String? {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty || matches(trimmed, field.pattern) { return nil }
  let name = field.label.components(separatedBy: " ID").first ?? field.label
  return "Use the ID as \(name) shows it, like \(field.example)"
}

/// The consent modes (`resolveHostConsentMode`): `geo` asks only where the law needs it, `strict` asks everyone.
public func consentMode(_ host: [String: Any]?) -> String { valueAt(host, "consent.mode") as? String == "strict" ? "strict" : "geo" }

/// Whether the tenant will emit `value` as a verification token (`isSearchEngineVerificationToken`).
public func isVerificationToken(_ value: String?) -> Bool {
  guard let value else { return false }
  return matches(value, "^[A-Za-z0-9_-]{1,128}$")
}

private func attribute(_ tag: String, _ name: String) -> String? {
  let pattern = "\\b\(name)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>/]+))"
  guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
    let match = regex.firstMatch(in: tag, range: NSRange(tag.startIndex..., in: tag))
  else { return nil }
  for group in 1...3 {
    let range = match.range(at: group)
    if range.location != NSNotFound, let swiftRange = Range(range, in: tag) {
      return String(tag[swiftRange]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }
  return ""
}

/// What a paste into a verification field reads as: the tag's `content` and
/// `name`, or the trimmed paste.
public func parseVerificationInput(_ input: String?) -> (token: String, metaName: String?) {
  guard let trimmed = input?.trimmingCharacters(in: .whitespacesAndNewlines) else { return ("", nil) }
  let looksLikeTag = trimmed.contains("<") || trimmed.range(of: "\\bcontent\\s*=", options: [.regularExpression, .caseInsensitive]) != nil
  if !looksLikeTag { return (trimmed, nil) }
  return (attribute(trimmed, "content") ?? "", attribute(trimmed, "name")?.lowercased())
}

/// The token a paste stores as (`extractSearchEngineVerificationToken`).
public func extractVerificationToken(_ input: String?) -> String { parseVerificationInput(input).token }

/// The field error for a paste into `engine`'s field (`searchEngineVerificationError`).
public func verificationError(_ engine: String, _ input: String?, metaNames: [String: String], labels: [String: String]) -> String? {
  guard let input, !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  let (token, metaName) = parseVerificationInput(input)
  if let metaName, metaName != metaNames[engine] {
    if let other = ["google", "bing"].first(where: { metaNames[$0] == metaName }) {
      return "That tag is for \(labels[other] ?? other) — paste it in that field instead"
    }
    return "That tag isn’t a \(labels[engine] ?? engine) verification tag"
  }
  if !isVerificationToken(token) { return "Paste the verification code, or the whole meta tag — the code is letters, numbers, - and _ only" }
  return nil
}

/// The Languages card's list: comma separated, each a tag (`en`, `pt-BR`),
/// repeats dropped; the second value names the first bad one.
public func parseLocales(_ text: String) -> (locales: [String], error: String?) {
  var out: [String] = []
  for raw in text.split(separator: ",", omittingEmptySubsequences: false) {
    let tag = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if tag.isEmpty { continue }
    if !matches(tag, "^[a-z]{2}(-[A-Za-z]{2,4})?$") { return (out, "\"\(tag)\" is not a language code like en or pt-BR") }
    if !out.contains(tag) { out.append(tag) }
  }
  return (out, nil)
}

/// One social link of the business details.
public struct SocialLink: Equatable, Sendable, Identifiable {
  public let id = UUID()
  public var label: String
  public var url: String

  public init(label: String, url: String) {
    self.label = label
    self.url = url
  }

  public static func == (a: SocialLink, b: SocialLink) -> Bool { a.label == b.label && a.url == b.url }
}

/// The business details card's list limit (`MAX_LINKS`).
public let socialLinksMax = 8

public func socialLinks(of host: [String: Any]?) -> [SocialLink] {
  (valueAt(host, "business.socialLinks") as? [Any])?.compactMap { row in
    guard let map = row as? [String: Any] else { return nil }
    return SocialLink(label: map["label"] as? String ?? "", url: map["url"] as? String ?? "")
  } ?? []
}

/// The SEO form's limits (`hostSeo`, `hostSeoEntity`, `hostSeoAgent`).
public enum SeoLimits {
  public static let title = 60
  public static let description = 155
  public static let separator = 3
  public static let titlePattern = 120
  public static let entityDescription = 300
  public static let imageAlt = 300
  public static let agent = 1000
}

/// The business entity's kinds (`HostEntityType`, stored as the enum's number in text).
public let entityTypes: [(value: String, label: String)] = [("1", "Organization"), ("2", "Person")]

/// One of the site's saved themes (`hosts/{hostId}/themes`).
public struct SavedTheme: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let updatedAt: Date?

  public init(_ doc: FirestoreDocument) {
    id = doc.id
    name = doc.string("name").flatMap { $0.trimmed.isEmpty ? nil : $0 } ?? "Untitled theme"
    updatedAt = doc.date("updatedAt")
  }
}

/// Which theme the site picked (`themeSelection`): its kind (default, preset, custom, installed), id and name.
public struct ThemeSelection: Equatable, Sendable {
  public let kind: String
  public let id: String?
  public let name: String?
}

public func themeSelection(of host: [String: Any]?) -> ThemeSelection {
  if let raw = host?["themeSelection"] as? [String: Any], let kind = raw["kind"] as? String {
    return ThemeSelection(kind: kind, id: raw["id"] as? String, name: raw["name"] as? String)
  }
  if valueAt(host, "themeInstalledFrom.listingId") as? String != nil { return ThemeSelection(kind: "installed", id: nil, name: nil) }
  if let theme = host?["theme"] as? [String: Any], !theme.isEmpty { return ThemeSelection(kind: "custom", id: nil, name: nil) }
  return ThemeSelection(kind: "default", id: nil, name: nil)
}

/// Whether the site's override has edits on top of its picked theme.
public func hasThemeEdits(_ host: [String: Any]?) -> Bool {
  guard let override = host?["themeOverride"] as? [String: Any], let patch = override["patch"] as? [String: Any] else { return false }
  return !patch.isEmpty
}

/// The theme library's limits (`THEME_LIBRARY_MAX_CUSTOM`, `THEME_NAME_MAX`).
public let themeLibraryMaxCustom = 25
public let themeNameMax = 60

public struct ThemeColorControl: Equatable, Sendable {
  public let token: String
  public let label: String
  public let group: String
}

public struct ThemeFontOption: Equatable, Sendable {
  public let family: String
  public let category: String
}

/// A number control's label and range.
public struct ThemeRange: Equatable, Sendable {
  public let label: String
  public let min: Int
  public let max: Int
}

/// The editor's controls as the theme route hands them out (`THEME_EDITOR_CATALOG`).
public struct ThemeCatalog: Equatable, Sendable {
  public let schemes: [String]
  public let colors: [ThemeColorControl]
  public let darkSchemeLabel: String
  public let darkSchemeOptions: [(value: String, label: String)]
  public let systemFont: String
  public let fonts: [ThemeFontOption]
  public let borderRadius: ThemeRange
  public let spacing: ThemeRange
  public let navHeightXs: ThemeRange
  public let navHeightSm: ThemeRange

  public static func == (a: ThemeCatalog, b: ThemeCatalog) -> Bool {
    a.schemes == b.schemes && a.colors == b.colors && a.fonts == b.fonts && a.systemFont == b.systemFont
      && a.darkSchemeOptions.map(\.value) == b.darkSchemeOptions.map(\.value)
  }
}

/// One of the built-in themes a site can start from (`ThemePresetSummary`): its id, name, one line and swatches.
public struct ThemePreset: Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let description: String
  public let swatches: [String]
}

public func themePresets(of json: JSONValue?) -> [ThemePreset] {
  json?.arrayValue?.compactMap { row in
    guard let id = row["id"]?.stringValue else { return nil }
    return ThemePreset(
      id: id, name: row["name"]?.stringValue ?? id, description: row["description"]?.stringValue ?? "",
      swatches: row["swatches"]?.arrayValue?.compactMap(\.stringValue) ?? [])
  } ?? []
}

/// What each control shows (`readThemeEditorValues`).
public struct ThemeValues: Equatable, Sendable {
  public var colors: [String: [String: String?]]
  public var darkScheme: String
  public var fontFamily: String
  public var borderRadius: Double?
  public var spacing: Double?
  public var navHeightXs: Double?
  public var navHeightSm: Double?
}

private func rangeOf(_ json: JSONValue?) -> ThemeRange {
  ThemeRange(
    label: json?["label"]?.stringValue ?? "", min: Int(json?["min"]?.numberValue ?? 0),
    max: Int(json?["max"]?.numberValue ?? 100))
}

public func themeCatalog(of json: JSONValue?) -> ThemeCatalog {
  ThemeCatalog(
    schemes: json?["schemes"]?.arrayValue?.compactMap(\.stringValue) ?? [],
    colors: json?["colors"]?.arrayValue?.map {
      ThemeColorControl(token: $0["token"]?.stringValue ?? "", label: $0["label"]?.stringValue ?? "", group: $0["group"]?.stringValue ?? "")
    } ?? [],
    darkSchemeLabel: json?["darkScheme"]?["label"]?.stringValue ?? "Dark scheme",
    darkSchemeOptions: json?["darkScheme"]?["options"]?.arrayValue?.map {
      ($0["value"]?.stringValue ?? "", $0["label"]?.stringValue ?? "")
    } ?? [],
    systemFont: json?["systemFont"]?.stringValue ?? "__system__",
    fonts: json?["fonts"]?.arrayValue?.map {
      ThemeFontOption(family: $0["family"]?.stringValue ?? "", category: $0["category"]?.stringValue ?? "")
    } ?? [],
    borderRadius: rangeOf(json?["borderRadius"]),
    spacing: rangeOf(json?["spacing"]),
    navHeightXs: rangeOf(json?["navHeight"]?["xs"]),
    navHeightSm: rangeOf(json?["navHeight"]?["sm"]))
}

public func themeValues(of json: JSONValue?) -> ThemeValues {
  var colors: [String: [String: String?]] = [:]
  if case .object(let schemes)? = json?["colors"] {
    for (scheme, tokens) in schemes {
      guard case .object(let map) = tokens else { continue }
      colors[scheme] = map.mapValues { $0.stringValue }
    }
  }
  return ThemeValues(
    colors: colors, darkScheme: json?["darkScheme"]?.stringValue ?? "auto",
    fontFamily: json?["fontFamily"]?.stringValue ?? "__system__",
    borderRadius: json?["borderRadius"]?.numberValue, spacing: json?["spacing"]?.numberValue,
    navHeightXs: json?["navHeight"]?["xs"]?.numberValue, navHeightSm: json?["navHeight"]?["sm"]?.numberValue)
}

/// One edit of the theme editor, as the route reads it (`ThemeEditorEdit`).
public enum ThemeEdit: Equatable, Sendable {
  case color(scheme: String, token: String, value: String?)
  case darkScheme(String)
  case fontFamily(String)
  case borderRadius(Double?)
  case spacing(Double?)
  case navHeight(breakpoint: String, value: Double?)

  public var body: [String: Any?] {
    switch self {
    case .color(let scheme, let token, let value): ["control": "color", "scheme": scheme, "token": token, "value": value]
    case .darkScheme(let value): ["control": "darkScheme", "value": value]
    case .fontFamily(let value): ["control": "fontFamily", "value": value]
    case .borderRadius(let value): ["control": "borderRadius", "value": value]
    case .spacing(let value): ["control": "spacing", "value": value]
    case .navHeight(let breakpoint, let value): ["control": "navHeight", "breakpoint": breakpoint, "value": value]
    }
  }
}

/// The edits that turn `before` into `after`: only the controls that changed.
public func themeEdits(from before: ThemeValues, to after: ThemeValues) -> [ThemeEdit] {
  var edits: [ThemeEdit] = []
  for scheme in after.colors.keys.sorted() {
    for token in after.colors[scheme]!.keys.sorted() {
      let value = after.colors[scheme]![token]!
      if before.colors[scheme]?[token] ?? nil != value {
        edits.append(.color(scheme: scheme, token: token, value: value.flatMap { $0.isEmpty ? nil : $0 }))
      }
    }
  }
  if before.darkScheme != after.darkScheme { edits.append(.darkScheme(after.darkScheme)) }
  if before.fontFamily != after.fontFamily { edits.append(.fontFamily(after.fontFamily)) }
  if before.borderRadius != after.borderRadius { edits.append(.borderRadius(after.borderRadius)) }
  if before.spacing != after.spacing { edits.append(.spacing(after.spacing)) }
  if before.navHeightXs != after.navHeightXs { edits.append(.navHeight(breakpoint: "xs", value: after.navHeightXs)) }
  if before.navHeightSm != after.navHeightSm { edits.append(.navHeight(breakpoint: "sm", value: after.navHeightSm)) }
  return edits
}

/// The font categories the browser filters by, in the order the console lists them (`HostThemeFontCategory`).
public let fontCategories: [(value: String, label: String)] = [
  ("sans-serif", "Sans serif"), ("serif", "Serif"), ("display", "Display"), ("handwriting", "Handwriting"),
  ("monospace", "Monospace"),
]

/// The fonts the browser lists: those whose name has every typed word, in the picked category (nil: all).
public func filterFonts(_ fonts: [ThemeFontOption], search: String, category: String?) -> [ThemeFontOption] {
  let words = search.lowercased().split(whereSeparator: { $0.isWhitespace })
  return fonts.filter { font in
    if let category, font.category != category { return false }
    let name = font.family.lowercased()
    return words.allSatisfy { name.contains($0) }
  }
}

/// A number control's text as the editor shows it: whole numbers without a decimal point.
public func formatThemeNumber(_ value: Double?) -> String {
  guard let value else { return "" }
  return value == value.rounded() ? String(Int(value)) : String(value)
}

/// What a number control's text means: its value (nil when empty or out of range) and the problem to show.
public func parseThemeNumber(_ text: String, in range: ThemeRange) -> (value: Double?, error: String?) {
  let trimmed = text.trimmingCharacters(in: .whitespaces)
  if trimmed.isEmpty { return (nil, nil) }
  guard let number = Double(trimmed) else { return (nil, "Use a number") }
  if number < Double(range.min) || number > Double(range.max) { return (nil, "From \(range.min) to \(range.max)") }
  return (number, nil)
}

/// The site's setup writes, each the console's own.
public struct HostSettingsAPI: Sendable {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let hostID: String

  public init(api: ConsoleAPIClient, writer: FirestoreWriter, hostID: String) {
    self.api = api
    self.writer = writer
    self.hostID = hostID
  }

  private var path: [String] { ["hosts", hostID] }

  /// Tells the live site its pages changed, as every setup save does; a failure here never undoes the save.
  private func announce() async {
    _ = try? await api.request("/api/screens/revalidate", method: .post, body: jsonBody(["hostId": hostID, "entireHost": true]))
  }

  /// A settings form's save: the nested fields merged, the date stamped. A
  /// list or a card's own record replaces its field, as the console's
  /// `mergeFields` and `updateDoc` saves do.
  public func save(_ fields: [String: Any]) async throws {
    var data = fields
    data["updatedAt"] = Date()
    try await writer.merge(path, data)
    await announce()
  }

  private func theme(_ body: [String: Any?]) async throws -> JSONValue? {
    try await api.request("/api/hosts/theme", method: .post, body: jsonBody(["hostId": hostID].merging(body) { _, new in new }))
  }

  /// The editor's controls, what they show now and the built-in themes on offer.
  public func themeEditor() async throws -> (ThemeCatalog, ThemeValues, [ThemePreset]) {
    let answer = try await theme(["action": "values"])
    return (themeCatalog(of: answer?["catalog"]), themeValues(of: answer?["values"]), themePresets(of: answer?["presets"]))
  }

  /// Saves the changed controls as the site's theme edits; answers what they show now.
  public func saveTheme(_ edits: [ThemeEdit]) async throws -> ThemeValues {
    let answer = try await theme(["action": "edit", "edits": edits.map(\.body)])
    return themeValues(of: answer?["values"])
  }

  /// Switches to the default theme or a saved one (`select`).
  public func selectTheme(kind: String, id: String? = nil) async throws {
    var target: [String: Any?] = ["kind": kind]
    if let id { target["id"] = id }
    _ = try await theme(["action": "select", "target": target])
  }

  public func saveThemeAs(_ name: String) async throws { _ = try await theme(["action": "save-as", "name": name.trimmed]) }

  /// Writes the edits into the saved theme the site is on (`update`).
  public func updateSavedTheme() async throws { _ = try await theme(["action": "update"]) }

  /// Drops the edits, back to the picked theme as it was (`restore`).
  public func restoreTheme() async throws { _ = try await theme(["action": "restore"]) }

  public func renameTheme(_ id: String, name: String) async throws {
    _ = try await theme(["action": "rename", "id": id, "name": name.trimmed])
  }

  public func deleteTheme(_ id: String) async throws { _ = try await theme(["action": "delete", "id": id]) }

  /// Back to the email's default design (`versionId: null`), as Reset to default does.
  public func resetEmail(_ key: String) async throws {
    try await writer.merge(path + ["emailTemplates", key], ["versionId": NSNull()])
  }
}
