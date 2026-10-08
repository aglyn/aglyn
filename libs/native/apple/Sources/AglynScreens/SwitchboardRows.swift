// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/// The plugin switchboard as rows a spec draws: a `{ "switchboard": "org" }`
/// or `"site"` load. It reads the same documents the console's switchboards
/// read (`orgs/{org}`, and `hosts/{site}` for a site) and resolves them with
/// the ported enabled-plugins resolvers, so each row carries what it shows
/// (on, locked, the site state, what switching it off strands) and the exact
/// lists its switch writes: the workspace list sent to `/api/orgs/settings`,
/// or the site's `disabledPlugins` and `enabledPlugins` merged into the host
/// document under the rules.
enum SwitchboardRows {
  static func stringList(_ value: JSONValue?) -> [String]? {
    guard case .array(let items)? = value else { return nil }
    return items.compactMap(\.stringValue)
  }

  private static func labels(_ ids: [String]) -> JSONValue {
    .string(ids.map(PluginCatalog.label).joined(separator: ", "))
  }

  private static func strings(_ ids: [String]) -> JSONValue { .array(ids.map(JSONValue.string)) }

  private static func base(_ plugin: FirstPartyPlugin) -> [String: JSONValue] {
    let requires = pluginRequirements(plugin.id)
    let dependents = pluginDependents(plugin.id)
    return [
      "id": .string(plugin.id),
      "label": .string(plugin.label),
      "description": plugin.description.map(JSONValue.string) ?? .null,
      "requires": requires.isEmpty ? .null : labels(requires),
      "dependents": dependents.isEmpty ? .null : labels(dependents),
      "defaultOff": .bool(isDefaultOffPerSite(plugin.id)),
      "stops": plugin.siteOff.map { .string($0.stops) } ?? .null,
      "keeps": plugin.siteOff.map { .string($0.keeps) } ?? .null,
    ]
  }

  /// The workspace switchboard over `orgs/{org}`.
  static func org(_ orgDoc: JSONValue) -> JSONValue {
    let stored = stringList(orgDoc["enabledPlugins"])
    let enabled = resolveEnabledPlugins(stored)
    let rows: [JSONValue] = PluginCatalog.plugins.map { plugin in
      var row = base(plugin)
      let locked = isLockedOnForWorkspace(plugin.id)
      let cascade = resolveDisableCascade(plugin.id, enabled: enabled)
      var on = enabled
      if !on.contains(plugin.id) { on.append(plugin.id) }
      row["locked"] = .bool(locked)
      row["on"] = .bool(locked || enabled.contains(plugin.id))
      row["cascade"] = cascade.isEmpty ? .null : labels(cascade)
      row["enable"] = strings(on)
      row["disable"] = strings(enabled.filter { $0 != plugin.id && !cascade.contains($0) })
      return .object(row)
    }
    return ["rows": .array(rows), "stored": .bool(stored != nil)]
  }

  /// One site's switchboard over `orgs/{org}` and `hosts/{site}`.
  static func site(_ orgDoc: JSONValue, _ hostDoc: JSONValue) -> JSONValue {
    let orgEnabled = stringList(orgDoc["enabledPlugins"])
    let disabled = stringList(hostDoc["disabledPlugins"]) ?? []
    let optedIn = stringList(hostDoc["enabledPlugins"]) ?? []
    let running = resolveHostEnabledPlugins(orgEnabled: orgEnabled, hostDisabled: disabled, hostEnabled: optedIn)
    let workspace = resolveEnabledPlugins(orgEnabled)
    let rows: [JSONValue] = PluginCatalog.plugins.map { plugin in
      var row = base(plugin)
      let state = resolvePluginSiteState(
        orgEnabled: orgEnabled, hostDisabled: disabled, hostEnabled: optedIn, pluginId: plugin.id)
      let cascade = resolveDisableCascade(plugin.id, enabled: running)
      let turnOn = applySitePluginSwitch(disabled: disabled, optedIn: optedIn, pluginIds: [plugin.id], on: true)
      let turnOff = applySitePluginSwitch(
        disabled: disabled, optedIn: optedIn, pluginIds: [plugin.id] + cascade, on: false)
      row["state"] = .string(state.rawValue)
      row["on"] = .bool(state == .runsHere || state == .alwaysOn)
      row["locked"] = .bool(isLockedOnForSite(plugin.id))
      row["workspaceOn"] = .bool(workspace.contains(plugin.id))
      row["cascade"] = cascade.isEmpty ? .null : labels(cascade)
      row["confirmOff"] = .bool(!cascade.isEmpty || plugin.siteOff?.confirm == true)
      row["turnOn"] = ["disabledPlugins": strings(turnOn.disabled), "enabledPlugins": strings(turnOn.optedIn)]
      row["turnOff"] = ["disabledPlugins": strings(turnOff.disabled), "enabledPlugins": strings(turnOff.optedIn)]
      return .object(row)
    }
    return ["rows": .array(rows)]
  }
}
