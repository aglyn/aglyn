// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynMarketplacePlugin

/// The console's own answers (function-cases.generated.json) for the marketplace's rules: the Kotlin `MarketplaceCasesTest`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  XCTAssertFalse(cases.isEmpty, name)
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
  try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed))
}

private func string(_ value: Any?) -> String? { value is NSNull ? nil : value as? String }

final class MarketplaceTests: XCTestCase {
  func testBrowseBase() throws {
    for item in try functionCases("browseBase") {
      let expected = try decode([ListQueryFilter].self, item.result)
      XCTAssertEqual(browseBase(viewerOrgID: string(item.args[0]), publisherID: item.args.count > 1 ? string(item.args[1]) : nil), expected, "\(item.args)")
    }
  }

  func testArtifactTypeAndBrowsable() throws {
    for item in try functionCases("listingArtifactType") {
      let listing = try XCTUnwrap(item.args[0] as? [String: Any])
      XCTAssertEqual(
        listingArtifactType(artifactType: string(listing["artifactType"]), type: string(listing["type"]), kind: string(listing["kind"])), item.result as? String,
        "\(item.args)")
    }
    for item in try functionCases("isListingBrowsable") {
      let listing = ListingRow(FirestoreDocument(id: "l", data: item.args[0] as? [String: Any] ?? [:]))
      XCTAssertEqual(isListingBrowsable(listing), item.result as? Bool, "\(item.args)")
    }
  }

  func testInstallState() throws {
    for item in try functionCases("resolvePluginInstallState") {
      func pin(_ value: Any) -> String? {
        guard let version = (value as? [String: Any])?["version"] else { return nil }
        return (version as? String) ?? (version as? NSNumber).map { jsNumberString($0.doubleValue) }
      }
      let state = resolvePluginInstallState(
        latestVersion: string(item.args[0]), hostPinVersion: pin(item.args[1]), hostPinned: item.args[1] is [String: Any], orgPinVersion: pin(item.args[2]),
        orgPinned: item.args[2] is [String: Any])
      let expected = try XCTUnwrap(item.result as? [String: Any])
      XCTAssertEqual(state.installedVersion, string(expected["installedVersion"]), "\(item.args)")
      XCTAssertEqual(state.scope?.rawValue, string(expected["scope"]), "\(item.args)")
      XCTAssertEqual(state.shadowed, expected["shadowed"] as? Bool, "\(item.args)")
      XCTAssertEqual(state.updateAvailable, expected["updateAvailable"] as? Bool, "\(item.args)")
    }
  }

  func testInstallRoutes() throws {
    for item in try functionCases("marketplaceInstallEndpoint") { XCTAssertEqual(marketplaceInstallEndpoint(item.args[0] as? String ?? ""), item.result as? String, "\(item.args)") }
    for item in try functionCases("marketplaceLandingMessage") {
      XCTAssertEqual(marketplaceLandingMessage(item.args[0] as? String ?? "", item.args[1] as? String ?? ""), string(item.result), "\(item.args)")
    }
  }

  func testBrowseAsksWhatTheWorkspaceMaySeeWithTheSearchFolded() throws {
    let plain = browseQuery(viewerOrgID: "org1", category: nil, search: "", sort: .newest)
    XCTAssertEqual(plain.collection, ["marketplaceListings"])
    XCTAssertEqual(plain.filters.map(\.path), ["browseAudience"])
    XCTAssertEqual(plain.filters.first?.value as? [String], ["*", "org1"])
    XCTAssertEqual(plain.order.map(\.field), ["createdAt"])
    XCTAssertEqual(plain.order.map(\.descending), [true])
    let searched = browseQuery(viewerOrgID: "org1", category: "seo", search: "count", sort: .installed)
    XCTAssertTrue(searched.filters.contains { $0.path == "browseTokens" && ($0.value as? [String]) == ["*~count", "org1~count"] }, "\(searched.filters)")
    XCTAssertTrue(searched.filters.contains { $0.path == "category" && ($0.value as? String) == "seo" })
    XCTAssertEqual(searched.order.map(\.field), ["installCount"])
    XCTAssertEqual(searched.order.map(\.descending), [true])
  }

