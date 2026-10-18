// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import XCTest

@testable import AglynSite

/// The Kotlin `SiteTest`'s component, layout and template cases on the Swift port.
@MainActor
final class ArtifactTests: XCTestCase {
  private func doc(_ id: String, _ fields: [String: Any]) -> FirestoreDocument { FirestoreDocument(id: id, data: fields) }

  private func has(_ query: FirestoreQuery, _ path: String, _ op: ListQueryOp, _ value: Any) -> Bool {
    query.filters.contains { constraint in
      guard constraint.path == path, constraint.op == op else { return false }
      if let text = value as? String { return constraint.value as? String == text }
      if let flag = value as? Bool { return constraint.value as? Bool == flag }
      return false
    }
  }

  func testPlansTheArtifactListsAsTheConsoleDoes() {
    let components = artifactQuery(.component, hostID: "h", search: "Hero ban", kindFilter: "email", limit: 26)
    XCTAssertEqual(components.path, "hosts/h/components")
    XCTAssertTrue(has(components, "kind", .equal, "email"))
    XCTAssertTrue(has(components, "nameTokens", .arrayContains, "hero"))
    XCTAssertEqual(components.order.first?.field, "__name__")
    // The template library lists only its library rows.
    let templates = artifactQuery(.template, hostID: "h", search: "", kindFilter: nil, limit: 26)
    XCTAssertTrue(has(templates, "libraryRow", .equal, true))
    XCTAssertEqual(artifactQuery(.layout, hostID: "h", search: "", kindFilter: nil, limit: 26).path, "hosts/h/layouts")
    XCTAssertEqual(ArtifactKind.template.kindChoices.first?.label, "All")
    XCTAssertTrue(ArtifactKind.layout.kindChoices.isEmpty)
    XCTAssertNil(ArtifactKind.template.versionKind)
  }

  func testReadsArtifactsAndPicksTheVersionTheBesignerOpens() {
    let row = ArtifactRow(doc("c1", ["displayName": "Hero", "kind": "email"]))!
    XCTAssertNil(ArtifactRow(doc("c2", ["deletedAt": Date(timeIntervalSince1970: 1)])))
    let versions = [
      ArtifactVersion(doc("old", ["createdAt": Date(timeIntervalSince1970: 1)])),
      ArtifactVersion(doc("new", ["createdAt": Date(timeIntervalSince1970: 5)])),
    ]
    XCTAssertEqual(versionToOpen(row, versions: versions), "new")
    XCTAssertEqual(versionToOpen(row, versions: versions, asked: "old"), "old")
    XCTAssertNil(versionToOpen(row, versions: []))
    XCTAssertEqual(artifactBesignerPath(.component, id: "c1", versionID: "v1"), "/components/c1/versions/v1/besigner")
    XCTAssertEqual(artifactBesignerPath(.template, id: "t1", versionID: nil, preview: true), "/templates/t1/preview")
    XCTAssertNil(artifactBesignerPath(.layout, id: "l1", versionID: nil))
    XCTAssertTrue(DeepLinks.isBesignerPath("/acme/hosts/shop" + artifactBesignerPath(.layout, id: "l1", versionID: "v1")!))
    XCTAssertTrue(DeepLinks.isBesignerPath("/acme/hosts/shop" + artifactBesignerPath(.template, id: "t1", versionID: nil)!))
    XCTAssertEqual(componentPlacementLabel(nil), "Page")
    XCTAssertEqual(componentPlacementLabel("email"), "Email")
    XCTAssertEqual(templateSourceLabel(nil), "Saved here")
    XCTAssertEqual(templateSourceLabel("starter"), "Starter")
    XCTAssertEqual(templateSourceLabel("plugin"), "Plugin")
    XCTAssertEqual(dependentLabel("screen"), "Page")
    XCTAssertEqual(dependentLabel("widget"), "Widget")
    let bundle = ArtifactRow(doc("t1", ["source": ["type": "starter", "starterId": "s1", "starterName": "Bakery", "starterOrder": 2], "libraryRow": true]))!
    XCTAssertTrue(bundle.isStarterBundle)
    XCTAssertEqual(bundle.starterOrder, 2)
    XCTAssertTrue(bundle.libraryRow)
  }

  func testNeverNestsALayoutInsideItself() {
    func layout(_ id: String, _ parent: String?) -> ArtifactRow {
      var fields: [String: Any] = ["displayName": id]
      if let parent { fields["layoutId"] = parent }
      return ArtifactRow(doc(id, fields))!
    }
    let layouts = [layout("a", nil), layout("b", "a"), layout("c", "b"), layout("d", nil)]
    // b sits under a; c under b. a may not go inside b or c (its own descendants).
    XCTAssertEqual(nestableParents(of: "a", in: layouts).map(\.id), ["d"])
    XCTAssertEqual(nestableParents(of: "c", in: layouts).map(\.id), ["a", "b", "d"])
  }

  func testBuildsTheStartingCanvases() {
    XCTAssertEqual(Set(blankCanvas().keys), ["_@_"])
    let canvas = layoutCanvas(slotID: "slot1")
    XCTAssertEqual(Set(canvas.keys), ["_@_", "slot1"])
    XCTAssertEqual((canvas["slot1"] as? [String: Any])?["componentId"] as? String, "layoutSlot")
    XCTAssertEqual((canvas["_@_"] as? [String: Any])?["nodes"] as? [String], ["slot1"])
  }

