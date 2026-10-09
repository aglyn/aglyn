// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The console's plugin switchboard resolvers, ported once from
// libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts over the generated
// first-party catalog (FIRST_PARTY_PLUGINS). function-cases.generated.json
// holds the answers the TypeScript gives, and the tests replay every one.
// Lists keep the TypeScript's order: a JavaScript Set keeps insertion order.

/// The first-party plugin catalog the console's switchboards list.
public enum PluginCatalog {
  public static var plugins: [FirstPartyPlugin] { ContractValues.shared.firstPartyPlugins }

  public static func plugin(_ id: String) -> FirstPartyPlugin? { plugins.first { $0.id == id } }

  /// The catalog label, else the raw id (a marketplace listing's).
  public static func label(_ id: String) -> String { plugin(id)?.label ?? id }

  /// Every first-party plugin: what a workspace with no stored list runs.
  public static var defaultEnabled: [String] { plugins.map(\.id) }

  static var alwaysOn: [String] { plugins.filter { $0.alwaysOn == true }.map(\.id) }

  static var alwaysOnForWorkspace: [String] {
    plugins.filter { $0.alwaysOn == true || $0.alwaysOnForWorkspace == true }.map(\.id)
  }

  static var defaultOffPerSite: Set<String> { Set(plugins.filter { $0.defaultOffPerSite == true }.map(\.id)) }
}

private func unique(_ ids: [String]) -> [String] {
  var seen = Set<String>()
  return ids.filter { seen.insert($0).inserted }
}

public func isLockedOnForWorkspace(_ pluginId: String) -> Bool {
  PluginCatalog.alwaysOnForWorkspace.contains(pluginId)
}

public func isLockedOnForSite(_ pluginId: String) -> Bool { PluginCatalog.alwaysOn.contains(pluginId) }

public func isDefaultOffPerSite(_ pluginId: String) -> Bool { PluginCatalog.defaultOffPerSite.contains(pluginId) }

/// The plugins a workspace runs: its stored list plus the locked ones, or
/// every first-party plugin when it has never stored one.
public func resolveEnabledPlugins(_ configured: [String]?) -> [String] {
  guard let configured else { return PluginCatalog.defaultEnabled }
  return unique(PluginCatalog.alwaysOnForWorkspace + unique(configured))
}

/// Drops a default-off plugin the site has not opted into.
public func applyDefaultOffOptIn(_ pluginIds: [String], optedIn: [String]?) -> [String] {
  let defaultOff = PluginCatalog.defaultOffPerSite
  if defaultOff.isEmpty { return pluginIds }
  let asked = Set(optedIn ?? [])
  return pluginIds.filter { !defaultOff.contains($0) || asked.contains($0) }
}

/// Drops what a site refused, except the always-on base library.
public func subtractDisabledPlugins(_ pluginIds: [String], disabled: [String]?) -> [String] {
  guard let disabled, !disabled.isEmpty else { return pluginIds }
  let refused = Set(disabled)
  let alwaysOn = PluginCatalog.alwaysOn
  return pluginIds.filter { alwaysOn.contains($0) || !refused.contains($0) }
}

/// What runs on one site: the workspace's plugins, less a default-off one
/// the site never asked for, less what it refused.
public func resolveHostEnabledPlugins(
  orgEnabled: [String]?, hostDisabled: [String]?, hostEnabled: [String]?
) -> [String] {
  subtractDisabledPlugins(
    applyDefaultOffOptIn(resolveEnabledPlugins(orgEnabled), optedIn: hostEnabled), disabled: hostDisabled)
}

/// Why a plugin does or does not run on a site, as the console words its state.
public enum PluginSiteState: String, Sendable, CaseIterable {
  case alwaysOn = "always-on"
  case offForWorkspace = "off-for-workspace"
  case runsHere = "runs-here"
  case awaitingOptIn = "awaiting-opt-in"
  case offForSite = "off-for-site"
}

public func resolvePluginSiteState(
  orgEnabled: [String]?, hostDisabled: [String]?, hostEnabled: [String]?, pluginId: String
) -> PluginSiteState {
  if PluginCatalog.alwaysOn.contains(pluginId) { return .alwaysOn }
  if !resolveEnabledPlugins(orgEnabled).contains(pluginId) { return .offForWorkspace }
  if resolveHostEnabledPlugins(orgEnabled: orgEnabled, hostDisabled: hostDisabled, hostEnabled: hostEnabled)
    .contains(pluginId)
  {
    return .runsHere
  }
  let denied = hostDisabled?.contains(pluginId) ?? false
  return !denied && isDefaultOffPerSite(pluginId) ? .awaitingOptIn : .offForSite
}

private func dependencyEdges() -> (dependents: [String: [String]], requires: [String: [String]]) {
  var dependents: [String: [String]] = [:]
  var requires: [String: [String]] = [:]
  for plugin in PluginCatalog.plugins {
    for required in plugin.requires ?? [] {
      dependents[required, default: []].append(plugin.id)
      requires[plugin.id, default: []].append(required)
    }
  }
  return (dependents, requires)
}

/// The plugins this one needs on.
public func pluginRequirements(_ pluginId: String) -> [String] { dependencyEdges().requires[pluginId] ?? [] }

/// The plugins that need this one on.
public func pluginDependents(_ pluginId: String) -> [String] { dependencyEdges().dependents[pluginId] ?? [] }

/// The enabled plugins switching this one off would strand, breadth first,
/// as the console's confirmation lists them.
public func resolveDisableCascade(_ pluginId: String, enabled: [String]) -> [String] {
  let on = Set(enabled)
  let dependents = dependencyEdges().dependents
  var seen: Set<String> = [pluginId]
  var cascade: [String] = []
  var queue = [pluginId]
  while !queue.isEmpty {
    let current = queue.removeFirst()
    for dependent in dependents[current] ?? [] where !seen.contains(dependent) {
      seen.insert(dependent)
      if on.contains(dependent) { cascade.append(dependent) }
      queue.append(dependent)
    }
  }
  return cascade
}

/// A site's two plugin lists after switching `pluginIds` on or off, as the
/// console's site switchboard writes them: a default-off plugin records
/// consent in `enabledPlugins` (and turning it on also stops refusing it);
/// every other plugin records refusal in `disabledPlugins`.
public func applySitePluginSwitch(
  disabled: [String], optedIn: [String], pluginIds: [String], on: Bool
) -> (disabled: [String], optedIn: [String]) {
  var disabled = disabled
  var optedIn = optedIn
  for pluginId in pluginIds {
    if isDefaultOffPerSite(pluginId) {
      if on {
        if !optedIn.contains(pluginId) { optedIn.append(pluginId) }
        disabled.removeAll { $0 == pluginId }
      } else {
        optedIn.removeAll { $0 == pluginId }
      }
      continue
    }
    if on {
      disabled.removeAll { $0 == pluginId }
    } else if !disabled.contains(pluginId) {
      disabled.append(pluginId)
    }
  }
  return (disabled, optedIn)
}
