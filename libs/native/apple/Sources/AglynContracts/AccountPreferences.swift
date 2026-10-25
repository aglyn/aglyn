// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The preferences a person keeps on their account (`users/{uid}`), read and written the way the console and the
// Kotlin apps do: a port of libs/aglyn/src/lib/app-utils/account-preferences.ts, replayed against its cases in
// FunctionCasesTests. The caps and field names are the generated contract values, never typed here.

private var values: ContractValues { ContractValues.shared }

/// Strings in a stored list, without repeats or empties, in their stored order; anything else reads as none.
private func idList(_ value: Any?) -> [String] {
  guard let list = value as? [Any] else { return [] }
  var seen = Set<String>()
  var out: [String] = []
  for entry in list {
    guard let id = entry as? String, !id.isEmpty, seen.insert(id).inserted else { continue }
    out.append(id)
  }
  return out
}

private func idList(_ value: [String]) -> [String] { idList(value as [Any]) }

private func field(_ profile: [String: Any]?, _ name: String) -> Any? { profile?[name] }

/// Whether a value is a picked color: `#` and six hex digits.
public func isAccountColor(_ value: Any?) -> Bool {
  guard let text = value as? String else { return false }
  return text.range(of: values.accountColorPattern, options: .regularExpression) != nil
}

// MARK: Pins

/// Every id the person stored as pinned, in their order, without repeats; may hold more than the cap.
public func readPinnedOrgs(_ profile: [String: Any]?) -> [String] {
  idList(field(profile, values.pinnedOrgsField))
}

/// The pins in force: the first five stored, until the person picks.
public func effectivePinnedOrgs(_ stored: [String]) -> [String] {
  Array(idList(stored).prefix(values.pinnedOrgsMax))
}

/// The account pinned more than the cap before there was one, and has to pick which to keep.
public func pinnedOrgsOverCap(_ stored: [String]) -> Bool {
  idList(stored).count > values.pinnedOrgsMax
}

/// Pins a workspace at the end of the list, or says the list is full ("Pinned is full. Replace one?").
public func pinOrg(_ pinned: [String], _ orgID: String) -> PinOrgResult {
  let current = effectivePinnedOrgs(pinned)
  if orgID.isEmpty || current.contains(orgID) { return PinOrgResult(outcome: .alreadyPinned, pinned: current) }
  if current.count >= values.pinnedOrgsMax { return PinOrgResult(outcome: .full, pinned: current) }
  return PinOrgResult(outcome: .pinned, pinned: current + [orgID])
}

/// The pins without one workspace.
public func unpinOrg(_ pinned: [String], _ orgID: String) -> [String] {
  idList(pinned).filter { $0 != orgID }
}

/// The pins with `orgID` in the place `replacing` held; unchanged when `replacing` is not pinned or `orgID` already is.
public func replacePinnedOrg(_ pinned: [String], replacing: String, with orgID: String) -> [String] {
  let current = effectivePinnedOrgs(pinned)
  if orgID.isEmpty || current.contains(orgID) || !current.contains(replacing) { return current }
  return current.map { $0 == replacing ? orgID : $0 }
}

/// The answer to "Keep which 5?": the stored pins the person ticked, in their order, never more than the cap.
public func keepPinnedOrgs(_ stored: [String], keep: [String]) -> [String] {
  let kept = Set(keep)
  return Array(idList(stored).filter { kept.contains($0) }.prefix(values.pinnedOrgsMax))
}

/// The pins with one moved up (`-1`) or down (`1`) a place; unchanged at an end.
public func movePinnedOrg(_ pinned: [String], _ orgID: String, offset: Int) -> [String] {
  var current = effectivePinnedOrgs(pinned)
  guard let from = current.firstIndex(of: orgID) else { return current }
  let to = from + (offset < 0 ? -1 : 1)
  guard to >= 0, to < current.count else { return current }
  current.swapAt(from, to)
  return current
}

// MARK: Recent workspaces and the rail

