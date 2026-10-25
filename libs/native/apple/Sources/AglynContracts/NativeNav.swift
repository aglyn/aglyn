// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The native apps' navigation as data (AGL-3943): the generated manifest, and ports of `resolveNavList`
// (native-nav.ts), the one-box's paging and screens-and-settings matches (one-box-search.ts) and the console's name
// matcher (name-match.ts), each replayed against the TypeScript's own cases in FunctionCasesTests.

public enum NativeNav {
  /// The manifest both shells draw.
  public static var manifest: NativeNavManifest { ContractValues.shared.nativeNavManifest }

  /// The shells' own destinations (`shell.home`, `shell.analytics`, the two settings modes).
  public static let home = "shell.home"
  public static let analytics = "shell.analytics"
  public static let workspaceSettings = "shell.workspaceSettings"
  public static let siteSettings = "shell.siteSettings"
}

/// One list of the app's own manifest as one scope shows it.
public func resolveNavList(_ listID: NativeNavListId, enabledPluginIds: [String], hostAdmin: Bool) -> ResolvedNavList {
  resolveNavList(NativeNav.manifest, listID, enabledPluginIds: enabledPluginIds, hostAdmin: hostAdmin)
}

/// One list as one scope shows it: rows of plugins that are off, or admin rows for a non-admin, left out; a section of
/// another plugin than its row's hides with that plugin; a group left empty is dropped, except the starred group.
public func resolveNavList(
  _ manifest: NativeNavManifest, _ listID: NativeNavListId, enabledPluginIds: [String], hostAdmin: Bool
) -> ResolvedNavList {
  guard let list = manifest.lists.first(where: { $0.id == listID }) else {
    return ResolvedNavList(groups: [], id: listID)
  }
  let on = Set(enabledPluginIds)
  func shows(_ pluginID: String?) -> Bool { pluginID.map(on.contains) ?? true }
  var groups: [NativeNavGroup] = []
  for group in list.groups {
    let rows = group.rows
      .filter { shows($0.pluginId) && (hostAdmin || $0.requiresHostAdmin != true) }
      .map { row -> NativeNavRow in
        guard let sections = row.sections else { return row }
        var next = row
        next.sections = sections.filter { shows($0.pluginId) }
        return next
      }
    if rows.isEmpty && group.dynamic == nil { continue }
    var next = group
    next.rows = rows
    groups.append(next)
  }
  return ResolvedNavList(groups: groups, id: list.id, title: list.title)
}

// MARK: Create new (resolveCreateList)

/// The Create new menu of the app's own manifest for the workspace or site in hand.
public func resolveCreateList(
  _ scope: NativeNavCreateScope, enabledPluginIds: [String], permissions: [String: Bool], features: [String: Bool],
  hostRole: String?
) -> [ResolvedCreateItem] {
  resolveCreateList(
    NativeNav.manifest, scope, enabledPluginIds: enabledPluginIds, permissions: permissions, features: features,
    hostRole: hostRole)
}

/// The Create new menu for the workspace or site in hand. An item of a plugin that is off is not offered, nor an
/// admin-only item to a non-admin. One the person may not use is shown, disabled with its reason: a permission or site
/// role they lack, then a plan feature the workspace lacks. `permissions` and `features` are the workspace's resolved
/// answers (an absent key is not held); `hostRole` is the person's role on the site, nil at the workspace.
public func resolveCreateList(
  _ manifest: NativeNavManifest, _ scope: NativeNavCreateScope, enabledPluginIds: [String], permissions: [String: Bool],
  features: [String: Bool], hostRole: String?
) -> [ResolvedCreateItem] {
  let on = Set(enabledPluginIds)
  let items = manifest.create?.first(where: { $0.scope == scope })?.items ?? []
  let values = ContractValues.shared
  return items
    .filter { item in (item.pluginId.map(on.contains) ?? true) && (item.requiresHostAdmin != true || hostRole == "admin") }
    .map { item in
      var reason: String?
      if let permission = item.permission, permissions[permission] != true {
        reason = values.nativeCreatePermissionReason
      } else if let roles = item.hostRoles, !roles.contains(hostRole ?? "") {
        reason = values.nativeCreateSiteRoleReason
      } else if let feature = item.planFeature, features[feature] != true {
        reason = item.blockedReason ?? values.nativeCreatePlanReason
      }
      return ResolvedCreateItem(
        blocked: reason != nil, blockedReason: item.blockedReason, console: item.console, hostRoles: item.hostRoles,
        icon: item.icon, id: item.id, label: item.label, order: item.order, params: item.params,
        permission: item.permission, planFeature: item.planFeature, pluginId: item.pluginId, reason: reason,
        requiresHostAdmin: item.requiresHostAdmin, screen: item.screen)
    }
}

// MARK: Name matching (name-match.ts)

/// How well a row matched; higher sorts first.
public enum MatchScore {
  public static let exact = 1000
  public static let namePrefix = 800
  public static let wordPrefix = 600
  public static let substring = 400
  public static let allWords = 200
  public static let secondary = 100
}