  func testReadsAListingAsBrowseShowsIt() {
    let row = ListingRow(
      FirestoreDocument(
        id: "l1",
        data: [
          "displayName": "Promo Countdown", "type": "plugin", "priceUsd": 12, "latestVersion": "1.1.0", "latestApprovedVersion": "1.0.0", "ratingAverage": 4.5,
          "ratingCount": 2,
        ]))
    XCTAssertEqual(row.artifactType, "plugin")
    XCTAssertEqual(row.offeredVersion, "1.0.0")
    XCTAssertEqual(priceLabel(row.priceUSD), "$12")
    XCTAssertEqual(ratingLabel(row), "4.5 ★ (2)")
    XCTAssertEqual(installTargets("plugin"), [.org, .host])
    XCTAssertEqual(installTargets("template"), [.host])
  }

  func testLicencesAreTheWorkspacesLivePurchases() {
    let query = licencesQuery(orgID: "org1")
    XCTAssertEqual(query.collection, ["marketplacePurchases"])
    XCTAssertTrue(query.filters.contains { $0.path == "buyerOrgId" && ($0.value as? String) == "org1" })
    XCTAssertTrue(query.filters.contains { $0.path == "refundedAt" && $0.value is NSNull })
  }

  func testBoughtByYouIsYourOwnLivePurchasesNarrowedToTheWorkspaceEachLandedIn() {
    let all = boughtByYouQuery(uid: "u1", licensedTo: nil)
    XCTAssertEqual(all.collection, ["marketplacePurchases"])
    XCTAssertTrue(all.filters.contains { $0.path == "buyerUid" && ($0.value as? String) == "u1" })
    XCTAssertTrue(all.filters.contains { $0.path == "refundedAt" && $0.value is NSNull })
    XCTAssertFalse(all.filters.contains { $0.path == "buyerOrgId" })
    let one = boughtByYouQuery(uid: "u1", licensedTo: "o2")
    XCTAssertTrue(one.filters.contains { $0.path == "buyerOrgId" && ($0.value as? String) == "o2" })
    // "Every workspace you belong to" is a purchase that names none.
    let every = boughtByYouQuery(uid: "u1", licensedTo: everyWorkspace)
    XCTAssertTrue(every.filters.contains { $0.path == "buyerOrgId" && !($0.value is String) })

    let mine = LicenceRow(FirestoreDocument(id: "p1", data: ["listingId": "l1", "buyerUid": "u1", "buyerOrgId": "o1", "amountCents": 1081, "taxCents": 81]))
    let theirs = LicenceRow(FirestoreDocument(id: "p2", data: ["listingId": "l1", "buyerUid": "u2", "buyerOrgId": "o2"]))
    let legacy = LicenceRow(FirestoreDocument(id: "p3", data: ["listingId": "l1", "buyerUid": "u1", "buyerOrgId": NSNull()]))
    XCTAssertEqual(mine.paidCents, 1000, "what the license cost before tax")
    XCTAssertEqual([boughtByLabel(mine, uid: "u1"), boughtByLabel(theirs, uid: "u1")], ["You", "A colleague"])
    XCTAssertEqual(
      [mine, theirs, legacy].map { licensedToLabel($0, orgID: "o1", names: ["o2": "Studio"]) },
      ["This workspace", "Studio", "Every workspace you belong to"])
  }

  /// Publishing the site as a template is the spec screens its Kotlin module reads too: bundled here, they are the ones the
  /// manifest declares, and the template one fills the `siteTemplate` zone of Backup & restore.
  @MainActor
  func testThePublishScreensAreBundledAndFillTheSiteTemplateZone() throws {
    let specs = ScreenCatalog.load(from: .module)
    let ids = [
      "marketplace.publish", "marketplace.publishComponent", "marketplace.publishDatasetSchema", "marketplace.publishEmailStarter", "marketplace.publishEmailTemplate",
      "marketplace.publishLayout", "marketplace.publishPlugin", "marketplace.publishTemplate", "marketplace.publishTheme", "marketplace.publisherAgreement",
    ]
    XCTAssertEqual(specs.map(\.id).sorted(), ids)
    XCTAssertEqual(specs.first { $0.id == "marketplace.publishTemplate" }?.zones, ["siteTemplate"])
    let declared = SpecScreens.declaration(specs).screens
    XCTAssertEqual(declared.sorted(), ids)
  }

  // MARK: What a plugin's page says about its installs (marketplace-catalog.ts, replayed)

  private func object(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }

