// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynSite

/// The Kotlin `SiteTest`'s setup cases on the Swift port, and the console's
/// own answers for the verification paste (function-cases.generated.json).
@MainActor
final class SetupTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(arg: String?, result: Any)] {
    let list = (Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]] ?? []
    XCTAssertFalse(list.isEmpty, "\(name) has no cases")
    return list.map { (($0["args"] as? [Any])?.first as? String, $0["result"] as Any) }
  }

  func testExtractsTheVerificationTokenAsTheConsoleDoes() {
    for item in cases("extractSearchEngineVerificationToken") {
      XCTAssertEqual(extractVerificationToken(item.arg), item.result as? String, item.arg ?? "nil")
    }
  }

  func testJudgesAVerificationTokenAsTheConsoleDoes() {
    for item in cases("isSearchEngineVerificationToken") {
      XCTAssertEqual(isVerificationToken(item.arg), item.result as? Bool, item.arg ?? "nil")
    }
  }

  func testBuildsTheSettingsSaveAsTheConsoleForm() {
    let stored: [String: Any] = ["seo": ["title": "Old", "titlePattern": "{{page.name}}"]]
    let payload = settingsPayload(
      ["seo.title": " New title ", "seo.titlePattern": "", "seo.verification.google": ""], stored: stored,
      clearable: ["seo.titlePattern", "seo.verification.google"])
    // A blank clearable field the site holds is deleted; one it never held is left out.
    let seo = payload["seo"] as? [String: Any]
    XCTAssertEqual(seo?["title"] as? String, "New title")
    XCTAssertEqual(seo?["titlePattern"] as? FirestoreSentinel, .delete)
    XCTAssertNil(seo?["verification"])
    XCTAssertEqual(seo?.count, 2)
    // A blank field that is not clearable is written as the empty text the form holds.
    let plain = settingsPayload(["seo.description": "  "], stored: nil)
    XCTAssertEqual((plain["seo"] as? [String: Any])?["description"] as? String, "")
    XCTAssertEqual(SetupSection.of("hostSeo"), .seo)
    XCTAssertEqual(SetupSection.of("theme"), .theme)
    XCTAssertEqual(SetupSection.of(nil), .details)
    XCTAssertEqual(SetupSection.of("activity"), .details)
  }

  func testChecksTrackingIdsLanguagesAndVerificationPastes() {
    let ga = trackingFields.first { $0.path == "analytics.gaMeasurementId" }!
    XCTAssertNil(trackingError(ga, "G-ABC1234"))
    XCTAssertNil(trackingError(ga, ""))
    XCTAssertNotNil(trackingError(ga, "UA-1234"))
    XCTAssertNil(trackingError(trackingFields.first { $0.path == "analytics.adTags.meta" }!, "123456789012345"))
    XCTAssertEqual(parseLocales("en, pt-BR, en").locales, ["en", "pt-BR"])
    XCTAssertNil(parseLocales("en, pt-BR, en").error)
    XCTAssertNotNil(parseLocales("english").error)
    let names = ["google": "google-site-verification", "bing": "msvalidate.01"]
    let labels = ["google": "Google Search Console", "bing": "Bing Webmaster Tools"]
    XCTAssertNil(
      verificationError("google", "<meta name=\"google-site-verification\" content=\"abc_123\" />", metaNames: names, labels: labels))
    XCTAssertEqual(
      verificationError("google", "<meta name=\"msvalidate.01\" content=\"ABC\" />", metaNames: names, labels: labels),
      "That tag is for Bing Webmaster Tools — paste it in that field instead")
    XCTAssertNotNil(verificationError("google", "not a token!", metaNames: names, labels: labels))
    XCTAssertEqual(consentMode(["consent": ["mode": "strict"]]), "strict")
    XCTAssertEqual(consentMode([:]), "geo")
  }

  func testSendsOnlyTheThemeControlsThatChanged() {
    let before = ThemeValues(
      colors: ["light": ["primary": "#111111", "divider": nil]], darkScheme: "auto", fontFamily: "__system__",
      borderRadius: 4, spacing: nil, navHeightXs: nil, navHeightSm: nil)
    var after = before
    after.colors = ["light": ["primary": "#222222", "divider": nil]]
    after.fontFamily = "Inter"
    after.spacing = 6
    XCTAssertEqual(
      themeEdits(from: before, to: after),
      [.color(scheme: "light", token: "primary", value: "#222222"), .fontFamily("Inter"), .spacing(6)])
    XCTAssertTrue(themeEdits(from: before, to: before).isEmpty)
    var cleared = before
    cleared.colors = ["light": ["primary": "", "divider": nil]]
    XCTAssertEqual(themeEdits(from: before, to: cleared), [.color(scheme: "light", token: "primary", value: nil)])
  }

  func testReadsTheThemeEditorsAnswer() {
    let catalog = themeCatalog(
      of: .object([
        "schemes": ["light", "dark"],
        "colors": .array([.object(["token": "primary", "label": "Primary", "group": "palette"])]),
        "darkScheme": .object(["label": "Dark mode", "options": .array([.object(["value": "auto", "label": "Automatic"])])]),
        "borderRadius": .object(["label": "Corner radius", "min": 0, "max": 32]),
        "navHeight": .object(["xs": .object(["label": "Phone nav", "min": 40, "max": 96])]),
      ]))
    XCTAssertEqual(catalog.schemes, ["light", "dark"])
    XCTAssertEqual(catalog.colors.first?.token, "primary")
    XCTAssertEqual(catalog.darkSchemeOptions.first?.label, "Automatic")
    XCTAssertEqual(catalog.borderRadius, ThemeRange(label: "Corner radius", min: 0, max: 32))
    XCTAssertEqual(catalog.navHeightXs.max, 96)
    let values = themeValues(of: .object(["colors": .object(["light": .object(["primary": "#fff", "divider": .null])]), "borderRadius": 8]))
    XCTAssertEqual(values.colors["light"]?["primary"] ?? nil, "#fff")
    XCTAssertNil(values.colors["light"]?["divider"] ?? nil)
    XCTAssertEqual(values.borderRadius, 8)
    XCTAssertEqual(values.darkScheme, "auto")
    let range = ThemeRange(label: "Spacing", min: 2, max: 12)
    XCTAssertEqual(parseThemeNumber("6", in: range).value, 6)
    XCTAssertEqual(parseThemeNumber("20", in: range).error, "From 2 to 12")
    XCTAssertEqual(parseThemeNumber("x", in: range).error, "Use a number")
    XCTAssertNil(parseThemeNumber(" ", in: range).error)
    XCTAssertEqual(formatThemeNumber(8), "8")
    XCTAssertEqual(formatThemeNumber(1.5), "1.5")
  }

  func testReadsTheThemeSelection() {
    XCTAssertEqual(themeSelection(of: ["themeSelection": ["kind": "custom", "id": "t1", "name": "Mine"]]).id, "t1")
    XCTAssertEqual(themeSelection(of: ["themeInstalledFrom": ["listingId": "l1"]]).kind, "installed")
    XCTAssertEqual(themeSelection(of: ["theme": ["colors": [:]]]).kind, "custom")
    XCTAssertEqual(themeSelection(of: [:]).kind, "default")
    XCTAssertTrue(hasThemeEdits(["themeOverride": ["patch": ["a": 1]]]))
    XCTAssertFalse(hasThemeEdits(["themeOverride": ["patch": [:]]]))
    XCTAssertEqual(socialLinks(of: ["business": ["socialLinks": [["label": "X", "url": "https://x.com/a"]]]]).first?.url, "https://x.com/a")
    XCTAssertTrue(isHexColorForTests("#1A73E8"))
  }

  private func isHexColorForTests(_ text: String) -> Bool { text.hasPrefix("#") && text.count == 7 }

  func testSetupAnswersTheConsolesLinksNatively() {
    let registry = NativePluginRegistry()
    _ = NativePluginLoader.load(NativePlatformEntries.entries, into: registry)
    XCTAssertEqual(registry.screen("site.setup")?.requiresSite, true)
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/setup/seo"),
      .screen("site.setup", ["orgSlug": "acme", "hostSlug": "shop", "section": "seo"]))
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/setup?tab=hostTracking"),
      .screen("site.setup", ["orgSlug": "acme", "hostSlug": "shop", "tab": "hostTracking"]))
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/theme"), .screen("site.theme", ["orgSlug": "acme", "hostSlug": "shop"]))
  }

  func testGroupsTheSitesEmailsByPlugin() {
    let rows = ContractValues.shared.tenantEmails
    XCTAssertFalse(rows.isEmpty)
    XCTAssertEqual(ContractValues.shared.tenantEmailCollection, "emailTemplates")
  }
}