/// The recently opened workspaces as stored, newest first.
public func readRecentOrgs(_ profile: [String: Any]?) -> [String] {
  Array(idList(field(profile, values.recentOrgsField)).prefix(values.recentOrgsMax))
}

/// The recent workspaces after opening one: it moves to the front, the oldest falls off.
public func recordRecentOrg(_ recent: [String], _ orgID: String) -> [String] {
  guard !orgID.isEmpty else { return Array(idList(recent).prefix(values.recentOrgsMax)) }
  return Array(([orgID] + idList(recent).filter { $0 != orgID }).prefix(values.recentOrgsMax))
}

/// The rail for one account, the same however few workspaces it has (Figma Rail 12:338, "Many workspaces"): up to five
/// pinned, a divider, up to three recent, a divider, then "All workspaces (N)", which opens the switcher where pins are
/// edited (AGL-3996). `rest` is always empty. `orgIDs` is every membership, in the switcher's order.
public func railWorkspaces(_ orgIDs: [String], pinned: [String], recent: [String]) -> RailWorkspaces {
  let members = idList(orgIDs)
  let belongs = Set(members)
  let pins = effectivePinnedOrgs(pinned).filter { belongs.contains($0) }
  let pinnedSet = Set(pins)
  return RailWorkspaces(
    allTile: !members.isEmpty, pinned: pins,
    recent: Array(idList(recent).filter { belongs.contains($0) && !pinnedSet.contains($0) }.prefix(values.railRecentOrgs)),
    rest: [], total: members.count)
}

/// The one letter a workspace tile without a logo shows (Figma Rail/Workspace tile, Type=Initial): the first letter or
/// digit of its name, upper-cased; "?" for a name with neither.
public func workspaceInitial(_ name: String) -> String {
  guard let first = name.first(where: { $0.isLetter || $0.isNumber }) else { return "?" }
  return String(first).uppercased()
}

// MARK: Starred and recent items

/// One item's identity: the same screen or record in the same place.
public func accountItemKey(kind: String, id: String, orgID: String, hostID: String?) -> String {
  "\(kind):\(orgID):\(hostID ?? ""):\(id)"
}

public extension StarredItem {
  var key: String { accountItemKey(kind: kind, id: id, orgID: orgId, hostID: hostId) }
  var ref: AccountItemRef {
    AccountItemRef(hostId: hostId, id: id, kind: kind, label: label, orgId: orgId, params: params, screen: screen)
  }
}

public extension RecentItem {
  var key: String { accountItemKey(kind: kind, id: id, orgID: orgId, hostID: hostId) }
  var ref: AccountItemRef {
    AccountItemRef(hostId: hostId, id: id, kind: kind, label: label, orgId: orgId, params: params, screen: screen)
  }
}

public extension AccountItemRef {
  var key: String { accountItemKey(kind: kind, id: id, orgID: orgId, hostID: hostId) }

  /// The item as Firestore stores it inside a list.
  var fields: [String: Any] {
    var out: [String: Any] = ["kind": kind, "id": id, "orgId": orgId, "label": label, "screen": screen]
    if let hostId { out["hostId"] = hostId }
    if let params, !params.isEmpty { out["params"] = params }
    return out
  }
}

public extension StarredItem {
  var fields: [String: Any] {
    var out = ref.fields
    if let color, color != .unknown { out["color"] = color.rawValue }
    out["starredAtMs"] = starredAtMs
    return out
  }
}

public extension RecentItem {
  var fields: [String: Any] {
    var out = ref.fields
    out["openedAtMs"] = openedAtMs
    return out
  }
}

private func stringMap(_ value: Any?) -> [String: String]? {
  guard let map = value as? [String: Any] else { return nil }
  var out: [String: String] = [:]
  for (key, entry) in map { if let text = entry as? String { out[key] = text } }
  return out.isEmpty ? nil : out
}

