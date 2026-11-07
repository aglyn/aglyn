// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the console's answers for where a plugin runs (plugin-site-exclusions.ts) from function-cases.generated.json.
final class PluginRunsOnTests: XCTestCase {
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

  private func strings(_ value: Any?) -> [String]? { (value as? [Any])?.compactMap { $0 as? String } }

  private func sites(_ value: Any) -> [PluginSiteEntry] {
    (value as? [[String: Any]] ?? []).map {
      PluginSiteEntry(id: $0["id"] as! String, disabledPlugins: strings($0["disabledPlugins"]), enabledPlugins: strings($0["enabledPlugins"]))
    }
  }

  private func choice(_ value: Any) -> PluginRunsOn {
    let raw = value as? [String: Any]
    return raw?["mode"] as? String == "allExcept" ? .allExcept(exceptHostIDs: strings(raw?["exceptHostIds"]) ?? []) : .all
  }

  func testRunsOnReadsTheSitesLists() {
    for item in cases("pluginRunsOnOf") {
      XCTAssertEqual(pluginRunsOnOf(item.args[0] as! String, sites: sites(item.args[1])), choice(item.result), "\(item.args)")
    }
  }

  func testPlansAsTheConsole() {
    for item in cases("planPluginRunsOn") {
      let input = item.args[0] as! [String: Any]
      let plan = planPluginRunsOn(
        pluginID: input["pluginId"] as! String, choice: choice(input["choice"] as Any),
        orgEnabled: strings((input["org"] as? [String: Any])?["enabledPlugins"]), sites: sites(input["sites"] as Any))
      let want = item.result as! [String: Any]
      XCTAssertEqual(plan.problem, want["problem"] as? String, "\(item.args)")
      let writes = (want["writes"] as? [[String: Any]])?.map {
        PluginSiteWrite(hostID: $0["hostId"] as! String, disabledPlugins: strings($0["disabledPlugins"]) ?? [], leftOut: $0["leftOut"] as! Bool)
      }
      XCTAssertEqual(plan.writes, writes, "\(item.args)")
      let stranded = (want["stranded"] as? [[String: Any]] ?? []).map {
        PluginSiteStranding(hostID: $0["hostId"] as! String, pluginID: $0["pluginId"] as! String, missing: strings($0["missing"]) ?? [])
      }
      XCTAssertEqual(plan.stranded, stranded, "\(item.args)")
    }
  }

  func testOptInNoteAsTheConsole() {
    for item in cases("pluginRunsOnOptInNote") {
      XCTAssertEqual(pluginRunsOnOptInNote(item.args[0] as! String), item.result as? String, "\(item.args)")
    }
  }
}
