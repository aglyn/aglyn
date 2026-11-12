// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

// One resolver for every way into a place (AGL-4059): a link (universal, `aglyn://`, a notification's or a push's, a
// search row's) and a stored place (Starred, Recent, a search row's screen) both become the same `NavPath`, the levels
// a person passes navigating there by hand: the sidebar's mode, the area row (or its section), then each screen pushed
// over it. The Kotlin kit holds the same port (`NavPaths.kt`), and both replay `libs/native/contracts/nav-path-cases.json`.

/// The list a place's area row is in, and so the mode the sidebar shows it in.
public enum NavPathMode: String, Equatable, Sendable {
  /// The scope's everyday list (the site's, or the whole workspace's).
  case main
  case workspaceSettings
  case siteSettings
  /// The staff list.
  case staff
}

/// The shell's own pages a link can name, which no manifest row opens.
public enum NavShellPage: String, Equatable, Sendable {
  case home
  case notifications
  case notificationSettings
}

/// What the sidebar selects for a place: one of the shell's pages, or a manifest row (or one of its sections) by the
/// row's id and the screen and params the row or section opens.
public enum NavArea: Equatable, Sendable {
  case shell(NavShellPage)
  case row(id: String, screen: String, params: NativeParams)
}

/// One level pushed over the area.
public enum NavStep: Equatable, Sendable {
  case screen(String, NativeParams)
  /// A Besigner page (a whole console path), the only web content.
  case besigner(String)
  /// A console page the app has no native screen for yet.
  case unavailable(String)
}

/// Where a place is, top-down: the sidebar's mode, the area it selects, and what is pushed over the area, the place
/// itself last. Back walks `pushed` up one level at a time; the area's crumbs come from its row.
public struct NavPath: Equatable, Sendable {
  public var mode: NavPathMode
  public var area: NavArea
  public var pushed: [NavStep]

  public init(mode: NavPathMode = .main, area: NavArea, pushed: [NavStep] = []) {
    self.mode = mode
    self.area = area
    self.pushed = pushed
  }

  /// Whether the sidebar's Starred row the place was opened from stays the selected row: only where the sidebar still
  /// shows Starred, the scope's everyday list. A place in a settings mode or the staff list selects its own row there
  /// (a starred Site settings › SEO selects SEO, AGL-4059).
  public var keepsStarredRow: Bool {
    guard mode == .main, case .row = area else { return false }
    return true
  }

  /// The same path with every level's workspace and site slugs dropped: a link carries them, a stored place does not,
  /// and both open the same screen.
  public var unscoped: NavPath {
    var next = self
    next.pushed = pushed.map { step in
      if case .screen(let screen, let params) = step { return .screen(screen, NavPaths.withoutScope(params)) }
      return step
    }
    return next
  }
}

/// The lists a place is looked up in: the manifest's, every plugin's rows in (the app trims them to the screens it
/// has), and the staff list where the person is staff.
public struct NavPathLists: Sendable {
  public var workspace: ResolvedNavList
  public var site: ResolvedNavList
  public var workspaceSettings: ResolvedNavList
  public var siteSettings: ResolvedNavList
  public var staff: ResolvedNavList?

  public init(
    workspace: ResolvedNavList, site: ResolvedNavList, workspaceSettings: ResolvedNavList, siteSettings: ResolvedNavList,
    staff: ResolvedNavList? = nil
  ) {
    self.workspace = workspace
    self.site = site
    self.workspaceSettings = workspaceSettings
    self.siteSettings = siteSettings
    self.staff = staff
  }

  /// The lists in the order a place is looked for: the scope's own list, its settings, the workspace's settings, staff.
  func ordered(inSite: Bool) -> [(mode: NavPathMode, list: ResolvedNavList)] {
    var out: [(NavPathMode, ResolvedNavList)] =
      inSite
      ? [(.main, site), (.siteSettings, siteSettings), (.workspaceSettings, workspaceSettings)]
      : [(.main, workspace), (.workspaceSettings, workspaceSettings)]
    if let staff { out.append((.staff, staff)) }
    return out
  }
}

public enum NavPaths {
  /// The params a link adds for the workspace and site it names.
  static let scopeKeys: Set<String> = ["orgSlug", "hostSlug"]

  static func withoutScope(_ params: NativeParams) -> NativeParams { params.filter { !scopeKeys.contains($0.key) } }