  private func summary(_ value: Any) -> OrgInstallSummary {
    let json = object(value)
    let sites = (json["sites"] as? [[String: Any]] ?? []).map(site)
    return OrgInstallSummary(
      orgWide: json["orgWide"] as? Bool == true, orgVersion: string(json["orgVersion"]), sites: sites,
      hostPinnedIDs: json["hostPinnedIds"] as? [String] ?? [], availableHostIDs: json["availableHostIds"] as? [String] ?? [],
      installedAnywhere: json["installedAnywhere"] as? Bool == true)
  }

  private func site(_ json: [String: Any]) -> OrgInstallSite {
    OrgInstallSite(
      hostID: json["hostId"] as? String ?? "", label: json["label"] as? String ?? "", version: string(json["version"]),
      pinnedBy: InstallTarget(rawValue: json["pinnedBy"] as? String ?? "") ?? .org, shadowed: json["shadowed"] as? Bool == true)
  }

  private func siteJSON(_ site: OrgInstallSite) -> [String: Any?] {
    ["hostId": site.hostID, "label": site.label, "version": site.version, "pinnedBy": site.pinnedBy.rawValue, "shadowed": site.shadowed]
  }

  private func statusJSON(_ status: UpdateStatus) -> [String: Any?] {
    var out: [String: Any?] = ["state": status.state.rawValue, "installedVersion": status.installedVersion, "availableVersion": status.availableVersion]
    if let reason = status.unknownReason { out["unknownReason"] = reason.rawValue }
    return out
  }

  private func same(_ lhs: [String: Any?], _ rhs: Any?, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
    let expected = object(rhs)
    XCTAssertEqual(Set(lhs.keys), Set(expected.keys), message, file: file, line: line)
    for (key, value) in lhs {
      let want = expected[key]
      if value == nil { XCTAssertTrue(want == nil || want is NSNull, "\(message) \(key)", file: file, line: line) } else {
        XCTAssertEqual(String(describing: value!), String(describing: want ?? "nil"), "\(message) \(key)", file: file, line: line)
      }
    }
  }

  func testVersionsAreOrderedAsTheConsoleOrdersThem() throws {
    for item in try functionCases("compareArtifactVersions") {
      func text(_ value: Any) -> String? { versionText(value) }
      let order = compareArtifactVersions(text(item.args[0]), text(item.args[1]))
      XCTAssertEqual(order.map { NSNumber(value: $0) }, item.result as? NSNumber, "\(item.args)")
    }
  }

  func testUpdateStatesAreWordedAsTheConsoleWordsThem() throws {
    for item in try functionCases("updateStateLabel") {
      let json = object(item.args[0])
      let status = UpdateStatus(
        state: UpdateState(rawValue: json["state"] as? String ?? "") ?? .unknown, installedVersion: string(json["installedVersion"]),
        availableVersion: string(json["availableVersion"]), unknownReason: (json["unknownReason"] as? String).flatMap(UnknownReason.init))
      XCTAssertEqual(updateStateLabel(status), item.result as? String, "\(item.args)")
    }
  }

  func testWhatAListingOffersAndWhetherAnInstallIsBehindIt() throws {
    for item in try functionCases("pluginOfferedVersion") {
      let revoked: Revoked? =
        item.args[1] is NSNull ? nil : (item.args[1] as? String == "all" ? .all : .versions(item.args[1] as? [String] ?? []))
      XCTAssertEqual(pluginOfferedVersion(latestApprovedVersion: versionText(item.args[0]), revoked: revoked), string(item.result), "\(item.args)")
    }
    for item in try functionCases("pluginUpdateStatus") {
      let pin: UpdateComparablePin? = item.args[0] is NSNull ? nil : UpdateComparablePin(object(item.args[0]))
      same(statusJSON(pluginUpdateStatus(pin: pin, offered: string(item.args[1]))), item.result, "\(item.args)")
    }
  }

  func testTheWorkspacesPicturePicksUpEverySitesPin() throws {
    for item in try functionCases("resolveOrgInstallSummary") {
      let hosts = (item.args[0] as? [[String: Any]] ?? []).map { SiteChoice(id: $0["id"] as? String ?? "", label: $0["label"] as? String ?? "") }
      var pins: [String: PinVersion] = [:]
      for (key, value) in object(item.args[1]) where !(value is NSNull) { pins[key] = PinVersion(version: versionText(object(value)["version"])) }
      let org: PinVersion? = item.args[2] is NSNull ? nil : PinVersion(version: versionText(object(item.args[2])["version"]))
      let result = resolveOrgInstallSummary(hosts: hosts, hostPins: pins, orgPin: org)
      let expected = object(item.result)
      XCTAssertEqual(result.orgWide, expected["orgWide"] as? Bool, "\(item.args)")
      XCTAssertEqual(result.orgVersion, string(expected["orgVersion"]), "\(item.args)")
      XCTAssertEqual(result.hostPinnedIDs, expected["hostPinnedIds"] as? [String], "\(item.args)")
      XCTAssertEqual(result.availableHostIDs, expected["availableHostIds"] as? [String], "\(item.args)")
      XCTAssertEqual(result.installedAnywhere, expected["installedAnywhere"] as? Bool, "\(item.args)")
      XCTAssertEqual(result.sites, (expected["sites"] as? [[String: Any]] ?? []).map(site), "\(item.args)")
    }
  }

