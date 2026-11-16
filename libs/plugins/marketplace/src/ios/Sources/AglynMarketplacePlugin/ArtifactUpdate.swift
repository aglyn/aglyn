// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/*
 * Updating a COPIED listing (a component, a layout or a theme the site edited), as the console's listing page does
 * (AGL-1018): never a plain re-install, but a review of what the update would do field by field — the publisher's changes
 * that are safe to take, the site's own changes that are kept, and the fields both changed, each kept as the site's unless
 * "Take theirs" is picked — then Apply or Install as a new copy, through `/api/marketplace/update-artifact`. Ports of
 * `resolveProvenance` (artifact-provenance.ts), `describeChange` and `summarizeValue` (artifact-merge.ts), replayed from the
 * console's own cases. The Kotlin plugin's ArtifactUpdate.kt holds the same.
 */

/// The console route that previews and applies an update of a copied listing.
let artifactUpdateRoute = "/api/marketplace/update-artifact"

/// Where an installed copy came from (`resolveProvenance`): the listing and the version it was installed at.
struct ArtifactProvenance: Equatable {
  /// `recorded`, `inferred` or `unknown`.
  let state: String
  let listingID: String?
  let version: String?
  let sha256: String?
  let artifactType: String?
  let publisherOrgID: String?
  /// A base snapshot exists, so the copy can be diffed and safely updated.
  let updatable: Bool

  static let unknown = ArtifactProvenance(
    state: "unknown", listingID: nil, version: nil, sha256: nil, artifactType: nil, publisherOrgID: nil, updatable: false)
}

private func asVersion(_ value: Any?) -> String? {
  guard let value, !(value is NSNull) else { return nil }
  if let text = value as? String { return text.isEmpty ? nil : text }
  if let number = value as? NSNumber { return jsNumberString(number.doubleValue) }
  return "\(value)"
}

/// `resolveProvenance`: the full `installedFrom` stamp when it carries a hash and a type; else the legacy stamp of a
/// component (`marketplace`), a template, layout or schema (`source`), or a plugin pin (flat on the document).
func resolveProvenance(_ doc: [String: Any]?, fallbackArtifactType: String? = nil) -> ArtifactProvenance {
  guard let doc else { return .unknown }
  let stamped = doc["installedFrom"] as? [String: Any]
  if let listing = stamped?["listingId"] as? String, !listing.isEmpty,
    let sha = stamped?["sha256"] as? String, !sha.isEmpty,
    let type = stamped?["artifactType"] as? String, !type.isEmpty
  {
    return ArtifactProvenance(
      state: "recorded", listingID: listing, version: asVersion(stamped?["version"]), sha256: sha, artifactType: type,
      publisherOrgID: stamped?["publisherOrgId"] as? String, updatable: true)
  }
  let marketplace = doc["marketplace"] as? [String: Any]
  let source = doc["source"] as? [String: Any]
  let legacy: (listing: String, version: Any?, profile: String?)?
  if let listing = stamped?["listingId"] as? String, !listing.isEmpty {
    legacy = (listing, stamped?["version"], nil)
  } else if let listing = marketplace?["listingId"] as? String, !listing.isEmpty {
    legacy = (listing, marketplace?["version"], marketplace?["profileId"] as? String)
  } else if let listing = source?["listingId"] as? String, !listing.isEmpty {
    legacy = (listing, source?["version"], nil)
  } else if let listing = doc["listingId"] as? String, !listing.isEmpty {
    legacy = (listing, doc["version"], doc["profileId"] as? String)
  } else {
    legacy = nil
  }
  guard let legacy else { return .unknown }
  let pin = (doc["pluginId"] as? String).map { !$0.isEmpty } == true && (doc["sha256"] as? String).map { !$0.isEmpty } == true
  return ArtifactProvenance(
    state: pin ? "recorded" : "inferred", listingID: legacy.listing, version: asVersion(legacy.version),
    sha256: doc["sha256"] as? String, artifactType: pin ? "plugin" : fallbackArtifactType, publisherOrgID: legacy.profile,
    updatable: pin)
}

