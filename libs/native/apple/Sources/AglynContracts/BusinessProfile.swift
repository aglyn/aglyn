// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A site's BUSINESS PROFILE (business-profile.ts, AGL-3661): what the business is, as everything that writes about it
 * needs to know. Most of it is already stored on the host (the SEO entity, the contact card), so the profile document holds
 * only the services, audience and tone, plus a line about the business and the area for a site whose SEO entity does not say.
 * `resolveBusinessProfile` reads the two together, field by field, with where each value came from, and
 * `businessProfileOwnerWrite` is the owner's save: every field they changed becomes theirs. Documents are plain maps, as
 * Firestore hands them out. BusinessProfileTests replays the TypeScript's own answers. The Kotlin contracts' BusinessProfile.kt.
 */

private let sourceRank = ["ai": 1, "start": 2, "owner": 3]

private func collapsed(_ value: String) -> String { value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }

private func profileText(_ value: Any?, _ max: Int) -> String {
  guard let text = value as? String else { return "" }
  let trimmed = collapsed(text).trimmingCharacters(in: .whitespacesAndNewlines)
  return String(decoding: Array(trimmed.utf16.prefix(max)), as: UTF16.self)
}

private func profileTone(_ value: Any?) -> String? { (value as? String).flatMap { ContractValues.shared.businessToneOrder.contains($0) ? $0 : nil } }

private func profileServices(_ value: Any?) -> [String] {
  let items: [Any?]
  switch value {
  case let list as [Any]: items = list
  case let text as String: items = text.components(separatedBy: CharacterSet(charactersIn: ",\n"))
  default: items = []
  }
  var seen = Set<String>()
  var kept: [String] = []
  let perItem = Int(ContractValues.shared.businessProfileMaxChars["services"] ?? 60)
  for item in items {
    let name = profileText(item, perItem)
    if name.isEmpty || !seen.insert(name.lowercased()).inserted { continue }
    kept.append(name)
    if kept.count >= ContractValues.shared.businessProfileMaxServices { break }
  }
  return kept
}

/// One field's stored value, sanitized: services a list, tone a known tone or nil, anything else a string; empty is `""`, `[]` or nil.
private func profileField(_ doc: [String: Any]?, _ field: String) -> Any? {
  switch field {
  case "services": return profileServices(doc?["services"])
  case "tone": return profileTone(doc?["tone"])
  default: return profileText(doc?[field], Int(ContractValues.shared.businessProfileMaxChars[field] ?? 200))
  }
}

private func profileEmpty(_ value: Any?) -> Bool {
  if value == nil { return true }
  if let text = value as? String { return text.isEmpty }
  if let list = value as? [Any] { return list.isEmpty }
  return false
}

private func profileEqual(_ a: Any?, _ b: Any?) -> Bool {
  switch (a, b) {
  case (nil, nil): return true
  case (let x as String, let y as String): return x == y
  case (let x as [String], let y as [String]): return x == y
  default: return false
  }
}

private func sources(of doc: [String: Any]?) -> [String: Any] { doc?["sources"] as? [String: Any] ?? [:] }

/// The source a stored, non-empty value carries; the owner's when none is recorded.
public func businessProfileSourceOf(_ doc: [String: Any]?, _ field: String) -> String? {
  if profileEmpty(profileField(doc, field)) { return nil }
  if let source = sources(of: doc)[field] as? String, sourceRank[source] != nil { return source }
  return "owner"
}

/// Every value a write may carry, sanitized; an absent field stays absent.
public func sanitizeBusinessProfileValues(_ values: [String: Any]) -> [String: Any] {
  var clean: [String: Any] = [:]
  for field in ContractValues.shared.businessProfileFieldOrder where values[field] != nil || values.keys.contains(field) {
    if let value = profileField(values, field) { clean[field] = value } else { clean[field] = NSNull() }
  }
  return clean
}

/// The document the owner's save makes: every field they changed becomes theirs, and a field they left as it was keeps the
/// source it had, so saving after correcting one line does not claim every suggestion on the card.
public func businessProfileOwnerWrite(_ current: [String: Any]?, _ edited: [String: Any]) -> [String: Any] {
  let clean = sanitizeBusinessProfileValues(edited)
  var next: [String: Any] = [:]
  var written: [String: Any] = [:]
  for field in ContractValues.shared.businessProfileFieldOrder {
    let before = profileField(current, field)
    let after: Any? = clean[field].map { $0 is NSNull ? nil : $0 } ?? (clean.keys.contains(field) ? nil : before)
    next[field] = after ?? NSNull()
    let same = profileEqual(before, after)
    if profileEmpty(after) {
      // A suggestion the owner deleted is their decision, and recorded as one, so the next prefill does not put it back.
      if !same { written[field] = "owner" } else if sources(of: current)[field] as? String == "owner" { written[field] = "owner" }
      continue
    }
    written[field] = same ? (businessProfileSourceOf(current, field) ?? "owner") : "owner"
  }
  next["sources"] = written
  return next
}

/// A resolved value and where it came from: a stored source, the site's own settings, or the workspace defaults.
public struct ResolvedBusinessField<T: Equatable & Sendable>: Equatable, Sendable {
  public let value: T
  public let origin: String
}

public struct ResolvedContact: Equatable, Sendable {
  public let email: String?
  public let phone: String?
  public let address: String?
  public let hours: String?
}

