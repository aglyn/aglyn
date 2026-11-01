// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Foundation

// The logo, the dark logo and the favicon a new site is created with (AGL-4119), the console's `site-brand-files.ts`.
// The sheet holds the files, and they go into the new site's own library once it exists. The site is what the person
// asked for and these are optional, so a file that does not make it never costs them the site: they are told which,
// and where to add it.

/// The types a logo may be, with the names a file with no type is read from.
private let logoFileTypes: [(type: String, extensions: [String])] = [
  ("image/png", [".png"]), ("image/jpeg", [".jpg", ".jpeg"]), ("image/webp", [".webp"]), ("image/svg+xml", [".svg"]),
]

/// What a favicon may also be. An `.ico` is linked as it is, and never reaches a logo slot.
private let faviconFileTypes =
  logoFileTypes + [("image/x-icon", [".ico"]), ("image/vnd.microsoft.icon", [".ico"])]

/// The other spellings of a type, folded to the stored one (`normalizeImageContentType`).
private let imageTypeAliases = [
  "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "image/x-png": "image/png", "image/ico": "image/x-icon",
  "image/x-icon+xml": "image/x-icon", "image/svg": "image/svg+xml",
]

/// The content type to upload a file under, or nil for one the field does not take. Read off the file's name when the
/// device reports none, because the upload route refuses an empty type.
public func siteBrandFileType(name: String, mimeType: String, slot: String) -> String? {
  let types = slot == "favicon" ? faviconFileTypes : logoFileTypes
  let bare = (mimeType.split(separator: ";", omittingEmptySubsequences: false).first.map(String.init) ?? "")
    .trimmingCharacters(in: .whitespaces).lowercased()
  if !bare.isEmpty && bare != "application/octet-stream" {
    let reported = imageTypeAliases[bare] ?? bare
    return types.contains { $0.type == reported } ? reported : nil
  }
  let lower = name.lowercased()
  return types.first { entry in entry.extensions.contains { lower.hasSuffix($0) } }?.type
}

/// Why a field will not take this file, said on the field before anything is created, or nil when it will.
public func siteBrandFileRefusal(_ file: PickedFile, slot: String, maxBytes: Int = SiteBrandFiles.maxBytes) -> String? {
  if siteBrandFileType(name: file.name, mimeType: file.mimeType, slot: slot) == nil {
    return slot == "favicon" ? "Use a PNG, JPEG, WebP, SVG or ICO file." : "Use a PNG, JPEG, WebP or SVG file."
  }
  if file.size == 0 { return "That file is empty." }
  if file.size > maxBytes { return "That file is over \(maxBytes / (1024 * 1024)) MB." }
  return nil
}

/// The host fields a create writes; `favicon` lands on `seo.favicon`.
public struct SiteBrandFields: Equatable, Sendable {
  public var logoURL: String?
  public var logoDarkURL: String?
  public var favicon: String?

  var isEmpty: Bool { logoURL == nil && logoDarkURL == nil && favicon == nil }

  /// The fields under the route's names.
  var body: [String: String] {
    var body: [String: String] = [:]
    body["logoUrl"] = logoURL
    body["logoDarkUrl"] = logoDarkURL
    body["favicon"] = favicon
    return body
  }
}

public struct SiteBrandSaveOutcome: Equatable, Sendable {
  /// What was written; nil when nothing was.
  public let saved: SiteBrandFields?
  /// The chosen files that did not make it, in field order.
  public let missed: [String]
}

/// Uploads the files a form is holding and writes what they became, one after the other so the storage count stays
/// right. `upload` answers what the field stores. Never throws: each failure is reported in `missed`. A favicon left
/// blank is the logo, the same asset rather than a second copy, and with no logo and no favicon nothing is written.
public func saveSiteBrandFiles(
  _ files: [String: PickedFile], upload: (PickedFile, String) async throws -> String?,
  save: (SiteBrandFields) async throws -> Void
) async -> SiteBrandSaveOutcome {
  var stored: [String: String] = [:]
  var missed: [String] = []
  for slot in SiteBrandFiles.slots.map(\.slot) {
    guard let file = files[slot] else { continue }
    if let src = try? await upload(file, slot), !src.isEmpty { stored[slot] = src } else { missed.append(slot) }
  }
  let fields = SiteBrandFields(
    logoURL: stored["logo"], logoDarkURL: stored["logoDark"], favicon: stored["favicon"] ?? stored["logo"])
  if fields.isEmpty { return SiteBrandSaveOutcome(saved: nil, missed: missed) }
  do {
    try await save(fields)
    return SiteBrandSaveOutcome(saved: fields, missed: missed)
  } catch {
    // Every file is in the library, and nothing points at any of them.
    return SiteBrandSaveOutcome(saved: nil, missed: SiteBrandFiles.slots.map(\.slot).filter { files[$0] != nil })
  }
}

/// The one line that says which files did not make it, or nil when all did.
public func siteBrandMissedNotice(_ missed: [String]) -> String? {
  let nouns = SiteBrandFiles.slots.filter { missed.contains($0.slot) }.map(\.noun)
  guard let last = nouns.last else { return nil }
  let list = nouns.count > 1 ? "\(nouns.dropLast().joined(separator: ", ")) and \(last)" : last
  return "Your site is ready, but your \(list) didn’t upload. Add \(nouns.count > 1 ? "them" : "it") in Site settings."
}

/// The files a Create site sheet holds, into the new site's own library and onto the site, through the console's routes
/// (`uploadHostImage`, `saveMirroredHostFields`), awaited before the site opens.
public func saveSiteBrand(_ api: ConsoleAPIClient, hostID: String, files: [String: PickedFile]) async
  -> SiteBrandSaveOutcome
{
  let media = MediaAPI(api: api, scope: .site(hostID: hostID))
  return await saveSiteBrandFiles(files) { file, slot in
    let type = siteBrandFileType(name: file.name, mimeType: file.mimeType, slot: slot) ?? file.mimeType
    let stored = try await media.store(PickedFile(name: file.name, mimeType: type, data: file.data), folderID: nil)
    return mediaNodeSrc(url: stored.url, cdnPath: stored.cdnPath, isPrivate: nil)
  } save: { fields in
    var body = fields.body
    body["hostId"] = hostID
    _ = try await api.request("/api/hosts/sync-memberships", method: .post, body: .from(body))
  }
}