  func testAnUninstallTouchesTheSitesTheConsoleSaysItTouches() throws {
    for item in try functionCases("resolveUninstallTargets") {
      let targets = resolveUninstallTargets(summary(item.args[0]), scope: InstallTarget(rawValue: item.args[1] as? String ?? "") ?? .host, hostID: item.args.count > 2 ? string(item.args[2]) : nil)
      let expected = (item.result as? [[String: Any]] ?? []).map {
        UninstallTarget(hostID: $0["hostId"] as? String ?? "", label: $0["label"] as? String ?? "", stillCovered: $0["stillCovered"] as? Bool == true)
      }
      XCTAssertEqual(targets, expected, "\(item.args)")
    }
    for item in try functionCases("staleSites") {
      let sites = (item.args[0] as? [[String: Any]] ?? []).map(site)
      let stale = staleSites(sites, latestVersion: versionText(item.args[1]))
      XCTAssertEqual(stale, (item.result as? [[String: Any]] ?? []).map(site), "\(item.args)")
    }
  }

  func testThePageSaysWhatTheConsoleSays() throws {
    for item in try functionCases("pluginSiteSetSummary") {
      XCTAssertEqual(pluginSiteSetSummary(summary(item.args[0]), siteCount: (item.args[1] as? NSNumber)?.intValue ?? 0), item.result as? String, "\(item.args)")
    }
    for item in try functionCases("pluginUpdatePrompt") {
      let input = object(item.args[0])
      let prompt = pluginUpdatePrompt(
        name: input["name"] as? String ?? "", latestVersion: input["latestVersion"] as? String ?? "", label: input["label"] as? String ?? "",
        singleSite: input["singleSite"] as? Bool == true)
      let expected = object(item.result)
      XCTAssertEqual(prompt.title, expected["title"] as? String)
      XCTAssertEqual(prompt.body, expected["body"] as? String)
      XCTAssertEqual(prompt.others, string(expected["others"]))
      XCTAssertEqual(prompt.note, expected["note"] as? String)
    }
    for item in try functionCases("pluginUpdateAll") {
      let all = pluginUpdateAll(summary(item.args[0]), stale: (item.args[1] as? [[String: Any]] ?? []).map(site), latestVersion: item.args[2] as? String ?? "")
      let expected = object(item.result)
      XCTAssertEqual(all.label, expected["label"] as? String)
      XCTAssertEqual(all.target, expected["target"] as? String)
      XCTAssertEqual(all.hostIDs, expected["hostIds"] as? [String], "\(item.args)")
    }
    for item in try functionCases("installedPluginCaption") {
      let input = object(item.args[0])
      XCTAssertEqual(
        installedPluginCaption(version: versionText(input["version"]), orgWide: input["orgWide"] as? Bool == true, siteLabels: input["siteLabels"] as? [String] ?? []),
        item.result as? String, "\(item.args)")
    }
    for item in try functionCases("installPlanOutcome") {
      let input = object(item.args[0])
      let outcome = installPlanOutcome(
        name: input["name"] as? String ?? "", installed: (input["installed"] as? NSNumber)?.intValue ?? 0, errors: input["errors"] as? [String] ?? [],
        orgWide: input["orgWide"] as? Bool == true, updating: input["updating"] as? Bool == true, version: string(input["version"]),
        saved: input["saved"] as? Bool == true)
      let expected = object(item.result)
      XCTAssertEqual(outcome.tone, expected["tone"] as? String, "\(item.args)")
      XCTAssertEqual(outcome.text, expected["text"] as? String, "\(item.args)")
    }
    XCTAssertEqual(pluginOrgWideUpdateNote.count > 40, true)
  }