/// Lowercased, diacritics stripped, trimmed.
public func foldForSearch(_ value: String?) -> String {
  (value ?? "").folding(options: [.diacriticInsensitive], locale: nil).lowercased()
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func searchSplit(_ text: String) -> [String] {
  text.split { !($0.isLetter || $0.isNumber) }.map(String.init)
}

/// The query's words, folded.
public func searchWords(_ query: String?) -> [String] { searchSplit(foldForSearch(query)) }

/// Scores one row against one query, or nil when it does not match: every word must land in the name (ranked by how),
/// else every word inside the secondary text.
public func scoreMatch(name rawName: String, extra: [String?] = [], query: String) -> Int? {
  let words = searchWords(query)
  guard !words.isEmpty else { return nil }
  let name = foldForSearch(rawName)
  let nameWords = searchSplit(name)
  let phrase = words.joined(separator: " ")
  if name == phrase { return MatchScore.exact }
  if name.hasPrefix(phrase) { return MatchScore.namePrefix }
  if nameWords.contains(where: { $0.hasPrefix(phrase) }) { return MatchScore.wordPrefix }
  if name.contains(phrase) { return MatchScore.substring }
  if words.allSatisfy({ word in nameWords.contains { $0.hasPrefix(word) } }) { return MatchScore.allWords }
  let haystack = extra.map(foldForSearch).filter { !$0.isEmpty }.joined(separator: " ")
  if !haystack.isEmpty, words.allSatisfy({ haystack.contains($0) }) { return MatchScore.secondary }
  return nil
}

/// Ranks two scored rows: score, then the shorter label, then A to Z. Returns true when `a` sorts first.
public func scoredFirst(_ a: (score: Int, label: String), _ b: (score: Int, label: String)) -> Bool {
  if a.score != b.score { return a.score > b.score }
  if a.label.utf16.count != b.label.utf16.count { return a.label.utf16.count < b.label.utf16.count }
  return a.label.localizedCompare(b.label) == .orderedAscending
}

/// Is this query worth a search?
public func isSearchableQuery(_ query: String?) -> Bool { foldForSearch(query).count >= 2 }

// MARK: The one box (one-box-search.ts)

private func askedNumber(_ raw: Any?) -> Double? {
  if let text = raw as? String { return Double(text.trimmingCharacters(in: .whitespaces)) ?? (text.isEmpty ? 0 : nil) }
  if let number = raw as? NSNumber, !looseIsBool(number) { return number.doubleValue }
  return nil
}

/// How many rows a request asks for, within bounds.
public func oneBoxLimit(_ raw: Any?) -> Int {
  guard let asked = askedNumber(raw), asked.isFinite, asked >= 1 else { return ContractValues.shared.oneBoxRowsDefault }
  return min(ContractValues.shared.oneBoxRowsMax, Int(asked.rounded(.down)))
}

/// Where a page starts, within bounds.
public func oneBoxCursor(_ raw: Any?) -> Int {
  guard let asked = askedNumber(raw), asked.isFinite, asked > 0 else { return 0 }
  return Int(asked.rounded(.down))
}

/// The query as the route reads it: trimmed, capped, or nil when too short to run.
public func oneBoxQuery(_ raw: Any?) -> String? {
  let text = String(((raw as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(ContractValues.shared.oneBoxQueryMax))
  return isSearchableQuery(text) ? text : nil
}

/// A screens-and-settings match before ranking.
public struct OneBoxScoredRow: Equatable, Sendable {
  public let row: OneBoxRow
  public let score: Int
}

private let navListHeadings: [NativeNavListId: String] = [
  .workspace: "Workspace", .site: "Site", .workspaceSettings: "Workspace settings", .siteSettings: "Site settings",
]

/// The app's own screens and settings that match, for where the person stands (no reads at all): the workspace's lists
/// with no site, the site's lists and the workspace settings with one.
public func searchNavScreens(_ text: String, scope: String, enabledPluginIds: [String], hostAdmin: Bool) -> [OneBoxScoredRow] {
  searchNavScreens(NativeNav.manifest, text, scope: scope, enabledPluginIds: enabledPluginIds, hostAdmin: hostAdmin)
}

/// The same, over a given manifest.
public func searchNavScreens(
  _ manifest: NativeNavManifest, _ text: String, scope: String, enabledPluginIds: [String], hostAdmin: Bool
) -> [OneBoxScoredRow] {
  guard isSearchableQuery(text), scope != "account" else { return [] }
  let lists: [NativeNavListId] = scope == "site" ? [.site, .siteSettings, .workspaceSettings] : [.workspace, .workspaceSettings]
  var seen = Set<String>()
  var out: [OneBoxScoredRow] = []
  struct Entry {
    let id: String
    let label: String
    let screen: String
    let params: [String: String]?
    let keywords: [String]
  }
  for listID in lists {
    for group in resolveNavList(manifest, listID, enabledPluginIds: enabledPluginIds, hostAdmin: hostAdmin).groups {
      let heading = navListHeadings[listID] ?? ""
      let where_ = group.label.map { "\(heading) · \($0)" } ?? heading
      for row in group.rows {
        var entries = [
          Entry(
            id: "\(listID.rawValue).\(row.id)", label: row.label, screen: row.screen, params: row.params,
            keywords: (row.keywords ?? []) + [group.label ?? ""])
        ]
        for section in row.sections ?? [] where section.label != row.label {
          entries.append(
            Entry(
              id: "\(listID.rawValue).\(row.id).\(section.id)", label: section.label, screen: section.screen,
              params: section.params, keywords: [row.label, group.label ?? ""]))
        }
        for entry in entries {
          let key = "\(entry.screen)|\(canonicalParams(entry.params))"
          guard !seen.contains(key), entry.screen != NativeNav.home,
            let score = scoreMatch(name: entry.label, extra: entry.keywords, query: text)
          else { continue }
          seen.insert(key)
          out.append(
            OneBoxScoredRow(
              row: OneBoxRow(
                detail: entry.label == row.label ? where_ : "\(where_) · \(row.label)", group: ContractValues.shared.oneBoxScreensGroup,
                id: entry.id, label: entry.label, params: entry.params, screen: entry.screen),
              score: score))
        }
      }
    }
  }
  return out
}

/// `JSON.stringify(params ?? {})` as the TypeScript keys a screen with: insertion order there, sorted keys here — the
/// manifest's params each carry one key, so the two agree.
private func canonicalParams(_ params: [String: String]?) -> String {
  (params ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
}

/// Ranks one group's matches the console's way, best first.
public func rankOneBox(_ scored: [OneBoxScoredRow]) -> [OneBoxRow] {
  scored.sorted { scoredFirst(($0.score, $0.row.label), ($1.score, $1.row.label)) }.map(\.row)
}

/// One level of a place's breadcrumbs (AGL-4058): what it says, and the row it opens, nil for the place in use.
public struct NavCrumb: Equatable, Sendable {
  public let label: String
  public let opens: NativeNavRow?

  public init(label: String, opens: NativeNavRow?) {
    self.label = label
    self.opens = opens
  }
}

/// A row's breadcrumbs in `list`, the way the sidebar holds it ("Juniper Street Bakery › Sell › Orders", "Site settings
/// › Setup › Business profile"). The scope (`owner`) opens `ownerOpens`: its Home in the everyday list, or a settings
/// list's first row. The group opens its first row. The row itself is the place in use and opens nothing. A level that
/// would open the row in use opens nothing either, and a group with no label (Home and Overview's) has no level.
public func navCrumbs(for row: NativeNavRow, in list: ResolvedNavList, owner: String?, ownerOpens: NativeNavRow?) -> [NavCrumb] {
  let live = { (target: NativeNavRow?) in target.flatMap { $0.id == row.id ? nil : $0 } }
  var crumbs: [NavCrumb] = []
  if let owner { crumbs.append(NavCrumb(label: owner, opens: live(ownerOpens))) }
  if let group = list.groups.first(where: { $0.rows.contains { $0.id == row.id } }), let label = group.label {
    crumbs.append(NavCrumb(label: label, opens: live(group.rows.first)))
  }
  crumbs.append(NavCrumb(label: row.label, opens: nil))
  return crumbs
}

/// The row a scope's crumb opens: Home in the everyday list, else the list's first row (a settings list's).
public func navScopeRow(in list: ResolvedNavList) -> NativeNavRow? {
  let rows = list.groups.flatMap(\.rows)
  return rows.first { $0.screen == NativeNav.home } ?? rows.first
}

// MARK: The phone's Home (AGL-4006)

/// The phone's Home: every area of the scope as the same tile, in the sidebar's own groups (its More headed Tools),
/// then the scope's own places last: Overview and Site settings in a site, Team and Workspace settings everywhere.
/// `list` is the scope's everyday list as the app shows it, `team` the workspace settings' Members row when the person
/// may open it, and `ownerName` heads the whole workspace's areas.
public func phoneHomeGroups(_ list: ResolvedNavList, team: NativeNavRow?, ownerName: String) -> [PhoneHomeGroup] {
  let values = ContractValues.shared
  let inSite = list.id == .site
  var own: [NativeNavRow] = []
  var groups: [PhoneHomeGroup] = []
  for group in list.groups where group.dynamic == nil {
    let rows = group.rows.filter { $0.screen != NativeNav.home }
    if group.id == "top" || group.id == "settings" {
      own += rows
      continue
    }
    if rows.isEmpty { continue }
    let label = values.phoneHomeGroupLabels[group.id] ?? group.label ?? (ownerName.isEmpty ? nil : ownerName)
    groups.append(PhoneHomeGroup(id: group.id, label: label, rows: rows))
  }
  if var team {
    team.label = values.phoneHomeTeamLabel
    own.append(team)
  }
  own.append(values.workspaceSettingsRow)
  groups.append(
    PhoneHomeGroup(
      id: "scope", label: inSite ? values.phoneHomeSiteGroupLabel : values.phoneHomeWorkspaceGroupLabel, rows: own))
  return groups
}

/// Whether a Home tile may go in the tab bar: an area, never Home itself or a settings mode.
public func isTabPinnable(screen: String) -> Bool {
  screen != NativeNav.home && screen != NativeNav.workspaceSettings && screen != NativeNav.siteSettings
}