private func itemRef(_ value: Any?) -> AccountItemRef? {
  guard let raw = value as? [String: Any] else { return nil }
  func text(_ key: String) -> String { raw[key] as? String ?? "" }
  let (kind, id, orgID, screen) = (text("kind"), text("id"), text("orgId"), text("screen"))
  guard !kind.isEmpty, !id.isEmpty, !orgID.isEmpty, !screen.isEmpty else { return nil }
  let hostID = text("hostId")
  return AccountItemRef(
    hostId: hostID.isEmpty ? nil : hostID, id: id, kind: kind, label: String(text("label").prefix(values.accountItemLabelMax)),
    orgId: orgID, params: stringMap(raw["params"]), screen: screen)
}

private func millis(_ value: Any?) -> Int {
  guard let number = value as? NSNumber, !looseIsBool(number) else { return 0 }
  let double = number.doubleValue
  return double.isFinite ? Int(double) : 0
}

private func starredItem(_ ref: AccountItemRef, color: StarColor?, at: Int) -> StarredItem {
  StarredItem(
    color: color, hostId: ref.hostId, id: ref.id, kind: ref.kind, label: ref.label, orgId: ref.orgId, params: ref.params,
    screen: ref.screen, starredAtMs: at)
}

private func recentItem(_ ref: AccountItemRef, at: Int) -> RecentItem {
  RecentItem(
    hostId: ref.hostId, id: ref.id, kind: ref.kind, label: ref.label, openedAtMs: at, orgId: ref.orgId, params: ref.params,
    screen: ref.screen)
}

private func starColor(_ value: Any?) -> StarColor? {
  guard let raw = value as? String, let color = StarColor(rawValue: raw), color != .unknown else { return nil }
  return color
}

/// The starred items as stored, each well formed, without repeats, never more than the cap.
public func readStarred(_ profile: [String: Any]?) -> [StarredItem] {
  readStarred(list: field(profile, values.starredField))
}

private func readStarred(list stored: Any?) -> [StarredItem] {
  guard let stored = stored as? [Any] else { return [] }
  var seen = Set<String>()
  var out: [StarredItem] = []
  for entry in stored {
    guard let ref = itemRef(entry), seen.insert(ref.key).inserted else { continue }
    let raw = entry as? [String: Any]
    out.append(starredItem(ref, color: starColor(raw?["color"]), at: millis(raw?["starredAtMs"])))
  }
  return Array(out.prefix(values.starredMax))
}

/// Stars an item at the end of the list, or unstars it; a full list says so instead.
public func toggleStarred(_ starred: [StarredItem], _ item: AccountItemRef, nowMs: Int) -> StarResult {
  let current = readStarred(list: starred.map(\.fields))
  guard let ref = itemRef(item.fields) else { return StarResult(outcome: .full, starred: current) }
  if current.contains(where: { $0.key == ref.key }) {
    return StarResult(outcome: .unstarred, starred: current.filter { $0.key != ref.key })
  }
  if current.count >= values.starredMax { return StarResult(outcome: .full, starred: current) }
  return StarResult(outcome: .starred, starred: current + [starredItem(ref, color: nil, at: nowMs)])
}

/// The starred items with one item's color dot set, or cleared with nil.
public func setStarColor(_ starred: [StarredItem], key: String, color: StarColor?) -> [StarredItem] {
  readStarred(list: starred.map(\.fields)).map { entry in
    guard entry.key == key else { return entry }
    var next = entry
    next.color = color == .unknown ? nil : color
    return next
  }
}

/// The recent items as stored, newest first, each well formed, never more than the cap.
public func readRecents(_ profile: [String: Any]?) -> [RecentItem] {
  readRecents(list: field(profile, values.recentsField))
}

private func readRecents(list stored: Any?) -> [RecentItem] {
  guard let stored = stored as? [Any] else { return [] }
  var seen = Set<String>()
  var out: [RecentItem] = []
  for entry in stored {
    guard let ref = itemRef(entry), seen.insert(ref.key).inserted else { continue }
    out.append(recentItem(ref, at: millis((entry as? [String: Any])?["openedAtMs"])))
  }
  return Array(out.prefix(values.recentsMax))
}

