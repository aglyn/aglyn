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
    XCTAssertEqual(priceLabel(row.priceUSD, buying: true), "$12")
    // A store build (the owner's decision of 2026-11-19) names no price.
    XCTAssertEqual(priceLabel(row.priceUSD, buying: false), "Paid")
    XCTAssertEqual(priceLabel(0, buying: false), "Free")
    // The card's foot word: Buy only where a payment may be taken; a free listing says Get in every build.
    XCTAssertEqual(listingCardAction(paid: row.paid, buying: true), "Buy")
    XCTAssertNil(listingCardAction(paid: row.paid, buying: false))
    XCTAssertEqual(listingCardAction(paid: false, buying: false), "Get")
    XCTAssertEqual(listingCardAction(paid: false, buying: true), "Get")
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
      "marketplace.publishLayout", "marketplace.publishPlugin", "marketplace.publishStarter", "marketplace.publishTemplate", "marketplace.publishTheme",
      "marketplace.publisherAgreement",
    ]
    XCTAssertEqual(specs.map(\.id).sorted(), ids)
    XCTAssertEqual(specs.first { $0.id == "marketplace.publishTemplate" }?.zones, ["siteTemplate"])
    XCTAssertEqual(specs.first { $0.id == "marketplace.publishStarter" }?.zones, ["siteTemplate"])
    let declared = SpecScreens.declaration(specs).screens
    XCTAssertEqual(declared.sorted(), ids)
  }

  /// The publish screens' "See plans" (the starter's plan step, the higher take rate) open Choose a plan, so a store build
  /// (the owner's decision of 2026-11-19) draws neither link and keeps the sentence above it. Kotlin: MarketplaceTest.
  @MainActor
  func testSeePlansOnThePublishScreensNeedsABuildThatMayBuy() throws {
    let specs = ScreenCatalog.load(from: .module)
    func context(buying: Bool) -> JSONValue {
      .object([
        "app": .object(["billing": .bool(buying), "billingLink": .bool(false)]),
        "data": .object([
          "facts": .object(["steps": .object(["plan": .string("Publishing to the marketplace is included from Starter.")])]),
          "fee": .object(["pct": .number(15), "paid": .number(5)]),
        ]),
      ])
    }
    var found: [String] = []
    for id in ["marketplace.publishStarter", "marketplace.publish"] {
      let spec = try XCTUnwrap(specs.first { $0.id == id }, id)
      for block in spec.blocks where block.type == "links" {
        guard block["items"]?.arrayValue?.contains(where: { $0["screen"]?.stringValue == "core.billing.plans" }) == true else { continue }
        found.append(id)
        XCTAssertTrue(ScreenValues.condition(block.when, in: context(buying: true)), id)
        XCTAssertFalse(ScreenValues.condition(block.when, in: context(buying: false)), id)
      }
      // The sentence the link sat under stays in both builds.
      let notice = try XCTUnwrap(spec.blocks.first { $0.type == "notice" && ($0.id == "step-plan" || $0.id == "fee-higher") }, id)
      XCTAssertTrue(ScreenValues.condition(notice.when, in: context(buying: false)), id)
    }
    XCTAssertEqual(found, ["marketplace.publishStarter", "marketplace.publish"])
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
      pinnedBy: InstallTarget(rawValue: json["pinnedBy"] as? String ?? "") ?? .org, shadowed: json["shadowed"] as? Bool == true,
      switchedOff: json["switchedOff"] as? Bool == true)
  }

  private func siteJSON(_ site: OrgInstallSite) -> [String: Any?] {
    var json: [String: Any?] = [
      "hostId": site.hostID, "label": site.label, "version": site.version, "pinnedBy": site.pinnedBy.rawValue, "shadowed": site.shadowed,
    ]
    if site.switchedOff { json["switchedOff"] = true }
    return json
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
      let hosts = (item.args[0] as? [[String: Any]] ?? []).map {
        SiteChoice(id: $0["id"] as? String ?? "", label: $0["label"] as? String ?? "", disabledPlugins: $0["disabledPlugins"] as? [String])
      }
      var pins: [String: PinVersion] = [:]
      for (key, value) in object(item.args[1]) where !(value is NSNull) { pins[key] = PinVersion(version: versionText(object(value)["version"])) }
      let org: PinVersion? = item.args[2] is NSNull ? nil : PinVersion(version: versionText(object(item.args[2])["version"]))
      let result = resolveOrgInstallSummary(
        hosts: hosts, hostPins: pins, orgPin: org, listingID: item.args.count > 3 ? item.args[3] as? String : nil)
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
        installedPluginCaption(
          version: versionText(input["version"]), orgWide: input["orgWide"] as? Bool == true, siteLabels: input["siteLabels"] as? [String] ?? [],
          switchedOff: input["switchedOff"] as? [String] ?? [], siteCount: (input["siteCount"] as? NSNumber)?.intValue),
        item.result as? String, "\(item.args)")
    }
    for item in try functionCases("installPictureReadPhase") {
      let input = object(item.args[0])
      let pin = input["orgPin"]
      let read = (pin as? [String: Any]).map {
        InstallPinRead(hasData: $0["data"] != nil && !($0["data"] is NSNull), status: $0["status"] as? String, fromCache: $0["fromCache"] as? Bool == true)
      }
      XCTAssertEqual(
        installPictureReadPhase(orgPinPending: pin as? String == "pending", orgPin: read, sitePins: input["sitePins"] as? String ?? ""),
        item.result as? String, "\(item.args)")
    }
    // The template gallery's shelf (the console's TemplateGalleryShelf).
    let plain = templateShelfQuery(search: "", limit: 24)
    XCTAssertEqual(plain.collection, [listingsCollection])
    XCTAssertEqual(plain.limit, 24)
    XCTAssertTrue("\(plain.filters) \(plain.equals)".contains("kind"))
    XCTAssertTrue("\(templateShelfQuery(search: " bakery ", limit: 24).filters)".contains("nameTokens"))
    XCTAssertEqual(templateShelfFacts(screenCount: 5, version: "3", priceUSD: 0), "5 pages · v3 · free")
    XCTAssertEqual(templateShelfFacts(screenCount: nil, version: "1.2.0", priceUSD: 12), "? pages · v1.2.0 · $12")
    // A store build (StoreBilling.buying off) says a paid template is paid, not its price, and offers no Use on it.
    XCTAssertEqual(templateShelfFacts(screenCount: 5, version: "3", priceUSD: 12, buying: false), "5 pages · v3 · paid")
    XCTAssertEqual(templateShelfFacts(screenCount: 5, version: "3", priceUSD: 0, buying: false), "5 pages · v3 · free")
    XCTAssertTrue(templateShelfOffersUse(priceUSD: 12, buying: true))
    XCTAssertFalse(templateShelfOffersUse(priceUSD: 12, buying: false))
    XCTAssertTrue(templateShelfOffersUse(priceUSD: 0, buying: false))
    XCTAssertEqual(
      templateInstalledMessage(added: 1, name: "Bakery"),
      "Saved 1 template from \"Bakery\" to your library — open Templates to create pages from them.")
    XCTAssertTrue(templateInstalledMessage(added: 5, name: "Bakery").hasPrefix("Saved 5 templates"))
    XCTAssertEqual(templateShelfState(offered: false, loading: true, visible: true), .empty)
    XCTAssertEqual(templateShelfState(offered: true, loading: true, visible: false), .loading)
    XCTAssertEqual(templateShelfState(offered: true, loading: false, visible: true), .shown)
    XCTAssertEqual(templateShelfState(offered: true, loading: false, visible: false), .empty)
    // The update review of a copied listing (AGL-1018): the console's provenance and change words.
    for item in try functionCases("resolveProvenance") {
      let doc = item.args.first as? [String: Any]
      let got = resolveProvenance(doc, fallbackArtifactType: item.args.count > 1 ? string(item.args[1]) : nil)
      let want = object(item.result)
      XCTAssertEqual(got.state, want["state"] as? String, "\(item.args)")
      XCTAssertEqual(got.listingID, string(want["listingId"]), "\(item.args)")
      XCTAssertEqual(got.version, string(want["version"]), "\(item.args)")
      XCTAssertEqual(got.sha256, string(want["sha256"]), "\(item.args)")
      XCTAssertEqual(got.artifactType, string(want["artifactType"]), "\(item.args)")
      XCTAssertEqual(got.publisherOrgID, string(want["publisherOrgId"]), "\(item.args)")
      XCTAssertEqual(got.updatable, want["updatable"] as? Bool, "\(item.args)")
    }
    for item in try functionCases("describeChange") {
      let change = object(item.args[0])
      XCTAssertEqual(
        describeChange(path: change["path"] as? String ?? "", added: change["added"] as? Bool == true, removed: change["removed"] as? Bool == true),
        item.result as? String, "\(item.args)")
    }
    for item in try functionCases("summarizeValue") {
      let json = try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: item.args, options: [.fragmentsAllowed]))
      XCTAssertEqual(summarizeValue(json.arrayValue?.first), item.result as? String, "\(item.args)")
    }
    XCTAssertEqual(summarizeValue(nil), "—")
    XCTAssertEqual(copyUpdateState(installed: ["marketplace": ["listingId": "l1", "version": "1.0.0"]], latestVersion: "1.2.0", artifactType: "component").state, "update-available")
    XCTAssertEqual(copyUpdateState(installed: ["marketplace": ["listingId": "l1", "version": "1.2.0"]], latestVersion: "1.2.0", artifactType: "component").state, "current")
    XCTAssertEqual(copyUpdateState(installed: ["marketplace": ["listingId": "l1"]], latestVersion: "1.2.0", artifactType: "component").state, "unknown")
    XCTAssertEqual(copyInstallLabel(state: "current", installedVersion: "1.2.0", offeredVersion: "1.2.0"), "Installed (v1.2.0)")
    XCTAssertEqual(copyInstallLabel(state: "update-available", installedVersion: "1.0.0", offeredVersion: "1.2.0"), "Review update to v1.2.0")
    XCTAssertEqual(copyInstallLabel(state: "unknown", installedVersion: nil, offeredVersion: "1.2.0"), "Review this version")
    let previewJSON = try JSONDecoder().decode(JSONValue.self, from: Data(#"""
      {"installedVersion":"1.0.0","availableVersion":"1.2.0","mergeable":true,"identical":false,"unchanged":4,
       "safe":[{"path":"a","current":1,"incoming":2}],"kept":[],"conflicts":[{"path":"b","current":null,"incoming":"x"},{"path":"c","added":true}],
       "schema":{"added":["f"],"removed":["g"],"retyped":[],"additiveOnly":false,"recordCount":12}}
      """#.utf8))
    let preview = ArtifactUpdatePreview(previewJSON)
    XCTAssertEqual(preview.versionLine, "You have v1.0.0; v1.2.0 is available.")
    XCTAssertEqual(preview.conflicts.map(\.path), ["b", "c"])
    XCTAssertEqual(summarizeValue(preview.conflicts[0].current), "null")
    XCTAssertEqual(summarizeValue(preview.conflicts[1].current), "—")
    XCTAssertTrue(preview.destructive)
    XCTAssertEqual(preview.schema?.recordCount, 12)
    XCTAssertEqual(preview.applyLabel(taken: 0), "Apply safe changes")
    XCTAssertEqual(preview.applyLabel(taken: 2), "Apply (2 taken from publisher)")
    XCTAssertEqual(ArtifactUpdatePreview(.object(["identical": .bool(true), "availableVersion": .string("3")])).applyLabel(taken: 1), "Take v3 (no content changes)")
    XCTAssertEqual(ArtifactUpdatePreview(.object(["availableVersion": .number(3)])).versionLine, "v3 is available.")
    XCTAssertEqual(
      artifactUpdateSummary(mode: "merge", answer: .object(["version": .string("1.2.0"), "applied": .number(3), "keptLocal": .number(1), "skipped": .array([.string("b")])])),
      "Updated to v1.2.0 — 3 change(s) applied, 1 of yours kept, 1 conflict(s) left as yours.")
    XCTAssertEqual(artifactUpdateSummary(mode: "merge", answer: .object(["version": .string("1.2.0")])), "Now on v1.2.0 — this version changes nothing in your copy.")
    XCTAssertEqual(
      artifactUpdateSummary(mode: "copy", answer: .object(["version": .number(2)])),
      "Installed v2 as a new copy — your customized version is kept, no longer linked to the listing.")
    // The template library's "Update available" (the console's TemplateInstallStatus).
    XCTAssertEqual(templateReplaceQuestion("Bakery").title, "Replace your edited copy?")
    XCTAssertTrue(templateReplaceQuestion("Bakery").message.hasPrefix("You have edited \"Bakery\" since installing it."))
    XCTAssertEqual(templateUpdatedMessage(version: "3"), "Updated to v3 — pages you already created are unchanged.")
    let installedTemplate: [String: Any] = ["source": ["type": "marketplace", "listingId": "l1", "version": "2"]]
    XCTAssertEqual(copyUpdateState(installed: installedTemplate, latestVersion: "3", artifactType: "template").state, "update-available")
    XCTAssertEqual(copyUpdateState(installed: installedTemplate, latestVersion: "2", artifactType: "template").state, "current")
    for item in try functionCases("verificationRequestBlock") {
      let input = object(item.args[0])
      XCTAssertEqual(
        verificationRequestBlock(
          listing: input["listing"] as? [String: Any], viewerOrgID: string(input["viewerOrgId"]),
          nowMs: (input["nowMs"] as? NSNumber)?.doubleValue ?? 0),
        string(item.result), "\(item.args)")
    }
    // The card: nothing for another workspace's listing or a verified one, nor a listing in review with nothing waiting.
    XCTAssertFalse(ListingVerificationSection.shows("not-publisher", state: nil))
    XCTAssertFalse(ListingVerificationSection.shows("already-verified", state: nil))
    XCTAssertFalse(ListingVerificationSection.shows("not-listed", state: nil))
    XCTAssertTrue(ListingVerificationSection.shows("not-listed", state: "pending"))
    XCTAssertTrue(ListingVerificationSection.shows(nil, state: nil))
    XCTAssertTrue(ListingVerificationSection.shows("cooling-down", state: "declined"))
    XCTAssertEqual(verificationTimestampMs(Date(timeIntervalSince1970: 2)), 2000)
    XCTAssertTrue(whatVerifiedClaims.contains(ContractValues.shared.platformBrandName))
    for item in try functionCases("installPlanOutcome") {
      let input = object(item.args[0])
      let outcome = installPlanOutcome(
        name: input["name"] as? String ?? "", installed: (input["installed"] as? NSNumber)?.intValue ?? 0, errors: input["errors"] as? [String] ?? [],
        orgWide: input["orgWide"] as? Bool == true, updating: input["updating"] as? Bool == true, version: string(input["version"]),
        saved: input["saved"] as? Bool == true, leftOut: (input["leftOut"] as? NSNumber)?.intValue ?? 0)
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
        "marketplace.publishPlugin", "marketplace.publishStarter",
      ],
      widgets: [
        "marketplace.artifact-publish", "marketplace.org-installs", "marketplace.plugin-installation", "marketplace.site-connections", "marketplace.template-gallery",
        "marketplace.template-install-status",
        "marketplace.starter-picker",
      ],
      quickActions: ["marketplace.open"],
      deepLinks: [
        "marketplace.listing-page", "marketplace.page", "marketplace.browse-page", "marketplace.installed-page",
        "marketplace.licences-page", "marketplace.sell-page",
      ])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "marketplace", contributes: declared, register: registerMarketplaceNative)], into: registry)
    XCTAssertEqual(result.loaded, ["marketplace"])
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "orgPluginInstalls").map(\.id), ["marketplace.org-installs"])
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "pluginInstallation").map(\.id), ["marketplace.plugin-installation"])
    // A site's plugin page shows its declared connections because this slot is filled (AGL-4196).
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "sitePluginConnections").map(\.id), ["marketplace.site-connections"])
    // A site's component and layout pages offer Publish to marketplace because this slot is filled.
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "hostArtifactPublish").map(\.id), ["marketplace.artifact-publish"])
    // Create site lists the starters because this slot is filled, and never names the plugin that fills it.
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "hostStarterPicker").map(\.id), ["marketplace.starter-picker"])
    XCTAssertEqual(registry.widgets(for: .aglyn).filter { $0.pluginID == "marketplace" }.map(\.id), [], "never on Home")

    // The hub's sections are pages of their own and win over a listing's `/marketplace/{id}` (AGL-4215): a payouts
    // notice opens Payouts, never a listing called "payouts".
    let org = ["orgSlug": "acme"]
    let cases: [(String, LinkTarget, UInt)] = [
      ("/acme/marketplace/payouts", .screen("marketplace.sell", ["orgSlug": "acme", "section": "payouts"]), #line),
      ("/acme/marketplace/listings", .screen("marketplace.sell", ["orgSlug": "acme", "section": "listings"]), #line),
      ("/acme/marketplace/profile", .screen("marketplace.sell", ["orgSlug": "acme", "section": "profile"]), #line),
      ("/acme/marketplace/sales", .screen("marketplace.sell", ["orgSlug": "acme", "section": "sales"]), #line),
      ("/acme/marketplace/browse", .screen("marketplace.browse", org), #line),
      ("/acme/marketplace/installed", .screen("marketplace.installed", org), #line),
      ("/acme/marketplace/licences", .screen("marketplace.licenses", org), #line),
      ("/acme/marketplace", .screen("marketplace.browse", org), #line),
      ("/acme/marketplace/upload", .unavailable("/acme/marketplace/upload"), #line),
      ("/acme/marketplace/l1", .screen("marketplace.listing", ["orgSlug": "acme", "listingId": "l1"]), #line),
    ]
    for (link, expected, line) in cases { XCTAssertEqual(registry.resolve(link), expected, link, line: line) }
  }
}
