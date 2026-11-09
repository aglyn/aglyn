// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * Where a built-in plugin runs across a workspace's sites (AGL-4047), as the console's plugin-site-exclusions.ts has
 * it: on every site, or on every site except the ones whose `disabledPlugins` names it. The choice is the sites' own
 * lists, so a site left out can switch it back on for itself, and a new site gets it. The planner says which sites'
 * lists a choice rewrites, or why it can't be made. The Kotlin kit's PluginRunsOn.kt.
 */

/// One of the workspace's sites, with the lists that decide what runs there.
public struct PluginSiteEntry: Equatable, Sendable {
  public let id: String
  public let disabledPlugins: [String]?
  public let enabledPlugins: [String]?

  public init(id: String, disabledPlugins: [String]? = nil, enabledPlugins: [String]? = nil) {
    self.id = id
    self.disabledPlugins = disabledPlugins
    self.enabledPlugins = enabledPlugins
  }
}

/// Where a plugin runs: every site, or every site except some.
public enum PluginRunsOn: Equatable, Sendable {
  case all
  case allExcept(exceptHostIDs: [String])

  /// The choice as `/api/orgs/plugin-sites` reads it.
  public var wire: [String: Any] {
    switch self {
    case .all: return ["mode": "all"]
    case .allExcept(let ids): return ["mode": "allExcept", "exceptHostIds": ids]
    }
  }
}

/// Whether a site's own list leaves the plugin out (`siteLeavesOutPlugin`).
public func siteLeavesOutPlugin(_ site: PluginSiteEntry?, _ pluginID: String) -> Bool {
  site?.disabledPlugins?.contains(pluginID) == true
}

/// Where a plugin runs today, read off the sites' lists (`pluginRunsOnOf`).
public func pluginRunsOnOf(_ pluginID: String, sites: [PluginSiteEntry]) -> PluginRunsOn {
  let except = sites.filter { siteLeavesOutPlugin($0, pluginID) }.map(\.id)
  return except.isEmpty ? .all : .allExcept(exceptHostIDs: except)
}

private func nextDisabled(_ site: PluginSiteEntry, _ pluginID: String, leaveOut: Bool) -> [String]? {
  let current = site.disabledPlugins ?? []
  if leaveOut == siteLeavesOutPlugin(site, pluginID) { return nil }
  return leaveOut ? current + [pluginID] : current.filter { $0 != pluginID }
}

/// One site's list as a choice rewrites it.
public struct PluginSiteWrite: Equatable, Sendable {
  public let hostID: String
  public let disabledPlugins: [String]
  public let leftOut: Bool
}

/// A plugin a site would still run without one it needs.
public struct PluginSiteStranding: Equatable, Sendable {
  public let hostID: String
  public let pluginID: String
  public let missing: [String]
}

/// The writes a choice makes, or why it can't be made (`planPluginRunsOn`).
public struct PluginRunsOnPlan: Equatable, Sendable {
  public let writes: [PluginSiteWrite]?
  public let problem: String?
  public let stranded: [PluginSiteStranding]
}

/// The plugins on that run without one they need (`strandedDependents`).
public func strandedDependents(_ enabledIDs: [String]) -> [(pluginID: String, missing: [String])] {
  let enabled = Set(enabledIDs)
  let known = Set(PluginCatalog.plugins.map(\.id)).union(enabled)
  var seen = Set<String>()
  var out: [(pluginID: String, missing: [String])] = []
  for pluginID in enabledIDs where seen.insert(pluginID).inserted {
    let missing = pluginRequirements(pluginID).filter { known.contains($0) && !enabled.contains($0) }
    if !missing.isEmpty { out.append((pluginID, missing)) }
  }
  return out
}

public func planPluginRunsOn(
  pluginID: String, choice: PluginRunsOn, orgEnabled: [String]?, sites: [PluginSiteEntry],
  siteName: (String) -> String = { $0 }
) -> PluginRunsOnPlan {
  func refuse(_ problem: String, _ stranded: [PluginSiteStranding] = []) -> PluginRunsOnPlan {
    PluginRunsOnPlan(writes: nil, problem: problem, stranded: stranded)
  }
  let label = PluginCatalog.label(pluginID)
  if isLockedOnForSite(pluginID) {
    return refuse("\(label) runs on every site, because sites are built out of it, so it can’t be left out.")
  }
  if !resolveEnabledPlugins(orgEnabled).contains(pluginID) {
    return refuse("\(label) is switched off for this workspace, so it runs on no site. Switch it on first.")
  }
  let siteIDs = sites.map(\.id)
  var except: [String] = []
  if case .allExcept(let ids) = choice {
    for id in ids where siteIDs.contains(id) && !except.contains(id) { except.append(id) }
    if except.isEmpty { return refuse("Choose at least one site to leave out, or choose All sites.") }
    if except.count == siteIDs.count {
      return refuse("Keep at least one site in. To stop \(label) on every site, switch it off for the workspace.")
    }
  }
  var writes: [PluginSiteWrite] = []
  var stranded: [PluginSiteStranding] = []
  for site in sites {
    let leaveOut = except.contains(site.id)
    guard let disabled = nextDisabled(site, pluginID, leaveOut: leaveOut) else { continue }
    if leaveOut {
      let before = Set(
        strandedDependents(
          resolveHostEnabledPlugins(orgEnabled: orgEnabled, hostDisabled: site.disabledPlugins, hostEnabled: site.enabledPlugins)
        ).map(\.pluginID))
      let after = strandedDependents(
        resolveHostEnabledPlugins(orgEnabled: orgEnabled, hostDisabled: disabled, hostEnabled: site.enabledPlugins))
      for entry in after where !before.contains(entry.pluginID) {
        stranded.append(PluginSiteStranding(hostID: site.id, pluginID: entry.pluginID, missing: entry.missing))
      }
    }
    writes.append(PluginSiteWrite(hostID: site.id, disabledPlugins: disabled, leftOut: leaveOut))
  }
  if !stranded.isEmpty {
    let one = stranded.count == 1
    let sentences = stranded.map { entry in
      "\(PluginCatalog.label(entry.pluginID)) on \(siteName(entry.hostID)) needs \(entry.missing.map(PluginCatalog.label).joined(separator: " and "))"
    }.joined(separator: "; ")
    return refuse(
      "\(sentences). Switch \(one ? "it" : "them") off on \(one ? "that site" : "those sites") first, or keep "
        + "\(one ? "the site" : "those sites") in.",
      stranded)
  }
  return PluginRunsOnPlan(writes: writes, problem: nil, stranded: [])
}

/// What a default-off plugin's Runs on says beside it (`pluginRunsOnOptInNote`).
public func pluginRunsOnOptInNote(_ pluginID: String) -> String? {
  isDefaultOffPerSite(pluginID)
    ? "\(PluginCatalog.label(pluginID)) still runs only on the sites that turned it on. Leaving a site out here keeps it off there even if that site turned it on."
    : nil
}