/// The picture every reader works from: each field's value and where it came from.
public struct ResolvedBusinessProfile: Equatable, Sendable {
  public let name: ResolvedBusinessField<String>?
  public let whatYouDo: ResolvedBusinessField<String>?
  public let services: ResolvedBusinessField<[String]>?
  public let serviceArea: ResolvedBusinessField<String>?
  public let audience: ResolvedBusinessField<String>?
  public let tone: ResolvedBusinessField<String>?
  public let toneNotes: ResolvedBusinessField<String>?
  /// The year the business started (AGL-4092).
  public let founded: ResolvedBusinessField<String>?
  /// The schema.org business type the SEO entity names, e.g. `Plumber`.
  public let businessType: String?
  /// Real contact details, each only where the owner entered it in the site's settings.
  public let contact: ResolvedContact
  /// The site's social and other profiles, https only.
  public let profiles: [String]
  public let logo: String?
}

/// A list of places as the SEO entity stores it, or the lines typed into the text box: distinct, trimmed, capped.
public func normalizeAreaServed(_ value: Any?) -> [String] {
  let items: [Any]
  switch value {
  case let list as [Any]: items = list
  case let text as String: items = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
  default: items = []
  }
  var seen = Set<String>()
  var areas: [String] = []
  for item in items {
    guard let text = item as? String else { continue }
    let name = String(decoding: Array(collapsed(text.trimmingCharacters(in: .whitespacesAndNewlines)).utf16.prefix(Int(ContractValues.shared.areaServedNameMaxLength))), as: UTF16.self)
    if name.isEmpty || !seen.insert(name.lowercased()).inserted { continue }
    areas.append(name)
    if areas.count >= ContractValues.shared.areaServedMax { break }
  }
  return areas
}

private func child(_ map: [String: Any]?, _ key: String) -> [String: Any]? { map?[key] as? [String: Any] }

/// The site's profile URLs: its SEO entity's `sameAs` first, then the social links its footer prints; https only, distinct.
public func siteProfileUrls(_ host: [String: Any]?) -> [String] {
  let sameAs = child(child(host, "seo"), "entity")?["sameAs"] as? [Any] ?? []
  let rendered = (child(host, "business")?["socialLinks"] as? [Any] ?? []).map { (($0 as? [String: Any])?["url"] as? String) ?? "" }
  var seen = Set<String>()
  var urls: [String] = []
  for value in sameAs + rendered {
    let text = String(decoding: Array(((value as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).utf16.prefix(800)), as: UTF16.self)
    if text.lowercased().hasPrefix("https://"), seen.insert(text).inserted { urls.append(text) }
  }
  return Array(urls.prefix(Int(ContractValues.shared.authorSameAsMax)))
}

private func addressLine(_ host: [String: Any]?) -> String {
  let parts = child(child(child(host, "seo"), "entity"), "address")
  let line = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"].map { profileText(parts?[$0], 200) }.filter { !$0.isEmpty }
    .joined(separator: ", ")
  return line.isEmpty ? profileText(child(host, "business")?["address"], 400) : line
}

private func orNil(_ text: String) -> String? { text.isEmpty ? nil : text }

/// The profile as every reader sees it, field by field: what the OWNER typed into the site's profile; what the site's own
/// settings say (the SEO entity, the display name); what the guided start or a generator stored on the site's profile; the
/// workspace defaults. Contact details, the logo and the profiles come from the site's settings only.
public func resolveBusinessProfile(host: [String: Any]?, site: [String: Any]? = nil, workspace: [String: Any]? = nil) -> ResolvedBusinessProfile {
  let entity = child(child(host, "seo"), "entity")
  let maxChars = ContractValues.shared.businessProfileMaxChars
  let fromSite: [String: Any] = [
    "whatYouDo": profileText(entity?["description"], Int(maxChars["whatYouDo"] ?? 200)),
    "serviceArea": String(decoding: Array(normalizeAreaServed(entity?["areaServed"]).joined(separator: ", ").utf16.prefix(Int(maxChars["serviceArea"] ?? 120))), as: UTF16.self),
  ]

  func resolve<T: Equatable & Sendable>(_ field: String, as type: T.Type) -> ResolvedBusinessField<T>? {
    let stored = businessProfileSourceOf(site, field)
    if stored == "owner", let value = profileField(site, field) as? T { return ResolvedBusinessField(value: value, origin: "owner") }
    if let own = fromSite[field], !profileEmpty(own), let value = own as? T { return ResolvedBusinessField(value: value, origin: "site") }
    if let stored, let value = profileField(site, field) as? T { return ResolvedBusinessField(value: value, origin: stored) }
    if businessProfileSourceOf(workspace, field) != nil, let value = profileField(workspace, field) as? T {
      return ResolvedBusinessField(value: value, origin: "workspace")
    }
    return nil
  }

  let nameText = orNil(profileText(entity?["name"], 200)) ?? profileText(host?["displayName"], 200)
  return ResolvedBusinessProfile(
    name: orNil(nameText).map { ResolvedBusinessField(value: $0, origin: "site") },
    whatYouDo: resolve("whatYouDo", as: String.self), services: resolve("services", as: [String].self),
    serviceArea: resolve("serviceArea", as: String.self), audience: resolve("audience", as: String.self),
    tone: resolve("tone", as: String.self), toneNotes: resolve("toneNotes", as: String.self),
    founded: resolve("founded", as: String.self),
    businessType: orNil(profileText(entity?["businessType"], 80)),
    contact: ResolvedContact(
      email: orNil(profileText(entity?["email"], 320)) ?? orNil(profileText(child(host, "business")?["supportEmail"], 320)),
      phone: orNil(profileText(entity?["telephone"], 64)), address: orNil(addressLine(host)), hours: orNil(profileText(entity?["openingHours"], 400))),
    profiles: siteProfileUrls(host),
    logo: orNil(profileText(host?["logoUrl"], 800)) ?? orNil(profileText(entity?["logo"], 800)))
}