  /// The manifest's lists with every plugin's rows (a place opens under its row even while its plugin's row is hidden),
  /// trimmed to the screens `has` says this build has; the shell's own screens are always there.
  public static func lists(
    _ manifest: NativeNavManifest = NativeNav.manifest, staff: ResolvedNavList? = nil, has: (String) -> Bool
  ) -> NavPathLists {
    let plugins = Array(
      Set(manifest.lists.flatMap(\.groups).flatMap(\.rows).flatMap { row in [row.pluginId] + (row.sections ?? []).map(\.pluginId) }
        .compactMap { $0 }))
    func available(_ screen: String) -> Bool { screen.hasPrefix("shell.") || has(screen) }
    func list(_ id: NativeNavListId) -> ResolvedNavList {
      var resolved = resolveNavList(manifest, id, enabledPluginIds: plugins, hostAdmin: true)
      resolved.groups = resolved.groups.map { group in
        var next = group
        next.rows = group.rows.filter { available($0.screen) }.map { row in
          var trimmed = row
          trimmed.sections = row.sections?.filter { available($0.screen) }
          return trimmed
        }
        return next
      }
      return resolved
    }
    return NavPathLists(
      workspace: list(.workspace), site: list(.site), workspaceSettings: list(.workspaceSettings),
      siteSettings: list(.siteSettings), staff: staff)
  }

  // MARK: Entry points

  /// A console link (a universal link, `aglyn://`, a notification's or a push's link once `notificationLink` has put it
  /// in the console's form, a search row's link): the workspace and site it names, and its path. `inSite` stands for a
  /// link that names no workspace (`/manage/…`, `/admin/…`), which opens where the window stands.
  public static func link(
    _ link: String, routes: [any DeepLinkRoute], lists: NavPathLists, inSite: Bool
  ) -> (scope: DeepLinks.Scope, path: NavPath)? {
    guard let raw = DeepLinks.consolePath(of: link) else { return nil }
    var full = DeepLinks.withoutFragment(raw)
    // An AI job's notice that built nothing of its own to open (`/{hostId}?aiJob=…`) opens that job (AGL-3911).
    if let jobID = DeepLinks.rootQuery(full)?["aiJob"], !jobID.isEmpty {
      let base = String(full[..<(full.firstIndex(of: "?") ?? full.endIndex)])
      full = (base.hasSuffix("/") ? String(base.dropLast()) : base) + "/ai-jobs/" + percentEncoded(jobID)
    }
    let (bare, queryText) = split(full)
    let scope = DeepLinks.splitConsoleScope(bare)
    let inSite = scope.orgSlug != nil ? scope.hostSlug != nil : inSite
    let query = DeepLinks.queryParams(queryText ?? "")
    let rest = scope.rest
    var levels = ancestors(rest, hadQuery: queryText != nil, routes: routes)
    let last: NavStep
    if let (screen, params) = DeepLinks.match(rest, query: query, routes: routes) {
      var merged = params
      if let org = scope.orgSlug { merged["orgSlug"] = org }
      if let host = scope.hostSlug { merged["hostSlug"] = host }
      levels.append(.screen(screen, merged))
      return (scope, assemble(levels, inSite: inSite, lists: lists))
    } else if DeepLinks.isBesignerPath(raw) {
      last = .besigner(raw)
    } else if rest.hasPrefix("/manage/notifications/settings") {
      return (scope, NavPath(area: .shell(.notificationSettings)))
    } else if rest.hasPrefix("/manage/notifications") {
      return (scope, NavPath(area: .shell(.notifications)))
    } else if rest == "/analytics" || rest.hasPrefix("/analytics/") {
      // The site's Analytics page is the shell's own (`shell.analytics`, the site list's Overview row).
      return (scope, assemble([.screen(NativeNav.analytics, [:])], inSite: inSite, lists: lists))
    } else if scope.orgSlug != nil, rest == "/" {
      // A workspace's own address (`/{orgSlug}`) and a site's dashboard are their Home.
      return (scope, NavPath(area: .shell(.home)))
    } else {
      last = .unavailable(full)
    }
    var path = assemble(levels, inSite: inSite, lists: lists)
    path.pushed.append(last)
    return (scope, path)
  }

  /// A stored place (a Starred or Recent item, a search row's screen): its screen and params, the row it was saved
  /// from when it was a sidebar row (`kind` `screen`), and whether it is a site's.
  public static func place(
    screen: String, params: NativeParams = [:], rowID: String? = nil, inSite: Bool, routes: [any DeepLinkRoute],
    lists: NavPathLists
  ) -> NavPath {
    if screen == NativeNav.home { return NavPath(area: .shell(.home)) }
    let params = withoutScope(params)
    // A row the place was saved from opens under that row, on its section when the place is one.
    if let rowID, let found = row(rowID, holding: screen, params: params, inSite: inSite, lists: lists) {
      let extra = withoutScope(params).filter { found.params[$0.key] != $0.value }
      return NavPath(
        mode: found.mode, area: .row(id: found.row.id, screen: screen, params: found.params),
        pushed: extra.isEmpty ? [] : [.screen(screen, params)])
    }
    // Any other place opens where its console address puts it: under each page on the way to it.
    if let address = consoleAddress(screen: screen, params: params, routes: routes) {
      let (bare, queryText) = split(address)
      var levels = ancestors(bare, hadQuery: queryText != nil, routes: routes)
      let resolved = DeepLinks.match(bare, query: DeepLinks.queryParams(queryText ?? ""), routes: routes)?.params ?? [:]
      levels.append(.screen(screen, resolved.merging(params) { _, own in own }))
      return assemble(levels, inSite: inSite, lists: lists)
    }
    return assemble([.screen(screen, params)], inSite: inSite, lists: lists)
  }

