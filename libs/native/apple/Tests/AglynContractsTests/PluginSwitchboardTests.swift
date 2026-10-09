// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the console's switchboard answers (enabled-plugins.ts) from
/// function-cases.generated.json, so the native Plugins screens resolve what
/// runs, and what switching one off strands, exactly as the console does.
final class PluginSwitchboardTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = (Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]] ?? []
    XCTAssertFalse(list.isEmpty, "\(name) has no cases")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func list(_ value: Any?, _ key: String) -> [String]? {
    ((value as? [String: Any])?[key] as? [Any])?.compactMap { $0 as? String }
  }

  private func strings(_ value: Any) -> [String] { (value as? [Any] ?? []).compactMap { $0 as? String } }

  func testTheCatalogDecodesWithTheBaseLibraryLocked() {
    XCTAssertFalse(PluginCatalog.plugins.isEmpty)
    XCTAssertTrue(isLockedOnForSite("mui"))
    XCTAssertEqual(PluginCatalog.label("mui"), PluginCatalog.plugin("mui")?.label)
    XCTAssertEqual(PluginCatalog.label("listing-xyz"), "listing-xyz")
  }

  func testWorkspaceListsResolveAsTheConsole() {
    for item in cases("resolveEnabledPlugins") {
      XCTAssertEqual(resolveEnabledPlugins(list(item.args.first, "enabledPlugins")), strings(item.result), "\(item.args)")
    }
  }

  func testSiteListsResolveAsTheConsole() {
    for item in cases("resolveHostEnabledPlugins") {
      let org = item.args[0], host = item.args[1]
      XCTAssertEqual(
        resolveHostEnabledPlugins(
          orgEnabled: list(org, "enabledPlugins"), hostDisabled: list(host, "disabledPlugins"),
          hostEnabled: list(host, "enabledPlugins")),
        strings(item.result), "\(item.args)")
    }
  }

  func testSiteStatesReadAsTheConsole() {
    for item in cases("resolvePluginSiteState") {
      let org = item.args[0], host = item.args[1]
      let state = resolvePluginSiteState(
        orgEnabled: list(org, "enabledPlugins"), hostDisabled: list(host, "disabledPlugins"),
        hostEnabled: list(host, "enabledPlugins"), pluginId: item.args[2] as! String)
      XCTAssertEqual(state.rawValue, item.result as? String, "\(item.args)")
    }
  }

  func testCascadesAndEdgesMatchTheConsole() {
    for item in cases("resolveDisableCascade") {
      XCTAssertEqual(
        resolveDisableCascade(item.args[0] as! String, enabled: strings(item.args[1])), strings(item.result),
        "\(item.args)")
    }
    for item in cases("pluginRequirements") {
      XCTAssertEqual(pluginRequirements(item.args[0] as! String), strings(item.result), "\(item.args)")
    }
    for item in cases("pluginDependents") {
      XCTAssertEqual(pluginDependents(item.args[0] as! String), strings(item.result), "\(item.args)")
    }
  }

  func testLocksMatchTheConsole() {
    for item in cases("isLockedOnForWorkspace") {
      XCTAssertEqual(isLockedOnForWorkspace(item.args[0] as! String), item.result as? Bool, "\(item.args)")
    }
    for item in cases("isLockedOnForSite") {
      XCTAssertEqual(isLockedOnForSite(item.args[0] as! String), item.result as? Bool, "\(item.args)")
    }
    for item in cases("isDefaultOffPerSite") {
      XCTAssertEqual(isDefaultOffPerSite(item.args[0] as! String), item.result as? Bool, "\(item.args)")
    }
  }

  /// The site switch writes the list the console's hook writes: a default-off
  /// plugin records consent, everything else records refusal.
  func testTheSiteSwitchWritesConsentOrRefusal() {
    let defaultOff = PluginCatalog.plugins.first { $0.defaultOffPerSite == true }!.id
    var lists = applySitePluginSwitch(disabled: [defaultOff], optedIn: [], pluginIds: [defaultOff], on: true)
    XCTAssertEqual(lists.disabled, [])
    XCTAssertEqual(lists.optedIn, [defaultOff])
    lists = applySitePluginSwitch(disabled: lists.disabled, optedIn: lists.optedIn, pluginIds: [defaultOff], on: false)
    XCTAssertEqual(lists.optedIn, [])
    lists = applySitePluginSwitch(disabled: [], optedIn: [], pluginIds: ["crm", "crm"], on: false)
    XCTAssertEqual(lists.disabled, ["crm"])
    lists = applySitePluginSwitch(disabled: lists.disabled, optedIn: [], pluginIds: ["crm"], on: true)
    XCTAssertEqual(lists.disabled, [])
  }
}