  func testTheUninstallDialogSaysWhatTheConsoleSaysAndAsksForTheWordWhereItShould() throws {
    for item in try functionCases("uninstallImpactView") {
      let input = object(item.args[0])
      let targets = (input["targets"] as? [[String: Any]] ?? []).map {
        UninstallTarget(hostID: $0["hostId"] as? String ?? "", label: $0["label"] as? String ?? "", stillCovered: $0["stillCovered"] as? Bool == true)
      }
      let impactJSON = input["impact"].flatMap { $0 is NSNull ? nil : $0 }
      let impact = try impactJSON.map { try XCTUnwrap(UninstallImpact(JSONValue.decode(JSONSerialization.data(withJSONObject: $0)))) }
      let view = uninstallImpactView(
        name: input["name"] as? String ?? "", scope: InstallTarget(rawValue: input["scope"] as? String ?? "") ?? .host,
        pluginID: input["pluginId"] as? String ?? "", targets: targets, impact: impact, failed: input["failed"] as? Bool == true)
      let expected = object(item.result)
      XCTAssertEqual(view.title, expected["title"] as? String, "\(item.args)")
      XCTAssertEqual(view.confirmLabel, expected["confirmLabel"] as? String, "\(item.args)")
      XCTAssertEqual(view.scanning, expected["scanning"] as? Bool, "\(item.args)")
      XCTAssertEqual(view.needsAcknowledgement, expected["needsAcknowledgement"] as? Bool, "\(item.args)")
      XCTAssertEqual(view.note, string(expected["note"]), "\(item.args)")
      XCTAssertEqual(view.alerts.map { [$0.tone, $0.text] }, (expected["alerts"] as? [[String: Any]] ?? []).map { [$0["tone"] as? String ?? "", $0["text"] as? String ?? ""] }, "\(item.args)")
      XCTAssertEqual(
        view.sites.map { [$0.label, $0.pages, $0.chips.joined(separator: "|")] },
        (expected["sites"] as? [[String: Any]] ?? []).map { [$0["label"] as? String ?? "", $0["pages"] as? String ?? "", ($0["chips"] as? [String] ?? []).joined(separator: "|")] },
        "\(item.args)")
    }
  }

  func testAPluginsSettingsAreDrawnFromItsManifestAsTheConsoleDrawsThem() throws {
    for item in try functionCases("manifestSettingsScreen") {
      let manifest: JSONValue? = item.args[2] is NSNull ? nil : manifestJSON(item.args[2])
      let screen = manifestSettingsScreen(pluginID: item.args[0] as? String ?? "", label: item.args[1] as? String ?? "", manifest: manifest)
      if item.result is NSNull {
        XCTAssertNil(screen, "\(item.args)")
      } else {
        let expected = JSONValue.decode(try JSONSerialization.data(withJSONObject: item.result))
        XCTAssertEqual(screen, expected, "\(item.args)")
        // And it is a screen the renderer takes.
        XCTAssertNotNil(screen.flatMap(ScreenSpec.init))
      }
    }
  }

  /// The slots the workspace's plugin pages hand the marketplace are the ones the console fills.
  @MainActor
  func testItFillsTheTwoSlotsOfThePluginPages() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(
      screens: [
        "marketplace.browse", "marketplace.installed", "marketplace.licenses", "marketplace.listing", "marketplace.plugin-settings", "marketplace.sell",
        "marketplace.publish", "marketplace.publishTemplate", "marketplace.publisherAgreement", "marketplace.publishLayout", "marketplace.publishComponent",
        "marketplace.publishTheme", "marketplace.publishDatasetSchema", "marketplace.publishEmailTemplate", "marketplace.publishEmailStarter",
        "marketplace.publishPlugin",
      ],
      widgets: ["marketplace.artifact-publish", "marketplace.org-installs", "marketplace.plugin-installation"], quickActions: ["marketplace.open"],
      deepLinks: ["marketplace.listing-page", "marketplace.page"])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "marketplace", contributes: declared, register: registerMarketplaceNative)], into: registry)
    XCTAssertEqual(result.loaded, ["marketplace"])
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "orgPluginInstalls").map(\.id), ["marketplace.org-installs"])
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "pluginInstallation").map(\.id), ["marketplace.plugin-installation"])
    // A site's component and layout pages offer Publish to marketplace because this slot is filled.
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "hostArtifactPublish").map(\.id), ["marketplace.artifact-publish"])
    XCTAssertEqual(registry.widgets(for: .aglyn).filter { $0.pluginID == "marketplace" }.map(\.id), [], "never on Home")
  }
}
