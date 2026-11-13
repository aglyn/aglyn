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
      let question = offQuestion(plugin, cascade: cascade)
      row["offTitle"] = .string(question.title)
      row["offMessage"] = .string(question.message)
      row["offLabel"] = .string(question.label)
      row["turnOn"] = ["disabledPlugins": strings(turnOn.disabled), "enabledPlugins": strings(turnOn.optedIn)]
      row["turnOff"] = ["disabledPlugins": strings(turnOff.disabled), "enabledPlugins": strings(turnOff.optedIn)]
      return .object(row)
    }
    return ["rows": .array(rows)]
  }

  /// What one published site loses when a plugin goes off, by the plugin's `PUBLISHED_SITE_IMPACT`
  /// (the console's `consequenceOf`).
  static func consequence(_ pluginID: String) -> String {
    switch ContractValues.shared.publishedSiteImpact[pluginID] {
    case .elements?: "Elements already placed on published pages stop rendering."
    case .routes?: "Pages it serves stop being served on published sites."
    default: "Leaves navigation and the editor. Published pages are unaffected."
    }
  }

  /// The question switching a plugin off for one site asks, worded as the console's
  /// `PluginDisableCascadeDialog` at site scope: with dependents, the title counts them and the body lists the plugin
  /// and each dependent with what it does to the published site; with none (a `siteOff.confirm` plugin, Forms), it
  /// says what stops and what keeps running. The console also counts placed elements and names the published pages
  /// when its scan answers; without that answer it says these same sentences.
  static func offQuestion(_ plugin: FirstPartyPlugin, cascade: [String]) -> (title: String, message: String, label: String) {
    let name = plugin.label
    if cascade.isEmpty {
      let body = [plugin.siteOff?.stops, plugin.siteOff?.keeps].compactMap { $0 }.filter { !$0.isEmpty }
      return ("Switch \(name) off for this site?", body.joined(separator: "\n\n"), "Switch \(name) off")
    }
    let others = "\(cascade.count) other plugin\(cascade.count == 1 ? "" : "s")"
    let entries =
      ["\(name) (the one you switched off)\n\(consequence(plugin.id))"]
      + cascade.map { "\(PluginCatalog.label($0)) — depends on \(name)\n\(consequence($0))" }
    let message = (
      ["These plugins depend on \(name) and cannot run without it. Continuing switches them off for this site."]
        + entries
        + [
          "Turning \(name) back on later does NOT switch these back on — you will need to re-enable each one yourself.",
          ContractValues.shared.pluginCascadeIsDeclaredOnly,
        ]
    ).joined(separator: "\n\n")
    return ("Disabling \(name) also disables \(others)", message, "Continue and disable those too")
  }

  /// The site's two lists after switching `pluginID` on or off over `orgs/{org}` and `hosts/{site}` as stored now,
  /// the same move a row's `turnOn` / `turnOff` makes (switching off takes the plugins that need it along).
  static func switched(_ orgDoc: JSONValue, _ hostDoc: JSONValue, pluginID: String, on: Bool) -> [String: JSONValue] {
    let orgEnabled = stringList(orgDoc["enabledPlugins"])
    let disabled = stringList(hostDoc["disabledPlugins"]) ?? []
    let optedIn = stringList(hostDoc["enabledPlugins"]) ?? []
    let running = resolveHostEnabledPlugins(orgEnabled: orgEnabled, hostDisabled: disabled, hostEnabled: optedIn)
    let ids = on ? [pluginID] : [pluginID] + resolveDisableCascade(pluginID, enabled: running)
    let next = applySitePluginSwitch(disabled: disabled, optedIn: optedIn, pluginIds: ids, on: on)
    return ["disabledPlugins": strings(next.disabled), "enabledPlugins": strings(next.optedIn)]
  }

  /// What a held switch says while the site's lists are not yet the server's (`SITE_PLUGINS_CHECKING_TEXT`).
  static let checkingText = "Checking this site’s plugin list with the server…"

  /// Why a switch did not save (`writeGuardedBySeed`'s words for the site plugin list).
  static let unconfirmedText =
    "We could not confirm your site plugin list with the server yet, so nothing was saved. Check your connection and try again in a moment."
  static let unreadableText =
    "Your site plugin list could not be loaded, so there is nothing safe to save — saving now would overwrite the stored copy with blanks. Reload and try again."
}