  func testOffersTheConsolesHeaderSortsAndPlansThem() throws {
    // Every declared column order but the default walk; labels read like the console's headers.
    let components = artifactSortChoices(.component).map(artifactSortLabel)
    XCTAssertTrue(components.contains("Display name \u{2191}"))
    XCTAssertTrue(components.contains("Display name \u{2193}"))
    XCTAssertTrue(components.contains("Used in \u{2191}"))
    XCTAssertTrue(components.contains("Updated \u{2193}"))
    XCTAssertTrue(components.contains("ID \u{2193}"))
    XCTAssertFalse(components.contains("ID \u{2191}"))
    XCTAssertFalse(artifactSortChoices(.layout).isEmpty)
    XCTAssertFalse(artifactSortChoices(.template).isEmpty)

    // A header sort orders the query by the column's stored value; with nothing else on, it is served as asked.
    let byName = try XCTUnwrap(artifactSortChoices(.layout).first { $0.column == "displayName" && $0.direction == .desc })
    let sorted = artifactQuery(.layout, hostID: "h", search: "", kindFilter: nil, sort: byName, limit: 26)
    XCTAssertEqual(sorted.order.first?.field, "nameLower")
    XCTAssertEqual(sorted.order.first?.descending, true)
    XCTAssertTrue(artifactPlan(.layout, search: "", kindFilter: nil, sort: byName).notices.isEmpty)

    // A column that sorts only with nothing else on falls back to the default header order, and says so.
    let plan = artifactPlan(.layout, search: "hero", kindFilter: nil, sort: byName)
    XCTAssertEqual(plan.notices.count, 1)
    XCTAssertTrue(plan.notices[0].hasPrefix("Sorted by"))
    XCTAssertNotEqual(plan.orderBy.path, "nameLower")
  }

  func testReadsThePlansCapAndCountsAsTheCreateRouteDoes() {
    let body: JSONValue = ["quotas": ["componentsPerHost": 1, "sharedLayoutsPerHost": nil, "templatesPerHost": 50]]
    XCTAssertEqual(artifactQuotaLimit(body, kind: .component), 1)
    XCTAssertNil(artifactQuotaLimit(body, kind: .layout))
    XCTAssertEqual(artifactQuotaLimit(body, kind: .template), 50)
    XCTAssertNil(artifactQuotaLimit(nil, kind: .component))
    XCTAssertEqual(ArtifactKind.component.quotaKey, "componentsPerHost")
    XCTAssertEqual(ArtifactKind.layout.quotaKey, "sharedLayoutsPerHost")
    XCTAssertEqual(ArtifactKind.template.quotaKey, "templatesPerHost")
    XCTAssertEqual(AglynQuotaReadout.text(ready: true, used: 3, limit: 10, noun: "layout"), "3/10 layouts on your plan")
    XCTAssertEqual(AglynQuotaReadout.text(ready: true, used: 3, limit: nil, noun: "component"), "3/\u{221E} components on your plan")
    XCTAssertEqual(AglynQuotaReadout.text(ready: false, used: 1, limit: nil, noun: "template"), "1 template")

    // Components and layouts: everything less the tombstones. Templates: everything that is not a starter's page.
    let layouts = artifactCountQueries(.layout, hostID: "h")
    XCTAssertEqual(layouts.total.path, "hosts/h/layouts")
    XCTAssertTrue(layouts.total.allFilters.isEmpty)
    XCTAssertEqual(layouts.subtract?.allFilters.first?.path, "deletedAt")
    XCTAssertEqual(layouts.subtract?.allFilters.first?.op, .greaterThan)
    let templates = artifactCountQueries(.template, hostID: "h")
    XCTAssertEqual(templates.total.allFilters.first?.path, "source.type")
    XCTAssertEqual(templates.total.allFilters.first?.op, .notEqual)
    XCTAssertNil(templates.subtract)
    XCTAssertEqual(artifactLiveCount(total: 7, subtract: 2), 5)
    XCTAssertEqual(artifactLiveCount(total: 1, subtract: 2), 0)
    XCTAssertEqual(artifactLiveCount(total: 4, subtract: nil), 4)
  }

  /// AGL-3918: a deleted template frees its slot. The tombstones are read and the ones the starter-excluding count
  /// included are subtracted: set, and not a starter's.
  func testSubtractsTheDeletedTemplatesTheCountIncluded() {
    let query = templateTombstoneQuery(hostID: "h")
    XCTAssertEqual(query.path, "hosts/h/templates")
    XCTAssertEqual(query.allFilters.first?.path, "deletedAt")
    XCTAssertEqual(query.allFilters.first?.op, .greaterThan)
    let tombstones = [
      FirestoreDocument(id: "a", data: ["source": ["type": "authored"]]),
      FirestoreDocument(id: "b", data: ["source": ["type": "marketplace"]]),
      FirestoreDocument(id: "c", data: ["source": ["type": "starter"]]),
      FirestoreDocument(id: "d", data: [:]),
    ]
    XCTAssertEqual(deletedTemplatesCounted(tombstones), 2)
  }

  func testOpensTheArtifactListsNatively() {
    let registry = NativePluginRegistry()
    _ = NativePluginLoader.load(NativePlatformEntries.entries, into: registry)
    let site = ["orgSlug": "acme", "hostSlug": "shop"]
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/components"), .screen("site.components", site))
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/layouts/l1"), .screen("site.layouts", site.merging(["id": "l1"]) { $1 }))
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/layouts/list"), .screen("site.layouts", site))
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/templates"), .screen("site.templates", site))
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/components/c1/versions/v1/besigner"),
      .besigner("/acme/hosts/shop/components/c1/versions/v1/besigner"))
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/templates/t1/besigner"), .besigner("/acme/hosts/shop/templates/t1/besigner"))
    XCTAssertEqual(SiteAreas.templates.screen, "site.templates")
  }
}