/// The recent items after opening one: it moves to the front, the oldest falls off.
public func recordRecent(_ recents: [RecentItem], _ item: AccountItemRef, nowMs: Int) -> [RecentItem] {
  let current = readRecents(list: recents.map(\.fields))
  guard let ref = itemRef(item.fields) else { return current }
  return Array(([recentItem(ref, at: nowMs)] + current.filter { $0.key != ref.key }).prefix(values.recentsMax))
}

// MARK: Workspace colors

/// The colors the person picked, by workspace id, the valid ones only.
public func readWorkspaceColors(_ profile: [String: Any]?) -> [String: String] {
  guard let stored = field(profile, values.workspaceColorsField) as? [String: Any] else { return [:] }
  var out: [String: String] = [:]
  // Object key order is the stored order; Firestore hands keys back sorted, which the cap then reads in.
  for orgID in stored.keys.sorted() {
    if let color = stored[orgID] as? String, !orgID.isEmpty, isAccountColor(color) { out[orgID] = color }
    if out.count >= values.workspaceColorsMax { break }
  }
  return out
}

/// The color a workspace with no picked, brand or logo color shows on its tile: one of `WORKSPACE_STABLE_COLORS`,
/// chosen by 32-bit FNV-1a over the id's UTF-16 code units, as the console chooses it, so the same workspace has the
/// same color on every device and in both apps. Nil for an empty id.
public func workspaceStableColor(_ orgID: Any?) -> String? {
  guard let orgID = orgID as? String, !orgID.isEmpty, !values.workspaceStableColors.isEmpty else { return nil }
  var hash: UInt32 = 0x811C_9DC5
  for unit in orgID.utf16 {
    hash ^= UInt32(unit)
    hash = hash &* 0x0100_0193
  }
  return values.workspaceStableColors[Int(hash % UInt32(values.workspaceStableColors.count))]
}

/// A workspace's color: the one the person picked, else its brand color, else one taken from its logo
/// (Zach, 2026-10-18). A picked color always tints the app; the others only while "Use each workspace's brand" is on.
/// Given the workspace's id, one with none of the three gets its stable color (`workspaceStableColor`), which colors
/// only its tile, never the app.
public func resolveWorkspaceColor(
  picked: Any?, brandColor: Any?, logoColor: Any?, useWorkspaceBrand: Bool, orgID: Any? = nil
) -> WorkspaceColor {
  if isAccountColor(picked) { return WorkspaceColor(color: picked as? String, source: .picked, tintsApp: true) }
  if isAccountColor(brandColor) {
    return WorkspaceColor(color: brandColor as? String, source: .brand, tintsApp: useWorkspaceBrand)
  }
  if isAccountColor(logoColor) { return WorkspaceColor(color: logoColor as? String, source: .logo, tintsApp: useWorkspaceBrand) }
  if let stable = workspaceStableColor(orgID) { return WorkspaceColor(color: stable, source: .stable, tintsApp: false) }
  return WorkspaceColor(color: nil, source: .none, tintsApp: false)
}

// MARK: Theme

/// The synced theme, every field filled: a missing or unknown value reads as the default.
public func readAppTheme(_ profile: [String: Any]?) -> AppThemePrefs {
  let raw = field(profile, values.appThemeField) as? [String: Any] ?? [:]
  let fallback = values.defaultAppTheme
  func pick<T: RawRepresentable & Equatable>(_ key: String, _ allowed: [T], _ fallback: T) -> T where T.RawValue == String {
    guard let text = raw[key] as? String, let value = T(rawValue: text), allowed.contains(value) else { return fallback }
    return value
  }
  let accent = raw["accent"] as? String
  let appIcon = raw["appIcon"] as? String
  return AppThemePrefs(
    accent: accent == "theme" || isAccountColor(accent) ? accent! : fallback.accent,
    appearance: pick("appearance", values.appAppearances, fallback.appearance),
    appIcon: appIcon.flatMap { !$0.isEmpty && $0.count <= values.appIconIdMax ? $0 : nil } ?? fallback.appIcon,
    density: pick("density", values.appDensities, fallback.density),
    sidebarStyle: pick("sidebarStyle", values.appSidebarStyles, fallback.sidebarStyle),
    textSize: pick("textSize", values.appTextSizes, fallback.textSize),
    theme: pick("theme", values.appThemeNames, fallback.theme),
    useWorkspaceBrand: (raw["useWorkspaceBrand"] as? NSNumber).flatMap { looseIsBool($0) ? $0.boolValue : nil }
      ?? (raw["useWorkspaceBrand"] as? Bool) ?? fallback.useWorkspaceBrand)
}