  /// A Starred or Recent item, or any account item: a `screen` item is a sidebar row, by its id.
  public static func place(
    _ item: AccountItemRef, routes: [any DeepLinkRoute], lists: NavPathLists
  ) -> NavPath {
    place(
      screen: item.screen, params: item.params ?? [:], rowID: item.kind == "screen" ? item.id : nil,
      inSite: item.hostId != nil, routes: routes, lists: lists)
  }

  /// Whether the path's area is one of its row's sections rather than the row's own place (Orders' Reservations,
  /// Marketing's Campaigns). On a phone whose tab bar holds the row, the tab opens on the row's own place, so a section
  /// is pushed over it, as its chip does (AGL-4059: a Reservations search row opened Orders' list).
  public static func opensSection(_ path: NavPath, lists: NavPathLists) -> Bool {
    guard case .row(let id, let screen, let params) = path.area else { return false }
    let all = [lists.site, lists.workspace, lists.siteSettings, lists.workspaceSettings] + (lists.staff.map { [$0] } ?? [])
    guard let row = all.flatMap(\.groups).flatMap(\.rows).first(where: { $0.id == id }) else { return false }
    return !(row.screen == screen && (row.params ?? [:]) == params)
  }

  /// The row a one-box screens-and-settings match names: its id is `{list}.{row}` or `{list}.{row}.{section}`.
  public static func searchRowID(_ id: String) -> String? {
    let parts = id.split(separator: ".", omittingEmptySubsequences: false)
    return parts.count >= 2 ? String(parts[1]) : nil
  }

  // MARK: The path

  /// The pages a console path passes on the way to it, top-down (`/products/orders` above `/products/orders?order=…`,
  /// `/crm/contacts` above `/crm/contacts/{id}`): every shorter prefix a route answers.
  static func ancestors(_ rest: String, hadQuery: Bool, routes: [any DeepLinkRoute]) -> [NavStep] {
    let segments = rest.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    var candidates: [String] = []
    if hadQuery { candidates.append(rest) }
    if segments.count > 1 {
      for count in stride(from: segments.count - 1, through: 1, by: -1) {
        candidates.append("/" + segments.prefix(count).joined(separator: "/"))
      }
    }
    return candidates.compactMap { candidate in
      DeepLinks.match(candidate, query: [:], routes: routes).map { NavStep.screen($0.screen, $0.params) }
    }.reversed()
  }

  /// The levels (top-down, the place last) as the sidebar holds them. The first level a row opens is the area; it moves
  /// down onto each next level that is exactly a row or section (Marketing, then its Campaigns; Workspace settings'
  /// first page, then SSO), staying on the same row while that row holds the level. What is left is pushed over the
  /// area, a screen repeated by the next level (a list, then the same list on one record) only once, at its deepest.
  static func assemble(_ levels: [NavStep], inSite: Bool, lists: NavPathLists) -> NavPath {
    let ordered = lists.ordered(inSite: inSite)
    var area: (index: Int, hit: RowHit)?
    for (index, level) in levels.enumerated() {
      guard case .screen(let screen, let params) = level else { continue }
      if let current = area {
        if let section = exactCandidate(screen, params, in: current.hit.row) {
          area = (index, RowHit(mode: current.hit.mode, row: current.hit.row, screen: section.screen, params: section.params, exact: true))
        } else if let hit = rowMatch(screen, params, in: ordered), hit.exact {
          area = (index, hit)
        } else {
          break
        }
      } else if let hit = rowMatch(screen, params, in: ordered) {
        area = (index, hit)
      }
    }
    var path = NavPath(area: .shell(.home))
    var rest = levels
    if let (index, hit) = area {
      path = NavPath(
        mode: hit.mode, area: hit.screen == NativeNav.home ? .shell(.home) : .row(id: hit.row.id, screen: hit.screen, params: hit.params))
      rest = Array(levels.dropFirst(index + 1))
    }
    var pushed: [NavStep] = []
    for step in rest {
      if case .screen(let screen, _) = step, case .screen(let previous, _)? = pushed.last, previous == screen {
        pushed[pushed.count - 1] = step
      } else {
        pushed.append(step)
      }
    }
    // The area's own screen again with nothing more than the area's params is the area.
    if case .row(_, let screen, let params) = path.area, case .screen(screen, let own)? = pushed.first,
      withoutScope(own).allSatisfy({ params[$0.key] == $0.value })
    {
      pushed.removeFirst()
    }
    path.pushed = pushed
    return path
  }

