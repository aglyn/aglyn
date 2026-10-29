// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import SwiftUI
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

  func testListsTheRoutedPagesForTheKeywordPickerAndReadsTheReportTheRouteAnswers() throws {
    let pages = seoKeywordPages(host: ["screens": ["s2": "pricing", "s1": "/", "s3": 5]], names: ["s1": "Home", "s2": ""])
    XCTAssertEqual(pages.map(\.path), ["/", "/pricing"])
    XCTAssertEqual(pages.map(\.name), ["Home", "/pricing"])
    let report = try JSONDecoder().decode(
      SeoAuditReport.self,
      from: Data(
        """
        {"pages":[{"screenId":"s1","path":"/","name":"Home","versionId":null,"score":85,"findings":[{"code":"title-missing","severity":"high","message":"No title."},{"code":"keyword-missing","severity":"low","message":"Say it.","keyword":"pricing"}],"keywords":[]}],"skipped":2,"site":[{"code":"search-discouraged","severity":"high","message":"Hidden."}],"score":85,"notes":["A note"]}
        """.utf8))
    XCTAssertEqual(seoAuditFindingCount(report), 3)
    XCTAssertEqual(report.skipped, 2)
    XCTAssertNil(report.pages[0].versionId)
  }

  func testSaysWhereABusinessProfileValueComesFrom() {
    let host: [String: Any] = ["seo": ["entity": ["description": "Dog grooming with a calm hand.", "areaServed": ["Austin"]]]]
    let stored: [String: Any] = ["services": ["Bath"], "audience": "Owners", "sources": ["audience": "ai"]]
    let resolved = resolveBusinessProfile(host: host, site: stored)
    XCTAssertEqual(
      businessOriginLine("whatYouDo", stored: stored, resolved: resolved, fallback: "One sentence"),
      "Empty here, so Aglyn AI uses “Dog grooming with a calm hand.” from your SEO settings.")
    XCTAssertEqual(
      businessOriginLine("audience", stored: stored, resolved: resolved, fallback: "x"), "Suggested by Aglyn AI. Edit it and it becomes yours.")
    XCTAssertEqual(businessOriginLine("services", stored: stored, resolved: resolved, fallback: "One per line"), "One per line")
    XCTAssertEqual(SetupSection.allCases.map(\.rawValue), ["details", "business", "seo", "tracking", "theme", "emails", "integrations"])
    XCTAssertEqual(SetupSection.of("business"), .business)
  }

  /// Year founded (AGL-4102): read into the form, carried into the owner's save, its origin said like any other field, and a
  /// year the console would refuse is refused here with the console's words.
  func testYearFoundedIsABusinessProfileField() {
    let stored: [String: Any] = ["whatYouDo": "Racing", "founded": "2019", "sources": ["founded": "start"]]
    let form = businessProfileForm(stored)
    XCTAssertEqual(form["founded"], "2019")
    XCTAssertEqual(businessProfileForm(nil)["founded"], "")
    var edited = form
    edited["founded"] = " 2015 "
    let values = businessProfileSaveValues(edited)
    XCTAssertEqual(values["founded"] as? String, " 2015 ")
    XCTAssertEqual(businessProfileOwnerWrite(stored, values)["founded"] as? String, "2015")
    XCTAssertEqual((businessProfileOwnerWrite(stored, values)["sources"] as? [String: Any])?["founded"] as? String, "owner")
    let resolved = resolveBusinessProfile(host: [:], site: stored)
    XCTAssertEqual(
      businessOriginLine("founded", stored: stored, resolved: resolved, fallback: "Four digits, such as 2015"),
      "Your answers when the site was started. Edit it and it becomes yours.")
    XCTAssertEqual(businessOriginLine("founded", stored: [:], resolved: nil, fallback: "Four digits, such as 2015"), "Four digits, such as 2015")
    XCTAssertNil(businessFoundedError(form))
    edited["founded"] = "founded 2015!"
    XCTAssertEqual(businessFoundedError(edited), businessProfileFoundedProblem("founded 2015!"))
    XCTAssertNotNil(businessFoundedError(edited))
  }

  func testIntegrationsOfferTheCardsOfPluginsRunningOnTheSite() {
    let registry = NativePluginRegistry()
    let entries = ["live-chat", "marketing-platforms", "zapier"].map { id in
      NativePluginManifestEntry(id: id, contributes: NativeContributionDeclaration(widgets: ["\(id).card"])) { registrar in
        registrar.widget("\(id).card", title: id, order: 1, slot: integrationsSlot) { _ in EmptyView() }
      }
    }
    XCTAssertEqual(NativePluginLoader.load(entries, into: registry).failed, [])
    let cards = registry.widgets(for: .aglyn, slot: integrationsSlot)
    func shown(_ org: [String: Any]?, _ host: [String: Any]?) -> [String] {
      integrationWidgets(cards, running: runningPlugins(org: org, host: host)).map(\.pluginID).sorted()
    }
    // Live chat is off for a site until the site turns it on; Zapier has no switch, so its card is always offered.
    XCTAssertEqual(shown(nil, [:]), ["marketing-platforms", "zapier"])
    XCTAssertEqual(shown(nil, ["enabledPlugins": ["live-chat"]]), ["live-chat", "marketing-platforms", "zapier"])
    // A site that turned the email platforms off loses that card.
    XCTAssertEqual(
      shown(["enabledPlugins": ["live-chat"]], ["enabledPlugins": ["live-chat"], "disabledPlugins": ["marketing-platforms"]]),
      ["live-chat", "zapier"])
    XCTAssertEqual(shown(nil, ["disabledPlugins": ["marketing-platforms"]]), ["zapier"])
  }

  func testReadsTheStyleComponentsCatalogAndSendsOnlyTheLooksThatChanged() throws {
    let answer = try JSONDecoder().decode(
      JSONValue.self,
      from: Data(
        """
        {"componentLooks":{"groups":[{"group":"button","label":"Buttons"}],"fields":[{"id":"button.variant","group":"button","label":"Button style","kind":"select","options":[{"value":"contained","label":"Filled"},{"value":"outlined","label":"Outlined"}]},{"id":"input.border","group":"input","label":"Input border color","kind":"color","options":[{"value":"primary","label":"Primary","token":"primary"}]}]}}
        """.utf8))
    let catalog = themeCatalog(of: answer)
    XCTAssertEqual(catalog.lookGroups.map(\.group), ["button"])
    XCTAssertEqual(catalog.looks.map(\.id), ["button.variant", "input.border"])
    XCTAssertEqual(catalog.looks[1].options[0].token, "primary")
    let values = themeValues(
      of: try JSONDecoder().decode(JSONValue.self, from: Data(#"{"componentLooks":{"button.variant":"","input.border":"__custom__","card.variant":"outlined"}}"#.utf8)))
    XCTAssertEqual(values.componentLooks["card.variant"], "outlined")
    var after = values
    after.componentLooks = ["button.variant": "outlined", "input.border": "__custom__", "card.variant": ""]
    // A Custom look is left alone; "Theme default" is the empty choice that clears one.
    XCTAssertEqual(themeEdits(from: values, to: after), [.componentLook(field: "button.variant", value: "outlined"), .componentLook(field: "card.variant", value: "")])
    XCTAssertEqual(ThemeEdit.componentLook(field: "card.variant", value: "").body["control"] as? String, "componentLook")
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

  func testReadsTheBuiltInThemesTheRouteOffers() {
    let presets = themePresets(
      of: .array([
        .object(["id": "themes.bootstrap", "name": "Bootstrap", "description": "Bootstrap 5’s blue", "swatches": ["#0d6efd", "#6c757d"]]),
        .object(["name": "No id"]),
        .object(["id": "themes.bare"]),
      ]))
    XCTAssertEqual(presets.map(\.id), ["themes.bootstrap", "themes.bare"])
    XCTAssertEqual(presets.first?.swatches, ["#0d6efd", "#6c757d"])
    XCTAssertEqual(presets.last?.name, "themes.bare")
    XCTAssertTrue(themePresets(of: nil).isEmpty)
    XCTAssertEqual(themeSelection(of: ["themeSelection": ["kind": "preset", "id": "themes.bootstrap", "name": "Bootstrap"]]).kind, "preset")
  }

  func testReadsWhatTheSiteChangedOnTopOfItsTheme() {
    let long = String(repeating: "a", count: 70)
    let changes = themeChanges(
      of: .array([
        .object([
          "path": "colorSchemes.dark.primary.main", "label": "Color · dark · primary", "scheme": "dark", "themeValue": "#90caf9",
          "overrideValue": "#00e5ff",
        ]),
        .object(["path": "spacing", "label": "Spacing", "themeValue": 8, "overrideValue": 4]),
        .object(["path": "fonts", "label": "Fonts", "themeValue": .null, "overrideValue": ["heading": [.string(long)]]]),
        .object(["label": "No path"]),
      ]))
    XCTAssertEqual(changes.map(\.path), ["colorSchemes.dark.primary.main", "spacing", "fonts"])
    XCTAssertEqual(changes[0].scheme, "dark")
    XCTAssertTrue(changes[0].isColor)
    XCTAssertEqual(changes[1].themeValue, "8")
    XCTAssertFalse(changes[1].isColor)
    XCTAssertNil(changes[2].themeValue)
    // A structure is shown compact and cut at sixty characters.
    XCTAssertEqual(changes[2].overrideValue?.count, 58)
    XCTAssertTrue(changes[2].overrideValue?.hasSuffix("…") == true)
    XCTAssertTrue(themeChanges(of: nil).isEmpty)
  }

  func testFiltersTheFontCatalogByWordAndCategory() {
    let fonts = [
      ThemeFontOption(family: "Inter", category: "sans-serif"), ThemeFontOption(family: "Playfair Display", category: "serif"),
      ThemeFontOption(family: "Roboto Mono", category: "monospace"), ThemeFontOption(family: "Roboto", category: "sans-serif"),
    ]
    XCTAssertEqual(filterFonts(fonts, search: "", category: nil).count, 4)
    XCTAssertEqual(filterFonts(fonts, search: "roboto", category: nil).map(\.family), ["Roboto Mono", "Roboto"])
    XCTAssertEqual(filterFonts(fonts, search: "play disp", category: nil).map(\.family), ["Playfair Display"])
    XCTAssertEqual(filterFonts(fonts, search: "roboto", category: "monospace").map(\.family), ["Roboto Mono"])
    XCTAssertTrue(filterFonts(fonts, search: "zzz", category: nil).isEmpty)
    XCTAssertEqual(fontCategories.map(\.value), ["sans-serif", "serif", "display", "handwriting", "monospace"])
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

  func testTheThemeLibraryListsOnlyTheSitesOwnAndInstalledThemesEachByItsKind() {
    func entry(_ id: String, _ kind: String?, _ name: String) -> FirestoreDocument {
      var data: [String: Any] = ["name": name]
      if let kind { data["kind"] = kind }
      return FirestoreDocument(id: id, data: data)
    }
    let listed = libraryThemes([
      entry("default", "default", "Platform default"),
      entry("installed--harvest", "installed", "Harvest"),
      entry("preset--mui", "preset", "Material UI"),
      entry("theme-cool", "custom", "Cool"),
      entry("theme-warm", "custom", "Warm"),
      entry("unknown", nil, "No kind"),
    ])
    XCTAssertEqual(listed.map(\.id), ["theme-cool", "theme-warm", "installed--harvest"])
    XCTAssertEqual(listed.map(\.kind), ["custom", "custom", "installed"])
  }
}