public extension AppThemePrefs {
  /// The theme as Firestore stores it.
  var fields: [String: Any] {
    [
      "appearance": appearance.rawValue, "theme": theme.rawValue, "accent": accent, "density": density.rawValue,
      "textSize": textSize.rawValue, "sidebarStyle": sidebarStyle.rawValue, "appIcon": appIcon,
      "useWorkspaceBrand": useWorkspaceBrand,
    ]
  }
}

// MARK: The phone's tab bar (AGL-4006)

/// The key of one site's tab bar, or the whole workspace's.
public func tabBarScope(orgID: String, hostID: String?) -> String {
  if let hostID, !hostID.isEmpty { return "site:\(hostID)" }
  return "org:\(orgID)"
}

/// Area ids as a tab bar keeps them: no repeats or empties, never Home or Create, at most four.
private func tabAreaList(_ value: Any?) -> [String] {
  Array(
    idList(value).filter { $0 != values.tabBarHome && $0 != values.tabBarCreate }.prefix(values.tabBarAreasMax))
}

private func tabBarList(_ value: Any?) -> [TabBarPins] {
  guard let list = value as? [Any] else { return [] }
  var seen = Set<String>()
  var out: [TabBarPins] = []
  for entry in list {
    guard let raw = entry as? [String: Any], let scope = raw["scope"] as? String,
      scope.range(of: "^(site|org):.", options: .regularExpression) != nil, seen.insert(scope).inserted
    else { continue }
    out.append(TabBarPins(areas: tabAreaList(raw["areas"]), chosen: (raw["chosen"] as? Bool) == true, scope: scope))
  }
  return Array(out.suffix(values.tabBarsMax))
}

private func tabBarList(_ bars: [TabBarPins]) -> [TabBarPins] {
  tabBarList(bars.map { ["scope": $0.scope, "areas": $0.areas, "chosen": $0.chosen] as [String: Any] })
}

/// Every tab bar the person keeps, each well formed, without repeats; a stray value reads as none.
public func readTabBars(_ profile: [String: Any]?) -> [TabBarPins] {
  tabBarList(field(profile, values.tabBarsField))
}

/// One scope's areas, in the person's order.
public func tabBarAreas(_ tabBars: [TabBarPins], scope: String) -> [String] {
  tabBarList(tabBars).first { $0.scope == scope }?.areas ?? []
}

/// Every tab bar with one scope's replaced; a new scope goes last, and past the cap the oldest other scopes give way.
private func withTabBar(_ tabBars: [TabBarPins], _ next: TabBarPins) -> [TabBarPins] {
  var out = tabBarList(tabBars)
  if let at = out.firstIndex(where: { $0.scope == next.scope }) { out[at] = next } else { out.append(next) }
  while out.count > values.tabBarsMax {
    guard let oldest = out.firstIndex(where: { $0.scope != next.scope }) else { break }
    out.remove(at: oldest)
  }
  return out
}

/// Pins an area at the end of a scope's tab bar, or says the bar is full (never made room in quietly).
public func pinTabArea(_ tabBars: [TabBarPins], scope: String, area: String) -> TabPinResult {
  let current = tabBarList(tabBars)
  let areas = tabBarAreas(current, scope: scope)
  if area.isEmpty || area == values.tabBarHome || area == values.tabBarCreate || areas.contains(area) {
    return TabPinResult(outcome: .alreadyPinned, tabBars: current)
  }
  if areas.count >= values.tabBarAreasMax { return TabPinResult(outcome: .full, tabBars: current) }
  return TabPinResult(
    outcome: .pinned, tabBars: withTabBar(current, TabBarPins(areas: areas + [area], chosen: true, scope: scope)))
}