/// Whether a copy is behind its listing, as `resolveUpdateState` answers for anything but a plugin: `current`,
/// `update-available`, `ahead` or `unknown` (no version, nothing published, or versions that do not compare).
func copyUpdateState(installed: [String: Any]?, latestVersion: String?, artifactType: String) -> (state: String, installed: String?) {
  let provenance = resolveProvenance(installed, fallbackArtifactType: artifactType)
  guard installed != nil, provenance.state != "unknown", let version = provenance.version else { return ("unknown", nil) }
  guard let latestVersion, !latestVersion.isEmpty, let order = compareArtifactVersions(version, latestVersion) else {
    return ("unknown", version)
  }
  return (order == 0 ? "current" : order < 0 ? "update-available" : "ahead", version)
}

/// The listing's install button for a copied listing, as the console words it: installed and current, or a review of the
/// update (never "Update", because pressing it writes nothing).
func copyInstallLabel(state: String, installedVersion: String?, offeredVersion: String?) -> String {
  switch state {
  case "current": "Installed (v\(installedVersion ?? ""))"
  case "update-available": "Review update to v\(offeredVersion ?? "")"
  default: "Review this version"
  }
}

/// One field the update would touch.
struct ArtifactChange: Identifiable, Equatable {
  let path: String
  /// What the site has now, and what the publisher ships; nil when the field is absent on that side.
  let current: JSONValue?
  let incoming: JSONValue?
  let added: Bool
  let removed: Bool
  var id: String { path }

  init(_ json: JSONValue) {
    path = json["path"]?.stringValue ?? ""
    current = json["current"]
    incoming = json["incoming"]
    added = json["added"]?.boolValue == true
    removed = json["removed"]?.boolValue == true
  }
}

/// `describeChange`: the field's path, with the publisher's addition or removal said out loud.
func describeChange(path: String, added: Bool, removed: Bool) -> String {
  let label = path.isEmpty ? "the whole artifact" : path
  if added { return "\(label) — added by the publisher" }
  if removed { return "\(label) — removed by the publisher" }
  return label
}

/// `summarizeValue`: a one-line preview of a value for a diff row; an absent value is "—".
func summarizeValue(_ value: JSONValue?) -> String {
  guard let value else { return "—" }
  switch value {
  case .null: return "null"
  case .string(let text):
    if text.isEmpty { return "(empty)" }
    return text.count > 60 ? String(text.prefix(57)) + "…" : text
  case .array(let items): return "\(items.count) item\(items.count == 1 ? "" : "s")"
  case .object(let map):
    let keys = map.keys.sorted()
    return "{ \(keys.prefix(3).joined(separator: ", "))\(keys.count > 3 ? ", …" : "") }"
  case .bool(let flag): return flag ? "true" : "false"
  case .number(let number): return jsNumberString(number)
  }
}

/// What the route's `preview` answers: the version pair, whether the copy can be merged, and the changes by kind.
struct ArtifactUpdatePreview: Equatable {
  let installedVersion: String?
  let availableVersion: String?
  let mergeable: Bool
  let reason: String?
  let safe: [ArtifactChange]
  let kept: [ArtifactChange]
  let conflicts: [ArtifactChange]
  let unchanged: Int
  let identical: Bool
  /// A dataset schema's change: fields added, removed and retyped, and the records it holds.
  let schema: (added: Int, removed: Int, retyped: Int, additiveOnly: Bool, recordCount: Int)?

