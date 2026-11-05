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

  /// The phone's tab bar (AGL-4006): pins per scope, the first-opened default, and where Create goes.
  func testThePhoneTabBarPinsAsTheConsoleRulesSay() throws {
    func bars(_ value: Any) -> [TabBarPins] { readTabBars(["tabBars": value]) }
    func text(_ value: Any) -> String { value as? String ?? "" }
    for item in cases("tabBarScope") {
      let host = item.args.count > 1 ? item.args[1] as? String : nil
      XCTAssertEqual(tabBarScope(orgID: text(item.args[0]), hostID: host), item.result as? String, item.label)
    }
    for item in cases("readTabBars") {
      XCTAssertEqual(readTabBars(profile(item.args[0])), try decode([TabBarPins].self, item.result), item.label)
    }
    for item in cases("tabBarAreas") {
      XCTAssertEqual(tabBarAreas(bars(item.args[0]), scope: text(item.args[1])), strings(item.result), item.label)
    }
    for item in cases("pinTabArea") {
      XCTAssertEqual(
        pinTabArea(bars(item.args[0]), scope: text(item.args[1]), area: text(item.args[2])),
        try decode(TabPinResult.self, item.result), item.label)
    }
    for item in cases("unpinTabArea") {
      XCTAssertEqual(
        unpinTabArea(bars(item.args[0]), scope: text(item.args[1]), area: text(item.args[2])),
        try decode([TabBarPins].self, item.result), item.label)
    }
    for item in cases("moveTabArea") {
      XCTAssertEqual(
        moveTabArea(bars(item.args[0]), scope: text(item.args[1]), area: text(item.args[2]), offset: number(item.args[3])),
        try decode([TabBarPins].self, item.result), item.label)
    }
    for item in cases("setTabAreas") {
      XCTAssertEqual(
        setTabAreas(bars(item.args[0]), scope: text(item.args[1]), areas: strings(item.args[2])),
        try decode([TabBarPins].self, item.result), item.label)
    }
    for item in cases("autoPinTabArea") {
      XCTAssertEqual(
        autoPinTabArea(bars(item.args[0]), scope: text(item.args[1]), area: text(item.args[2])),
        try decode([TabBarPins].self, item.result), item.label)
    }
    for item in cases("tabBarLayout") {
      XCTAssertEqual(
        tabBarLayout(strings(item.args[0]), available: strings(item.args[1])), try decode(TabBarLayout.self, item.result),
        item.label)
    }
  }

  /// The phone's Home (AGL-4006): every area as the same tile, More headed Tools, the scope's own places last.
  func testThePhoneHomeGroupsEveryAreaAsTheConsoleRulesSay() throws {
    for item in cases("phoneHomeGroups") {
      let list = try decode(ResolvedNavList.self, item.args[0])
      let team = item.args[1] is NSNull ? nil : try decode(NativeNavRow.self, item.args[1])
      XCTAssertEqual(
        phoneHomeGroups(list, team: team, ownerName: item.args[2] as? String ?? ""),
        try decode([PhoneHomeGroup].self, item.result), item.label)
    }
    for item in cases("isTabPinnable") {
      let screen = (item.args[0] as? [String: Any])?["screen"] as? String ?? ""
      XCTAssertEqual(isTabPinnable(screen: screen), item.result as? Bool, item.label)
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

  func testAMemberStampDecidesOverTheirRole() {
    let catalog = ContractValues.shared.orgRoleGrants
    // The stamp wins both ways, and a key it lacks falls back to the role.
    let member: [String: Any] = ["role": "editor", "resolvedPermissions": ["data.manage": false, "billing.manage": true, "plugin.only": true]]
    let held = memberPermissions(catalog, member: member, orgRole: "editor")
    XCTAssertEqual(held["data.manage"], false)
    XCTAssertEqual(held["billing.manage"], true)
    XCTAssertEqual(held["plugin.only"], true)
    XCTAssertEqual(held["org.media"], true)
    // Before the row is read, the membership index's role answers; with neither, nothing is held.
    XCTAssertEqual(memberPermissions(catalog, member: nil, orgRole: "viewer")["data.manage"], false)
    XCTAssertEqual(memberPermissions(catalog, member: nil, orgRole: "admin")["data.manage"], true)
    XCTAssertTrue(memberPermissions(catalog, member: nil, orgRole: nil).isEmpty)
    // A custom role counts only for a member who carries its id.
    let custom: [String: Any] = ["permissions": ["hosts.create": true]]
    XCTAssertEqual(memberPermissions(catalog, member: ["role": "viewer", "roleId": "r1"], orgRole: nil, customRole: custom)["hosts.create"], true)
    XCTAssertEqual(memberPermissions(catalog, member: ["role": "viewer"], orgRole: nil, customRole: custom)["hosts.create"], false)
  }

  func testASiteStampNarrowsTheWorkspaceVerdict() {
    let workspace = ["managePos": true, "data.manage": true]
    let site = sitePermissions(workspace, siteStamp: ["managePos": false])
    XCTAssertEqual(site["managePos"], false)
    XCTAssertEqual(site["data.manage"], true)
    XCTAssertEqual(sitePermissions(workspace, siteStamp: nil), workspace)
  }

  func testAPermissionEditorOffersTheWorkspacesKeysByGroup() {
    let catalog = ContractValues.shared.orgRoleGrants
    let all = permissionEditorRows(catalog, enabledPlugins: nil)
    XCTAssertEqual(all.count, catalog.permissions.count)
    XCTAssertEqual(all.first?.first, true)
    XCTAssertEqual(all.first?.groupLabel, "Organization")
    // Each group's heading goes on its first row, and a group's rows sit together.
    XCTAssertEqual(Set(all.filter(\.first).map(\.group)).count, all.filter(\.first).count)
    // A plugin's keys show only while it is on; the core's always do.
    let none = permissionEditorRows(catalog, enabledPlugins: [])
    XCTAssertFalse(none.contains { $0.key == "marketplace.payouts" })
    XCTAssertTrue(none.contains { $0.key == "members.manage" })
    XCTAssertTrue(permissionEditorRows(catalog, enabledPlugins: ["marketplace"]).contains { $0.key == "marketplace.payouts" })
    // Only the keys a site can narrow ask the narrowing choice.
    let narrow = permissionEditorRows(catalog, enabledPlugins: nil, narrowable: true)
    XCTAssertTrue(narrow.contains { $0.key == "managePos" })
    XCTAssertFalse(narrow.contains { $0.key == "members.manage" })
  }

  func testARefusalNamesThePermission() {
    XCTAssertEqual(
      permissionRefusalText(ContractValues.shared.orgRoleGrants, key: "marketplace.payouts"),
      "Your role does not include \"Manage marketplace payouts\" — ask an organization admin")
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