/// A scope's tab bar without one area; the person chose, so opened areas no longer fill the spot.
public func unpinTabArea(_ tabBars: [TabBarPins], scope: String, area: String) -> [TabBarPins] {
  let areas = tabBarAreas(tabBars, scope: scope)
  return withTabBar(tabBars, TabBarPins(areas: areas.filter { $0 != area }, chosen: true, scope: scope))
}

/// A scope's tab bar with one area moved left (`-1`) or right (`1`) a place; unchanged at an end.
public func moveTabArea(_ tabBars: [TabBarPins], scope: String, area: String, offset: Int) -> [TabBarPins] {
  var areas = tabBarAreas(tabBars, scope: scope)
  guard let from = areas.firstIndex(of: area) else { return tabBarList(tabBars) }
  let to = from + (offset < 0 ? -1 : 1)
  guard to >= 0, to < areas.count else { return tabBarList(tabBars) }
  areas.swapAt(from, to)
  return withTabBar(tabBars, TabBarPins(areas: areas, chosen: true, scope: scope))
}

/// A scope's tab bar as the Tab bar sheet left it: these areas, in this order, at most four.
public func setTabAreas(_ tabBars: [TabBarPins], scope: String, areas: [String]) -> [TabBarPins] {
  withTabBar(tabBars, TabBarPins(areas: tabAreaList(areas), chosen: true, scope: scope))
}

/// The default before anyone pins: an area opened takes a free spot and stays, until the bar is full or changed by hand.
public func autoPinTabArea(_ tabBars: [TabBarPins], scope: String, area: String) -> [TabBarPins] {
  let current = tabBarList(tabBars)
  let bar = current.first { $0.scope == scope }
  let areas = bar?.areas ?? []
  if area.isEmpty || area == values.tabBarHome || area == values.tabBarCreate { return current }
  if bar?.chosen == true || areas.contains(area) || areas.count >= values.tabBarAreasMax { return current }
  return withTabBar(current, TabBarPins(areas: areas + [area], chosen: false, scope: scope))
}

/// The tab bar to draw: Home, the pinned areas the scope can open, and Create new in the centre until four areas fill
/// the bar and Create moves to the top bar.
public func tabBarLayout(_ areas: [String], available: [String]) -> TabBarLayout {
  let open = Set(available)
  let shown = tabAreaList(areas).filter(open.contains)
  if shown.count >= values.tabBarAreasMax {
    return TabBarLayout(createInTopBar: true, slots: [values.tabBarHome] + shown)
  }
  var slots = [values.tabBarHome] + shown
  slots.insert(values.tabBarCreate, at: (shown.count + 2) / 2)
  return TabBarLayout(createInTopBar: false, slots: slots)
}

// MARK: Who is signed in

private func trimmedText(_ value: Any?) -> String {
  (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

/// The person's own picture, as the console draws it (AGL-4010): `users/{uid}.photoUrl` first, else the sign-in
/// record's `photoURL`, else nil (draw initials). A blank value is never a picture. A library pick is a
/// `/api/media/cdn/...` path; resolve it with `mediaPreviewURL` before loading it.
public func readAccountPhoto(_ profile: [String: Any]?, authPhotoURL: Any?) -> String? {
  let stored = trimmedText(field(profile, values.accountPhotoField))
  if !stored.isEmpty { return stored }
  let auth = trimmedText(authPhotoURL)
  return auth.isEmpty ? nil : auth
}

/// The person's own name, as the console shows it (AGL-2486, AGL-4010): the profile's first and last name, else the
/// sign-in record's display name, else the email address, else empty.
public func readAccountName(_ profile: [String: Any]?, authDisplayName: Any?, email: Any?) -> String {
  let fromProfile = [trimmedText(field(profile, "firstName")), trimmedText(field(profile, "lastName"))]
    .filter { !$0.isEmpty }.joined(separator: " ")
  if !fromProfile.isEmpty { return fromProfile }
  let fromAuth = trimmedText(authDisplayName)
  return fromAuth.isEmpty ? trimmedText(email) : fromAuth
}