  /// A row or section a level opens, and whether it is exactly that level (no record of its own picked).
  struct RowHit {
    let mode: NavPathMode
    let row: NativeNavRow
    let screen: String
    let params: NativeParams
    let exact: Bool
  }

  /// The best row or section for a screen in the lists, in their order: one whose params the level carries (the more the
  /// better), else the first that opens the screen at all.
  static func rowMatch(_ screen: String, _ params: NativeParams, in lists: [(mode: NavPathMode, list: ResolvedNavList)]) -> RowHit? {
    let own = withoutScope(params)
    var fallback: RowHit?
    for (mode, list) in lists {
      var best: RowHit?
      for row in list.groups.flatMap(\.rows) {
        for candidate in candidates(of: row) where candidate.screen == screen {
          if candidate.params.allSatisfy({ own[$0.key] == $0.value }) {
            if best == nil || candidate.params.count > best!.params.count {
              best = RowHit(mode: mode, row: row, screen: screen, params: candidate.params, exact: candidate.params == own)
            }
          } else if fallback == nil {
            fallback = RowHit(mode: mode, row: row, screen: screen, params: candidate.params, exact: false)
          }
        }
      }
      if let best { return best }
    }
    return fallback
  }

  /// The row's own screen and each of its sections', with their params.
  static func candidates(of row: NativeNavRow) -> [(screen: String, params: NativeParams)] {
    [(row.screen, row.params ?? [:])] + (row.sections ?? []).map { ($0.screen, $0.params ?? [:]) }
  }

  /// The row's own screen or one of its sections that is exactly this level (no record of its own picked).
  static func exactCandidate(_ screen: String, _ params: NativeParams, in row: NativeNavRow) -> (screen: String, params: NativeParams)? {
    let own = withoutScope(params)
    return candidates(of: row).first { $0.screen == screen && $0.params == own }
  }

  /// The row with this id in the lists, when it (or one of its sections) opens `screen`, with the section's params.
  static func row(
    _ id: String, holding screen: String, params: NativeParams, inSite: Bool, lists: NavPathLists
  ) -> (mode: NavPathMode, row: NativeNavRow, params: NativeParams)? {
    for (mode, list) in lists.ordered(inSite: inSite) {
      guard let row = list.groups.flatMap(\.rows).first(where: { $0.id == id }) else { continue }
      let matches = candidates(of: row).filter { $0.screen == screen }
      guard !matches.isEmpty else { continue }
      let fitting = matches.filter { candidate in candidate.params.allSatisfy { params[$0.key] == $0.value } }
      let pick = fitting.max { $0.params.count < $1.params.count } ?? matches[0]
      return (mode, row, pick.params)
    }
    return nil
  }

  /// The console address (scoped: `/products/orders?order=o1`) a screen and params are at: the route for the screen that
  /// takes the most of its params, the shortest on a tie. Nil when no route opens the screen with these params.
  public static func consoleAddress(screen: String, params: NativeParams, routes: [any DeepLinkRoute]) -> String? {
    var best: (address: String, bound: Int, segments: Int)?
    for route in routes where route.screen == screen {
      let pattern = DeepLinks.RoutePattern(route.path)
      var segments: [String] = []
      var bound = 0
      var fits = true
      for segment in pattern.path.split(separator: "/", omittingEmptySubsequences: true) {
        if let param = DeepLinks.PathParam(segment) {
          guard let value = params[param.name], !value.isEmpty, param.admits(value) else {
            fits = false
            break
          }
          segments.append(percentEncoded(value))
          bound += 1
        } else {
          segments.append(String(segment))
        }
      }
      var query: [String] = []
      for (key, param) in pattern.query where fits {
        guard let value = params[param], !value.isEmpty else {
          fits = false
          break
        }
        query.append("\(key)=\(percentEncoded(value))")
        bound += 1
      }
      guard fits else { continue }
      let address = "/" + segments.joined(separator: "/") + (query.isEmpty ? "" : "?" + query.joined(separator: "&"))
      if best == nil || bound > best!.bound || (bound == best!.bound && segments.count < best!.segments) {
        best = (address, bound, segments.count)
      }
    }
    return best?.address
  }

  static func split(_ full: String) -> (path: String, query: String?) {
    guard let at = full.firstIndex(of: "?") else { return (full, nil) }
    return (String(full[..<at]), String(full[full.index(after: at)...]))
  }

  static func percentEncoded(_ value: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/?&=#+")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
  }
}
