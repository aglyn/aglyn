// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays navcore's cases (AGL-3943) for the nav manifest, the account preferences and the one box: the TypeScript's own
/// answers, so the Apple shell pins, rails, stars and searches exactly as the console and the Kotlin apps do.
final class NavContractsTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: try! Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private struct Case {
    let args: [Any]
    let result: Any
    var label: String { "\(args) → \(result)" }
  }

  private func cases(_ name: String, file: StaticString = #filePath, line: UInt = #line) -> [Case] {
    guard let entry = Self.functions[name] as? [String: Any], let list = entry["cases"] as? [[String: Any]], !list.isEmpty
    else {
      XCTFail("no cases for \(name)", file: file, line: line)
      return []
    }
    return list.map { Case(args: $0["args"] as? [Any] ?? [], result: $0["result"] as Any) }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
    try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
  }

  private func strings(_ value: Any) -> [String] { (value as? [Any] ?? []).compactMap { $0 as? String } }
  private func profile(_ value: Any) -> [String: Any]? { value as? [String: Any] }
  private func number(_ value: Any) -> Int { (value as? NSNumber)?.intValue ?? 0 }

  /// A ref as the TypeScript takes it: a partial object still reaches the function, which refuses it.
  private func ref(_ value: Any) -> AccountItemRef {
    let raw = value as? [String: Any] ?? [:]
    return AccountItemRef(
      hostId: raw["hostId"] as? String, id: raw["id"] as? String ?? "", kind: raw["kind"] as? String ?? "",
      label: raw["label"] as? String ?? "", orgId: raw["orgId"] as? String ?? "",
      params: raw["params"] as? [String: String], screen: raw["screen"] as? String ?? "")
  }

  private func starred(_ value: Any) -> [StarredItem] { readStarred(["starred": value]) }
  private func recents(_ value: Any) -> [RecentItem] { readRecents(["recents": value]) }

  func testPinsReadCapAndChangeAsTheConsoleDoes() throws {
    for item in cases("readPinnedOrgs") { XCTAssertEqual(readPinnedOrgs(profile(item.args[0])), strings(item.result), item.label) }
    for item in cases("effectivePinnedOrgs") {
      XCTAssertEqual(effectivePinnedOrgs(strings(item.args[0])), strings(item.result), item.label)
    }
    for item in cases("pinnedOrgsOverCap") {
      XCTAssertEqual(pinnedOrgsOverCap(strings(item.args[0])), item.result as? Bool, item.label)
    }
    for item in cases("pinOrg") {
      XCTAssertEqual(
        pinOrg(strings(item.args[0]), item.args[1] as? String ?? ""), try decode(PinOrgResult.self, item.result), item.label)
    }
    for item in cases("unpinOrg") {
      XCTAssertEqual(unpinOrg(strings(item.args[0]), item.args[1] as? String ?? ""), strings(item.result), item.label)
    }
    for item in cases("replacePinnedOrg") {
      XCTAssertEqual(
        replacePinnedOrg(strings(item.args[0]), replacing: item.args[1] as? String ?? "", with: item.args[2] as? String ?? ""),
        strings(item.result), item.label)
    }
    for item in cases("keepPinnedOrgs") {
      XCTAssertEqual(keepPinnedOrgs(strings(item.args[0]), keep: strings(item.args[1])), strings(item.result), item.label)
    }
    for item in cases("movePinnedOrg") {
      XCTAssertEqual(
        movePinnedOrg(strings(item.args[0]), item.args[1] as? String ?? "", offset: number(item.args[2])),
        strings(item.result), item.label)
    }
  }

  func testTheRailHoldsPinsRecentsAndTheAllTile() throws {
    for item in cases("readRecentOrgs") { XCTAssertEqual(readRecentOrgs(profile(item.args[0])), strings(item.result), item.label) }
    for item in cases("recordRecentOrg") {
      XCTAssertEqual(recordRecentOrg(strings(item.args[0]), item.args[1] as? String ?? ""), strings(item.result), item.label)
    }
    for item in cases("railWorkspaces") {
      XCTAssertEqual(
        railWorkspaces(strings(item.args[0]), pinned: strings(item.args[1]), recent: strings(item.args[2])),
        try decode(RailWorkspaces.self, item.result), item.label)
    }
    for item in cases("workspaceInitial") {
      XCTAssertEqual(workspaceInitial(item.args[0] as? String ?? ""), item.result as? String, item.label)
    }
  }

  func testStarsAndRecentsKeepTheirShape() throws {
    for item in cases("accountItemKey") {
      let value = ref(item.args[0])
      XCTAssertEqual(value.key, item.result as? String, item.label)
    }
    for item in cases("readStarred") {
      XCTAssertEqual(readStarred(profile(item.args[0])), try decode([StarredItem].self, item.result), item.label)
    }
    for item in cases("toggleStarred") {
      XCTAssertEqual(
        toggleStarred(starred(item.args[0]), ref(item.args[1]), nowMs: number(item.args[2])),
        try decode(StarResult.self, item.result), item.label)
    }
    for item in cases("setStarColor") {
      let color = (item.args[2] as? String).flatMap(StarColor.init(rawValue:))
      XCTAssertEqual(
        setStarColor(starred(item.args[0]), key: item.args[1] as? String ?? "", color: color),
        try decode([StarredItem].self, item.result), item.label)
    }
    for item in cases("readRecents") {
      XCTAssertEqual(readRecents(profile(item.args[0])), try decode([RecentItem].self, item.result), item.label)
    }
    for item in cases("recordRecent") {
      XCTAssertEqual(
        recordRecent(recents(item.args[0]), ref(item.args[1]), nowMs: number(item.args[2])),
        try decode([RecentItem].self, item.result), item.label)
    }
  }

  func testWorkspaceColorsAndTheThemeReadAsTheConsoleReadsThem() throws {
    for item in cases("isAccountColor") {
      XCTAssertEqual(isAccountColor(item.args.first.flatMap { $0 is NSNull ? nil : $0 }), item.result as? Bool, item.label)
    }
    for item in cases("readWorkspaceColors") {
      XCTAssertEqual(readWorkspaceColors(profile(item.args[0])), item.result as? [String: String], item.label)
    }
    for item in cases("resolveWorkspaceColor") {
      func arg(_ index: Int) -> Any? { item.args[index] is NSNull ? nil : item.args[index] }
      XCTAssertEqual(
        resolveWorkspaceColor(
          picked: arg(0), brandColor: arg(1), logoColor: arg(2), useWorkspaceBrand: item.args[3] as? Bool ?? false,
          orgID: item.args.count > 4 ? arg(4) : nil),
        try decode(WorkspaceColor.self, item.result), item.label)
    }
    for item in cases("workspaceStableColor") {
      XCTAssertEqual(workspaceStableColor(item.args[0] is NSNull ? nil : item.args[0]), item.result as? String, item.label)
    }
    for item in cases("readAppTheme") {
      XCTAssertEqual(readAppTheme(profile(item.args[0])), try decode(AppThemePrefs.self, item.result), item.label)
    }
  }

  func testThePersonsPhotoAndNameResolveAsTheConsoleResolvesThem() throws {
    func arg(_ item: Case, _ index: Int) -> Any? { item.args[index] is NSNull ? nil : item.args[index] }
    for item in cases("readAccountPhoto") {
      XCTAssertEqual(
        readAccountPhoto(profile(item.args[0]), authPhotoURL: arg(item, 1)), item.result as? String, item.label)
    }
    for item in cases("readAccountName") {
      XCTAssertEqual(
        readAccountName(profile(item.args[0]), authDisplayName: arg(item, 1), email: arg(item, 2)),
        item.result as? String, item.label)
    }
  }

  func testTheManifestResolvesPerScope() throws {
    for item in cases("resolveNavList") {
      let listID = NativeNavListId(rawValue: item.args[0] as? String ?? "") ?? .unknown
      XCTAssertEqual(
        resolveNavList(listID, enabledPluginIds: strings(item.args[1]), hostAdmin: item.args[2] as? Bool ?? false),
        try decode(ResolvedNavList.self, item.result), "resolveNavList \(item.args[0]) \(item.args[1])")
    }
  }

  func testTheCreateMenuResolvesPerScope() throws {
    for item in cases("resolveCreateList") {
      let scope = NativeNavCreateScope(rawValue: item.args[0] as? String ?? "") ?? .unknown
      XCTAssertEqual(
        resolveCreateList(
          scope, enabledPluginIds: strings(item.args[1]), permissions: item.args[2] as? [String: Bool] ?? [:],
          features: item.args[3] as? [String: Bool] ?? [:], hostRole: item.args[4] as? String),
        try decode([ResolvedCreateItem].self, item.result), "resolveCreateList \(item.args)")
    }
  }

  func testAccentsDeriveAsTheConsoleDerivesThem() throws {
    for item in cases("deriveAccent") {
      let expected = item.result is NSNull ? nil : try decode(ThemeAccent.self, item.result)
      XCTAssertEqual(deriveAccent(item.args[0] as? String ?? ""), expected, item.label)
    }
  }

  func testThemesDeriveFromTheirPreviewsAsTheConsoleDerivesThem() throws {
    for item in cases("deriveThemeFromPreview") {
      XCTAssertEqual(
        deriveThemeFromPreview(try decode(ThemePreview.self, item.args[0]), darkRailSeed: item.args[1] as? String ?? ""),
        try decode(ThemeColorsPair.self, item.result), item.label)
    }
  }

  func testRolesGrantAsTheConsoleResolvesThem() throws {
    for item in cases("rolePermissions") {
      XCTAssertEqual(
        rolePermissions(
          ContractValues.shared.orgRoleGrants, role: item.args[0] as? String, customRole: item.args[1] as? [String: Any],
          overrides: item.args[2] as? [String: Any]),
        item.result as? [String: Bool], item.label)
    }
  }

  func testTheOneBoxPagesAndFindsScreensAsTheRouteDoes() throws {
    for item in cases("oneBoxLimit") { XCTAssertEqual(oneBoxLimit(item.args[0]), number(item.result), item.label) }
    for item in cases("oneBoxCursor") { XCTAssertEqual(oneBoxCursor(item.args[0]), number(item.result), item.label) }
    for item in cases("oneBoxQuery") { XCTAssertEqual(oneBoxQuery(item.args[0]), item.result as? String, item.label) }
    for item in cases("searchNavScreens") {
      let expected = (item.result as? [[String: Any]] ?? []).map { entry in
        (row: try! decode(OneBoxRow.self, entry["row"] as Any), score: number(entry["score"] as Any))
      }
      let found = searchNavScreens(
        item.args[0] as? String ?? "", scope: item.args[1] as? String ?? "", enabledPluginIds: strings(item.args[2]),
        hostAdmin: item.args[3] as? Bool ?? false)
      XCTAssertEqual(found.map(\.row), expected.map(\.row), "searchNavScreens \(item.args)")
      XCTAssertEqual(found.map(\.score), expected.map(\.score), "searchNavScreens \(item.args)")
    }
  }

  func testEveryManifestScreenIsNamedOnce() {
    let lists = NativeNav.manifest.lists
    XCTAssertEqual(Set(lists.map(\.id)), [.workspace, .site, .workspaceSettings, .siteSettings])
    for list in lists {
      let ids = list.groups.flatMap(\.rows).map(\.id)
      XCTAssertEqual(ids.count, Set(ids).count, "\(list.id) repeats a row")
    }
  }
}