  init(_ json: JSONValue?) {
    func text(_ key: String) -> String? {
      guard let value = json?[key] else { return nil }
      if let text = value.stringValue { return text }
      return value.numberValue.map(jsNumberString)
    }
    func changes(_ key: String) -> [ArtifactChange] { json?[key]?.arrayValue?.map(ArtifactChange.init) ?? [] }
    installedVersion = text("installedVersion")
    availableVersion = text("availableVersion")
    mergeable = json?["mergeable"]?.boolValue == true
    reason = json?["reason"]?.stringValue
    safe = changes("safe")
    kept = changes("kept")
    conflicts = changes("conflicts")
    unchanged = Int(json?["unchanged"]?.numberValue ?? 0)
    identical = json?["identical"]?.boolValue == true
    schema = json?["schema"].flatMap { schema in
      guard case .object = schema else { return nil }
      return (
          schema["added"]?.arrayValue?.count ?? 0, schema["removed"]?.arrayValue?.count ?? 0,
          schema["retyped"]?.arrayValue?.count ?? 0, schema["additiveOnly"]?.boolValue == true,
          Int(schema["recordCount"]?.numberValue ?? 0)
        )
    }
  }

  static func == (a: ArtifactUpdatePreview, b: ArtifactUpdatePreview) -> Bool {
    a.installedVersion == b.installedVersion && a.availableVersion == b.availableVersion && a.mergeable == b.mergeable
      && a.safe == b.safe && a.kept == b.kept && a.conflicts == b.conflicts && a.identical == b.identical
  }

  /// Removing or retyping a schema field changes how stored records read, which the apply must confirm.
  var destructive: Bool { schema.map { !$0.additiveOnly } ?? false }

  /// The version line at the top of the review.
  var versionLine: String {
    installedVersion.map { "You have v\($0); v\(availableVersion ?? "") is available." } ?? "v\(availableVersion ?? "") is available."
  }

  /// The apply button, as the console labels it for what it does.
  func applyLabel(taken: Int) -> String {
    if identical { return "Take v\(availableVersion ?? "") (no content changes)" }
    return taken > 0 ? "Apply (\(taken) taken from publisher)" : "Apply safe changes"
  }
}

/// What a finished update says, as the console's: a new copy, a version-only bump, or what moved and what was kept.
func artifactUpdateSummary(mode: String, answer: JSONValue?) -> String {
  let version = answer?["version"].flatMap { $0.stringValue ?? $0.numberValue.map(jsNumberString) } ?? ""
  if mode == "copy" {
    return "Installed v\(version) as a new copy — your customized version is kept, no longer linked to the listing."
  }
  let applied = Int(answer?["applied"]?.numberValue ?? 0)
  let kept = Int(answer?["keptLocal"]?.numberValue ?? 0)
  let skipped = answer?["skipped"]?.arrayValue?.count ?? 0
  if applied == 0 && kept == 0 && skipped == 0 {
    return "Now on v\(version) — this version changes nothing in your copy."
  }
  return "Updated to v\(version) — \(applied) change(s) applied, \(kept) of yours kept"
    + (skipped > 0 ? ", \(skipped) conflict(s) left as yours" : "") + "."
}

/// The update route, as the signed-in member.
struct ArtifactUpdateAPI {
  let api: ConsoleAPIClient
  let hostID: String

  /// What an update would do. Writes nothing.
  func preview(listingID: String) async throws -> ArtifactUpdatePreview {
    let answer = try await api.request(
      artifactUpdateRoute, method: .post, body: JSONValue.from(["listingId": listingID, "hostId": hostID, "action": "preview"]))
    return ArtifactUpdatePreview(answer?["preview"])
  }

  /// Writes the update: `merge` takes the safe changes plus the picked conflicts, `copy` installs the new version fresh and
  /// detaches the customized one. Answers what to tell the person.
  func apply(listingID: String, mode: String, takePaths: [String] = [], confirmDestructive: Bool = false) async throws -> String {
    let answer = try await api.request(
      artifactUpdateRoute, method: .post,
      body: JSONValue.from([
        "listingId": listingID, "hostId": hostID, "action": "apply", "mode": mode, "takePaths": takePaths,
        "confirmDestructive": confirmDestructive,
      ]))
    return artifactUpdateSummary(mode: mode, answer: answer)
  }
}
