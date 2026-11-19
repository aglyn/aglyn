// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// A plugin settings form's pre-save check over the console's own answers: each case in
/// `plugin-settings-check-cases.generated.json` is what the schema's `validate` says to a set of values.
final class PluginSettingsChecksTests: XCTestCase {
  private static let contracts = ScreenSpecTests.screensDir.appendingPathComponent("../contracts").standardizedFileURL

  private func checks() throws -> [String: JSONValue] {
    let data = try Data(contentsOf: Self.contracts.appendingPathComponent("plugin-settings-check-cases.generated.json"))
    guard case .object(let checks)? = try XCTUnwrap(JSONValue.decode(data))["checks"] else { throw XCTSkip("no checks") }
    return checks
  }

  func testEveryCheckAnswersAsTheConsolesValidate() throws {
    let checks = try checks()
    XCTAssertNotNil(checks["weglot"])
    for (name, list) in checks {
      guard case .array(let cases) = list else { return XCTFail("\(name): no cases") }
      XCTAssertFalse(cases.isEmpty, name)
      for item in cases {
        guard case .object(let values)? = item["values"] else { return XCTFail("\(name): a case without values") }
        XCTAssertEqual(PluginSettingsChecks.refusal(name, values), item["result"]?.stringValue, "\(name) \(values)")
      }
    }
  }

  /// On a site the check is asked over the values the site will run with: its override, else the workspace's, else
  /// the default.
  func testASiteIsCheckedOverWhatItWillRunWith() {
    let defaults: JSONValue = ["enabled": false, "apiKey": "", "sourceLanguage": "en", "targetLanguages": ""]
    let org: JSONValue = ["enabled": true, "apiKey": "wg_0123456789abcdef", "targetLanguages": "fr"]
    func site(_ form: JSONValue) -> String? {
      let filled: JSONValue = ["const": ["defaults": defaults], "data": ["org": org], "form": form]
      return PluginSettingsChecks.refusal("weglot", PluginSettingsChecks.values(in: filled, site: true))
    }
    // Nothing overridden: the workspace's values, which pass.
    XCTAssertNil(site(["ov_enabled": false, "enabled": false, "ov_apiKey": false, "apiKey": ""]))
    // The site overrides its key with an empty one while the workspace has translation on.
    XCTAssertEqual(
      site(["ov_enabled": false, "enabled": true, "ov_apiKey": true, "apiKey": ""]),
      "Add your Weglot API key before turning translation on.")
    // A language list the site overrides with its own source language in it.
    XCTAssertEqual(
      site(["ov_targetLanguages": true, "targetLanguages": "en, fr"]),
      "The languages to translate into cannot include the language your site is written in.")
    // An unknown check refuses nothing.
    XCTAssertNil(PluginSettingsChecks.refusal("unknown", ["enabled": true]))
  }

  /// Weglot's key and language codes are kept as typed (the schema's `verbatim`, the console's `autoCapitalize="none"`):
  /// the phone keyboard would make a typed key "Wg_…", which the check refuses. Other text stays a sentence field.
  func testKeysAndCodesAreKeptAsTyped() throws {
    let data = try Data(contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("plugin-settings.screens.json"))
    guard case .array(let screens)? = try XCTUnwrap(JSONValue.decode(data))["screens"] else { return XCTFail("no screens") }
    for id in ["core.pluginSettings.weglot", "core.sitePluginSettings.weglot"] {
      let screen = try XCTUnwrap(screens.first { $0["id"]?.stringValue == id }, id)
      let form = try XCTUnwrap(screen["blocks"].array.first { $0["type"]?.stringValue == "form" }, id)
      let fields = form["fields"].array.compactMap { FieldSpec($0) }
      XCTAssertEqual(fields.filter(\.verbatim).map(\.key), ["apiKey", "sourceLanguage", "targetLanguages"], id)
    }
    XCTAssertFalse(try XCTUnwrap(FieldSpec(["key": "name", "kind": "text"])).verbatim)
    XCTAssertTrue(try XCTUnwrap(FieldSpec(["key": "apiKey", "kind": "text", "verbatim": true])).verbatim)
  }
}
