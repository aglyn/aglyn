// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * What a plugin's page says about its installs: the version comparison, the update status, the org-wide picture of
 * one listing's pins, which sites an uninstall touches, and the sentences the plugin pages and their dialogs say about
 * them. Ports of marketplace-catalog.ts (the console's own, pure), each replayed from function-cases.generated.json by
 * MarketplaceTests; the Kotlin plugin's PluginInstalls.kt holds the same ports.
 */

// MARK: Versions

/// A version as the console's `String(value)` reads it: a string as it is, a number without a trailing `.0`, nothing for the rest.
func versionText(_ value: Any?) -> String? {
  guard let value, !(value is NSNull) else { return nil }
  if let text = value as? String { return text.isEmpty ? nil : text }
  if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { return jsNumberString(number.doubleValue) }
  return nil
}

/// Orders two artifact versions (`compareArtifactVersions`): dotted whole numbers, nil when either is missing or neither parses.
func compareArtifactVersions(_ a: String?, _ b: String?) -> Int? {
  guard let left = a, let right = b, !left.isEmpty, !right.isEmpty else { return nil }
  if left == right { return 0 }
  func parse(_ value: String) -> [Int]? {
    let parts = value.split(separator: ".", omittingEmptySubsequences: false)
    var numbers: [Int] = []
    for part in parts {
      guard !part.isEmpty, part.allSatisfy({ $0 >= "0" && $0 <= "9" }), let number = Int(part) else { return nil }
      numbers.append(number)
    }
    return numbers.isEmpty ? nil : numbers
  }
  guard let leftParts = parse(left), let rightParts = parse(right) else { return nil }
  for index in 0..<max(leftParts.count, rightParts.count) {
    let one = index < leftParts.count ? leftParts[index] : 0
    let two = index < rightParts.count ? rightParts[index] : 0
    if one < two { return -1 }
    if one > two { return 1 }
  }
  return 0
}

enum UpdateState: String, Equatable {
  case current
  case updateAvailable = "update-available"
  case ahead
  case unknown
}

enum UnknownReason: String, Equatable {
  case noProvenance = "no-provenance"
  case nothingPublished = "nothing-published"
  case incomparable
}

/// Whether an installed plugin is still what the publisher ships (`UpdateStatus`).
struct UpdateStatus: Equatable {
  var state: UpdateState
  var installedVersion: String?
  var availableVersion: String?
  var unknownReason: UnknownReason?

  static let unknown = UpdateStatus(state: .unknown, installedVersion: nil, availableVersion: nil, unknownReason: .noProvenance)
}

/// One sentence describing an update state (`updateStateLabel`).
func updateStateLabel(_ status: UpdateStatus) -> String {
  switch status.state {
  case .updateAvailable: "You have v\(status.installedVersion ?? "null") · v\(status.availableVersion ?? "null") available"
  case .current: "Up to date · v\(status.installedVersion ?? "null")"
  case .ahead: "You have v\(status.installedVersion ?? "null"), newer than the published v\(status.availableVersion ?? "null")"
  case .unknown:
    switch status.unknownReason {
    case .nothingPublished: "No published version to compare against"
    case .incomparable: "You have v\(status.installedVersion ?? "null"); v\(status.availableVersion ?? "null") cannot be ordered against it"
    default: "Installed before update tracking — version unknown"
    }
  }
}

/// What a listing offers right now (`pluginOfferedVersion`): the newest approved version, unless a revocation has stopped it.
func pluginOfferedVersion(latestApprovedVersion: String?, revoked: Revoked?) -> String? {
  guard let offered = latestApprovedVersion, !offered.isEmpty else { return nil }
  switch revoked {
  case .all?: return nil
  case .versions(let versions)?: return versions.contains(offered) ? nil : offered
  case nil: return offered
  }
}

/// The versions a revocation (`revocations/{listingId}`) stops.
enum Revoked: Equatable {
  case all
  case versions([String])

  init?(_ data: [String: Any]?) {
    guard let versions = data?["versions"] else { return nil }
    if let text = versions as? String { self = text == "all" ? .all : .versions([]) } else if let list = versions as? [Any] { self = .versions(list.compactMap { $0 as? String }) } else {
      return nil
    }
  }
}

/// The pin fields an update comparison reads, in every shape the install routes have written (`UpdateComparablePin`).
struct UpdateComparablePin: Equatable {
  var version: String?
  var listingID: String?
  var installedFrom: (listingID: String?, version: String?)?
  var marketplace: (listingID: String?, version: String?)?
  var source: (listingID: String?, version: String?)?

  init(_ data: [String: Any]) {
    func link(_ key: String) -> (listingID: String?, version: String?)? {
      guard let value = data[key] as? [String: Any] else { return nil }
      return (value["listingId"] as? String, versionText(value["version"]))
    }
    version = versionText(data["version"])
    listingID = data["listingId"] as? String
    installedFrom = link("installedFrom")
    marketplace = link("marketplace")
    source = link("source")
  }

  static func == (lhs: UpdateComparablePin, rhs: UpdateComparablePin) -> Bool {
    lhs.version == rhs.version && lhs.listingID == rhs.listingID && lhs.installedFrom?.version == rhs.installedFrom?.version
      && lhs.marketplace?.version == rhs.marketplace?.version && lhs.source?.version == rhs.source?.version
  }
}

/// Whether the installed plugin is still what the publisher ships (`pluginUpdateStatus`).
func pluginUpdateStatus(pin: UpdateComparablePin?, offered: String?) -> UpdateStatus {
  guard let pin else { return .unknown }
  let recorded: String?
  if let from = pin.installedFrom, let id = from.listingID, !id.isEmpty {
    recorded = from.version
  } else if let from = pin.marketplace, let id = from.listingID, !id.isEmpty {
    recorded = from.version
  } else if let from = pin.source, let id = from.listingID, !id.isEmpty {
    recorded = from.version
  } else if let id = pin.listingID, !id.isEmpty {
    recorded = pin.version
  } else {
    recorded = nil
  }
  guard let installed = recorded, !installed.isEmpty else { return .unknown }
  guard let available = offered, !available.isEmpty else {
    return UpdateStatus(state: .unknown, installedVersion: installed, availableVersion: nil, unknownReason: .nothingPublished)
  }
  guard let order = compareArtifactVersions(installed, available) else {
    return UpdateStatus(state: .unknown, installedVersion: installed, availableVersion: available, unknownReason: .incomparable)
  }
  return UpdateStatus(state: order == 0 ? .current : (order < 0 ? .updateAvailable : .ahead), installedVersion: installed, availableVersion: available)
}

// MARK: The org-wide picture

/// A site of the workspace, as the install picture names it.
struct SiteChoice: Equatable, Identifiable {
  let id: String
  let label: String
}

/// One site's slice of an org-scope install picture (`OrgInstallSite`).
struct OrgInstallSite: Equatable, Identifiable {
  let hostID: String
  let label: String
  /// The version that actually runs here, from the effective pin.
  let version: String?
  /// Where that pin lives: a host pin shadows the org one, as the loader does.
  let pinnedBy: InstallTarget
  /// This site has its own pin on top of an org pin.
  let shadowed: Bool
  var id: String { hostID }
}

/// The whole org's install picture for one listing (`OrgInstallSummary`).
struct OrgInstallSummary: Equatable {
  var orgWide: Bool
  var orgVersion: String?
  var sites: [OrgInstallSite]
  var hostPinnedIDs: [String]
  var availableHostIDs: [String]
  var installedAnywhere: Bool
}

/// A pin's version, or nothing for a site with no pin: `pins[host]` is nil, or a pin with or without a version.
struct PinVersion: Equatable {
  let version: String?
}

func resolveOrgInstallSummary(hosts: [SiteChoice], hostPins: [String: PinVersion], orgPin: PinVersion?) -> OrgInstallSummary {
  let orgVersion = orgPin?.version
  var sites: [OrgInstallSite] = []
  var hostPinned: [String] = []
  var available: [String] = []
  for host in hosts {
    let hostPin = hostPins[host.id]
    if hostPin != nil { hostPinned.append(host.id) }
    if hostPin == nil, orgPin == nil {
      available.append(host.id)
      continue
    }
    sites.append(
      OrgInstallSite(
        hostID: host.id, label: host.label, version: hostPin?.version ?? orgVersion, pinnedBy: hostPin != nil ? .host : .org,
        shadowed: hostPin != nil && orgPin != nil))
  }
  return OrgInstallSummary(
    orgWide: orgPin != nil, orgVersion: orgVersion, sites: sites, hostPinnedIDs: hostPinned, availableHostIDs: available,
    installedAnywhere: orgPin != nil || !hostPinned.isEmpty)
}

/// One site an uninstall would touch, and whether it really loses the plugin (`UninstallTarget`).
struct UninstallTarget: Equatable {
  let hostID: String
  let label: String
  let stillCovered: Bool
}

func resolveUninstallTargets(_ install: OrgInstallSummary, scope: InstallTarget, hostID: String? = nil) -> [UninstallTarget] {
  if scope == .host {
    guard let site = install.sites.first(where: { $0.hostID == hostID }) else { return [] }
    return [UninstallTarget(hostID: site.hostID, label: site.label, stillCovered: install.orgWide)]
  }
  return install.sites.map { UninstallTarget(hostID: $0.hostID, label: $0.label, stillCovered: $0.pinnedBy == .host) }
}

/// The sites whose running version is behind the one on offer (`staleSites`).
func staleSites(_ sites: [OrgInstallSite], latestVersion: String?) -> [OrgInstallSite] {
  sites.filter { (compareArtifactVersions($0.version, latestVersion) ?? 0) < 0 }
}

/// What "Where it runs" opens with (`pluginSiteSetSummary`).
func pluginSiteSetSummary(_ install: OrgInstallSummary, siteCount: Int) -> String {
  install.orgWide
    ? "Installed for the whole organization (v\(install.orgVersion ?? "null")) — every site, including ones you add later."
    : "Installed on \(install.sites.count) of \(siteCount) sites."
}

/// What the update confirmation says (`pluginUpdatePrompt`).
struct PluginUpdatePrompt: Equatable {
  let title: String
  let body: String
  let others: String?
  let note: String
}

func pluginUpdatePrompt(name: String, latestVersion: String, label: String, singleSite: Bool) -> PluginUpdatePrompt {
  PluginUpdatePrompt(
    title: "Update to v\(latestVersion)?",
    body: "\(name) moves from the version running now to v\(latestVersion) on \(label).",
    others: singleSite ? "Other sites stay on the version they are running." : nil,
    note: "Pins only move forward — there is no going back to the previous version from here.")
}

/// What the bulk update button is called and aims at (`pluginUpdateAll`); `hostIDs` is nil for the one org-wide pin.
struct PluginUpdateAll: Equatable {
  let label: String
  let target: String
  let hostIDs: [String]?
}

func pluginUpdateAll(_ install: OrgInstallSummary, stale: [OrgInstallSite], latestVersion: String) -> PluginUpdateAll {
  PluginUpdateAll(
    label: install.orgWide ? "Update to v\(latestVersion)" : "Update all \(stale.count) to v\(latestVersion)",
    target: install.orgWide ? "every site in this organization" : "\(stale.count) site\(stale.count == 1 ? "" : "s")",
    hostIDs: install.orgWide ? nil : stale.map(\.hostID))
}

/// The notice above an org-wide update (`PLUGIN_ORG_WIDE_UPDATE_NOTE`).
let pluginOrgWideUpdateNote =
  "This is one organization-wide pin, so updating moves every site at once. To take a version on one site first, install per site instead."

// MARK: The uninstall dialog

struct UninstallPlacement: Equatable {
  let type: String
  let name: String
  let count: Int
}

struct UninstallImpactSite: Equatable {
  let label: String
  let stillCovered: Bool
  let placements: [UninstallPlacement]
  let affectedScreens: Int
}

/// What `/api/hosts/plugin-impact` answers (`UninstallImpact`).
struct UninstallImpact: Equatable {
  let sites: [UninstallImpactSite]
  let losingSites: Int
  let affectedScreens: Int
  let truncated: Bool

  init?(_ value: JSONValue?) {
    guard case .object? = value else { return nil }
    sites = (value?["sites"]?.arrayValue ?? []).compactMap { site in
      guard let label = site["label"]?.stringValue else { return nil }
      return UninstallImpactSite(
        label: label, stillCovered: site["stillCovered"]?.boolValue == true,
        placements: (site["placements"]?.arrayValue ?? []).compactMap { place in
          guard let type = place["type"]?.stringValue, let name = place["name"]?.stringValue else { return nil }
          return UninstallPlacement(type: type, name: name, count: Int(place["count"]?.numberValue ?? 1))
        },
        affectedScreens: Int(site["affectedScreens"]?.numberValue ?? 0))
    }
    losingSites = Int(value?["losingSites"]?.numberValue ?? 0)
    affectedScreens = Int(value?["affectedScreens"]?.numberValue ?? 0)
    truncated = value?["truncated"]?.boolValue == true
  }

  init(sites: [UninstallImpactSite], losingSites: Int, affectedScreens: Int, truncated: Bool) {
    self.sites = sites
    self.losingSites = losingSites
    self.affectedScreens = affectedScreens
    self.truncated = truncated
  }
}

/// The word typed to confirm an uninstall that breaks pages, or whose impact could not be checked.
let uninstallAcknowledgement = "UNINSTALL"

struct UninstallAlert: Equatable {
  let tone: String
  let text: String
}

struct UninstallSiteView: Equatable {
  let label: String
  let pages: String
  let chips: [String]
}

/// What the uninstall dialog shows (`uninstallImpactView`).
struct UninstallImpactView: Equatable {
  let title: String
  let confirmLabel: String
  let scanning: Bool
  let alerts: [UninstallAlert]
  let sites: [UninstallSiteView]
  let note: String?
  let needsAcknowledgement: Bool
}

func uninstallImpactView(
  name: String, scope: InstallTarget, pluginID: String, targets: [UninstallTarget], impact: UninstallImpact?, failed: Bool
) -> UninstallImpactView {
  let losing = targets.filter { !$0.stillCovered }
  let covered = targets.filter(\.stillCovered)
  let scanning = !pluginID.isEmpty && !losing.isEmpty && impact == nil && !failed
  let affected = impact?.affectedScreens ?? 0
  let unknown = failed || (pluginID.isEmpty && !losing.isEmpty)
  var alerts: [UninstallAlert] = []
  if unknown, !scanning {
    alerts.append(
      UninstallAlert(
        tone: "warning",
        text: !pluginID.isEmpty
          ? "The impact check could not run, so this cannot say what would stop working. Nothing here means \"nothing breaks\"."
          : "This listing records no plugin id, so its placements cannot be found. Pages using it may stop rendering it."))
  }
  if !scanning, !unknown, affected > 0 {
    let sites = impact?.losingSites ?? losing.count
    alerts.append(
      UninstallAlert(
        tone: "error",
        text:
          "Removes \(name) from \(sites) site\(sites == 1 ? "" : "s"); \(impact?.truncated == true ? "at least " : "")\(affected) published page\(affected == 1 ? "" : "s") place\(affected == 1 ? "s" : "") it and will stop rendering it."
      ))
  }
  if !scanning, !unknown, affected == 0, !losing.isEmpty {
    alerts.append(UninstallAlert(tone: "info", text: "No published page places this plugin, so nothing visitors can see changes."))
  }
  if !covered.isEmpty {
    let text =
      covered.count == targets.count
      ? "The plugin keeps running on \(covered.count == 1 ? "this site" : "all \(covered.count) of these sites"), because another install still covers \(covered.count == 1 ? "it" : "them"). Only which version is in use changes."
      : "\(covered.count) of these sites keep the plugin — \(covered.map(\.label).joined(separator: ", ")) — because another install still covers them."
    alerts.append(UninstallAlert(tone: "info", text: text))
  }
  let nouns = ["screen": "page", "layout": "layout", "component": "component"]
  let sites = (impact?.sites ?? []).filter { !$0.stillCovered && !$0.placements.isEmpty }.map { site in
    UninstallSiteView(
      label: site.label, pages: "\(site.affectedScreens) published page\(site.affectedScreens == 1 ? "" : "s") affected",
      chips: site.placements.prefix(12).map { "\(nouns[$0.type] ?? $0.type): \($0.name)\($0.count > 1 ? " ×\($0.count)" : "")" }
        + (site.placements.count > 12 ? ["+\(site.placements.count - 12) more"] : []))
  }
  return UninstallImpactView(
    title: scope == .org ? "Uninstall \(name) across the organization?" : "Remove \(name) from this site?",
    confirmLabel: scope == .org ? "Uninstall org-wide" : "Remove", scanning: scanning, alerts: alerts, sites: sites,
    note: !scanning && !losing.isEmpty
      ? "Uninstalling removes the install only. The plugin’s settings and any data it stored are kept, and installing it again restores the pages that place it."
      : nil,
    needsAcknowledgement: !scanning && (affected > 0 || unknown))
}

// MARK: An install run

/// What a run of installs says once it is done (`installPlanOutcome`).
struct InstallPlanOutcome: Equatable {
  let tone: String
  let text: String
}

func installPlanOutcome(
  name: String, installed: Int, errors: [String], orgWide: Bool, updating: Bool, version: String?, saved: Bool = false
) -> InstallPlanOutcome {
  let noun = updating ? "Updated" : (saved ? "Saved" : "Installed")
  let toVersion = updating && version != nil ? " to v\(version ?? "")" : ""
  if installed > 0, errors.isEmpty {
    return InstallPlanOutcome(
      tone: "success",
      text: orgWide
        ? "\(noun) \"\(name)\"\(toVersion) for the whole organization"
        : "\(noun) \"\(name)\"\(toVersion) on \(installed) site\(installed == 1 ? "" : "s")")
  }
  if installed > 0 {
    return InstallPlanOutcome(tone: "warning", text: "\(noun) on \(installed) site(s); \(errors.count) failed — \(errors[0])")
  }
  return InstallPlanOutcome(tone: "error", text: errors.first ?? "Install failed")
}

/// The row of the plugins list for one install (`installedPluginCaption`).
func installedPluginCaption(version: String?, orgWide: Bool, siteLabels: [String]) -> String {
  "v\(version ?? "undefined") · " + (orgWide ? "every site in this organization" : (siteLabels.count == 1 ? siteLabels[0] : "\(siteLabels.count) sites"))
}

// MARK: A marketplace plugin's settings, from its manifest

/// A stored value as JSON, keeping a number a number (`1` is not `true`) and a boolean a boolean.
func manifestJSON(_ value: Any?) -> JSONValue {
  switch value {
  case nil, is NSNull: .null
  case let text as String: .string(text)
  case let number as NSNumber: CFGetTypeID(number) == CFBooleanGetTypeID() ? .bool(number.boolValue) : .number(number.doubleValue)
  case let list as [Any]: .array(list.map { manifestJSON($0) })
  case let map as [String: Any]: .object(map.mapValues { manifestJSON($0) })
  default: .null
  }
}

/// A field a manifest declares for the plugin's settings (`ManifestConfigField`).
struct ManifestSettingsField: Equatable {
  let key: String
  let label: String
  let type: String
  let description: String?
  let options: [(value: String, label: String)]?
  let min: Double?
  let max: Double?

  static func == (lhs: ManifestSettingsField, rhs: ManifestSettingsField) -> Bool {
    lhs.key == rhs.key && lhs.label == rhs.label && lhs.type == rhs.type && lhs.description == rhs.description && lhs.min == rhs.min
      && lhs.max == rhs.max && (lhs.options ?? []).map { [$0.value, $0.label] } == (rhs.options ?? []).map { [$0.value, $0.label] }
  }
}

private let manifestConfigFieldLimit = 50

/// A stored or declared value as its field takes it (`coerceManifestConfigValue`), else `fallback`.
private func coerceManifestConfigValue(_ field: ManifestSettingsField, _ raw: JSONValue?, _ fallback: JSONValue) -> JSONValue {
  switch field.type {
  case "boolean":
    if case .bool? = raw { return raw! }
    return fallback
  case "number":
    guard case .number(let value)? = raw, value.isFinite else { return fallback }
    if let min = field.min, value < min { return .number(min) }
    if let max = field.max, value > max { return .number(max) }
    return .number(value)
  case "select":
    if case .string(let value)? = raw, field.options?.contains(where: { $0.value == value }) == true { return raw! }
    return fallback
  default:
    if case .string? = raw { return raw! }
    return fallback
  }
}

/// The fields a plugin's manifest declares for its settings, and the values they start from (`manifestSettingsFields`).
func manifestSettingsFields(_ manifest: JSONValue?) -> (fields: [ManifestSettingsField], defaults: [String: JSONValue])? {
  guard let declared = manifest?["config"], case .array(let rawFields)? = declared["fields"] else { return nil }
  var seen = Set<String>()
  var fields: [ManifestSettingsField] = []
  for raw in rawFields {
    if fields.count >= manifestConfigFieldLimit { break }
    guard case .object(let entry) = raw else { continue }
    let key = entry["key"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if key.isEmpty || seen.contains(key) { continue }
    let type: String
    switch entry["type"] {
    case .string(let text)?: type = text
    case nil, .null?: type = "string"
    default: continue
    }
    if !["string", "number", "boolean", "select"].contains(type) { continue }
    var options: [(value: String, label: String)]?
    if case .array(let listed)? = entry["options"] {
      options = listed.compactMap { option in
        guard let value = option["value"]?.stringValue, let label = option["label"]?.stringValue else { return nil }
        return (value, label)
      }
    }
    if type == "select", options?.isEmpty != false { continue }
    seen.insert(key)
    let label = entry["label"]?.stringValue.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : String($0.prefix(120)) } ?? key
    fields.append(
      ManifestSettingsField(
        key: key, label: label, type: type, description: entry["description"]?.stringValue.map { String($0.prefix(400)) }, options: options,
        min: entry["min"]?.numberValue, max: entry["max"]?.numberValue))
  }
  if fields.isEmpty { return nil }
  let supplied = declared["defaults"]
  var defaults: [String: JSONValue] = [:]
  for field in fields {
    let empty: JSONValue
    switch field.type {
    case "boolean": empty = .bool(false)
    case "number": empty = .number(field.min ?? 0)
    case "select": empty = .string(field.options?.first?.value ?? "")
    default: empty = .string("")
    }
    defaults[field.key] = coerceManifestConfigValue(field, supplied?[field.key], empty)
  }
  return (fields, defaults)
}

/// The workspace-settings screen of a marketplace plugin, as a native screen spec (`manifestSettingsScreen`); nil for a plugin that declares no settings.
func manifestSettingsScreen(pluginID: String, label: String, manifest: JSONValue?) -> JSONValue? {
  guard !pluginID.isEmpty, let schema = manifestSettingsFields(manifest) else { return nil }
  let kinds = ["string": "text", "number": "number", "boolean": "toggle", "select": "select"]
  let fields: [JSONValue] = schema.fields.map { field in
    var out: [String: JSONValue] = [
      "key": .string(field.key), "label": .string(field.label), "kind": .string(kinds[field.type] ?? "text"),
      "initial": .string("{item.\(field.key) ?? const.defaults.\(field.key)}"),
    ]
    if field.type == "select" {
      out["options"] = .array((field.options ?? []).map { .object(["value": .string($0.value), "label": .string($0.label)]) })
    }
    let band = field.type == "number" && (field.min != nil || field.max != nil)
      ? "Between \(field.min.map { jsNumberString($0) } ?? "any") and \(field.max.map { jsNumberString($0) } ?? "any")." : ""
    let help = [field.description, band].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    if !help.isEmpty { out["help"] = .string(help) }
    return .object(out)
  }
  var written: [String: JSONValue] = Dictionary(uniqueKeysWithValues: schema.fields.map { ($0.key, JSONValue.string("{form.\($0.key)}")) })
  written["updatedBy"] = .string("{user.uid}")
  let doc = "orgs/{org.id}/pluginSettings/\(pluginID)"
  return .object([
    "id": .string("marketplace.pluginSettings.\(pluginID)"),
    "title": .string("\(label) settings"),
    "subtitle": .string("How \(label) behaves for this workspace"),
    "icon": "gearshape|settings",
    "scope": "org",
    "requires": "org.manager",
    "constants": .object(["defaults": .object(schema.defaults)]),
    "load": .object(["settings": .object(["doc": .string(doc), "optional": .bool(true)])]),
    "blocks": .array([
      .object([
        "type": "form", "id": "settings", "object": "data.settings", "footer": "A site can override these on its own plugin page.",
        "fields": .array(fields),
        "submit": .object([
          "label": "Save settings", "write": .object(["doc": .string(doc), "fields": .object(written)]), "success": "Settings saved",
        ]),
      ])
    ]),
  ])
}
