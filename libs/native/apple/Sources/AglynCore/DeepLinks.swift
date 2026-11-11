// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A route parameter bag, as navigation and deep links carry it.
public typealias NativeParams = [String: String]

/// A console path pattern a plugin answers natively.
public protocol DeepLinkRoute {
  /// A console path pattern, e.g. `/redirects/:redirectId`.
  var path: String { get }
  /// The screen id it opens.
  var screen: String { get }
}

/// Where a link goes: a registered screen, the Besigner (the only web
/// content the apps show, in their own web view), or nowhere yet: a console
/// page the app has no native screen for. That is a gap to build; it never
/// opens the console page instead.
public enum LinkTarget: Equatable, Sendable {
  case screen(String, NativeParams)
  case besigner(String)
  case unavailable(String)
}

/// Turns a console URL or path into where the app should go.
///
/// Every link the app meets is a console link: a universal link to the
/// console's own domain, an `aglyn://` link, or a notification's `link`. A
/// plugin that answers a path natively registers a deep link for it. A
/// Besigner path opens the Besigner in the app's web view; nothing else does.
public enum DeepLinks {
  /// The console's own top-level sections, which are not workspaces and are matched whole.
  public static let consoleTopLevel: Set<String> = [
    "admin", "api", "auth", "billing", "manage", "signin", "signup", "support",
  ]

  public struct Scope: Equatable, Sendable {
    public var orgSlug: String?
    public var hostSlug: String?
    public var rest: String
  }

  /// Splits `/{orgSlug}/hosts/{hostSlug}/…` and `/{orgSlug}/…` into the slugs and the rest.
  public static func splitConsoleScope(_ path: String) -> Scope {
    let segments = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    guard let first = segments.first, !consoleTopLevel.contains(first) else {
      return Scope(rest: path.isEmpty ? "/" : path)
    }
    if segments.count >= 3 && segments[1] == "hosts" && !segments[2].isEmpty {
      return Scope(
        orgSlug: first, hostSlug: segments[2],
        rest: "/" + segments.dropFirst(3).joined(separator: "/"))
    }
    return Scope(orgSlug: first, rest: "/" + segments.dropFirst().joined(separator: "/"))
  }

  /// The Besigner's pages under `/{orgSlug}/hosts/{hostSlug}`: the console's
  /// `(editor)` route group, and nothing else (the Kotlin kit's `BesignerPaths`).
  static let besignerSitePatterns = [
    "^/theme$",
    "^/templates/[^/]+/(besigner|preview)$",
    "^/emails/[^/]+/versions/[^/]+/besigner$",
    "^/screens/[^/]+/versions/[^/]+(/(besigner|preview|view))?$",
    // Components, layouts and every plugin's declared Besigner document.
    "^/[^/]+/[^/]+/versions/[^/]+/(besigner|preview)$",
  ]

  /// The staff console's editor pages.
  static let besignerStaffPatterns = [
    "^/admin/emails/[^/]+/versions/[^/]+/besigner$",
    "^/admin/sites/[^/]+/preview/[^/]+/[^/]+$",
  ]

  /// Whether `path`, a whole console path (its query and fragment ignored),
  /// is a Besigner page: the only web content the apps show.
  public static func isBesignerPath(_ path: String) -> Bool {
    let bare = String(path.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
      .split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    guard bare.hasPrefix("/"), !bare.contains("//"),
      !bare.split(separator: "/").contains(where: { $0 == ".." || $0 == "." })
    else { return false }
    let matches = { (pattern: String, text: String) in text.range(of: pattern, options: .regularExpression) != nil }
    if besignerStaffPatterns.contains(where: { matches($0, bare) }) { return true }
    let scope = splitConsoleScope(bare)
    guard let host = scope.hostSlug, !host.isEmpty else { return false }
    return besignerSitePatterns.contains { matches($0, scope.rest) }
  }

  /// The Besigner on one page's working version, under the picked site.
  public static func besignerScreen(_ screenID: String, versionID: String) -> String {
    "/screens/\(screenID)/versions/\(versionID)/besigner"
  }

  /// The path part of a console URL, an `aglyn://` URL, or a bare path.
  public static func consolePath(of link: String) -> String? {
    let value = link.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty { return nil }
    if value.hasPrefix("/") { return value.hasPrefix("//") ? nil : value }
    if value.lowercased().hasPrefix("aglyn://") {
      var rest = String(value.dropFirst("aglyn://".count))
      while rest.hasPrefix("/") { rest.removeFirst() }
      return "/" + rest
    }
    guard let components = URLComponents(string: value),
      let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
      components.host?.isEmpty == false
    else { return nil }
    let path = components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath
    let query = components.percentEncodedQuery.map { "?\($0)" } ?? ""
    return path + query
  }

  /// A link to a workspace's or site's own root (`/{orgSlug}`, `/{orgSlug}/hosts/{hostSlug}`, or a notification's
  /// stored `/{hostId}` and `/org`) with a query: the query, read the way `URLSearchParams` reads it. A notice about an
  /// AI job that built nothing of its own to open is stored as `/{hostId}?aiJob={jobId}` (`aiJobNoticeLink`).
  public static func rootQuery(_ link: String) -> NativeParams? {
    guard let full = consolePath(of: link), let at = full.firstIndex(of: "?") else { return nil }
    let path = String(full[..<at])
    let scope = splitConsoleScope(path)
    guard scope.orgSlug != nil, scope.rest == "/" else { return nil }
    let query = queryParams(String(full[full.index(after: at)...]).split(separator: "#").first.map(String.init) ?? "")
    return query.isEmpty ? nil : query
  }

  /// `application/x-www-form-urlencoded` decoding, as `URLSearchParams` reads a query.
  static func queryParams(_ query: String) -> NativeParams {
    var params: NativeParams = [:]
    for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
      let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      let decode = { (raw: Substring) -> String in
        let spaced = raw.replacingOccurrences(of: "+", with: " ")
        return spaced.removingPercentEncoding ?? spaced
      }
      params[decode(parts[0])] = parts.count > 1 ? decode(parts[1]) : ""
    }
    return params
  }

  /// Matches `/a/:b/c` against a path; returns the `:` params or nil. A param may name the values it takes,
  /// `:section(payouts|sales)`, or the ones it refuses, `:listingId(!upload)`: a console page whose literal segment sits
  /// where an id would never becomes that id (AGL-4215).
  public static func matchPathPattern(_ pattern: String, _ path: String) -> NativeParams? {
    let want = pattern.split(separator: "/", omittingEmptySubsequences: true)
    let have = path.split(separator: "/", omittingEmptySubsequences: true)
    guard want.count == have.count else { return nil }
    var params: NativeParams = [:]
    for (expected, actual) in zip(want, have) {
      if let param = PathParam(expected) {
        guard let decoded = String(actual).removingPercentEncoding, param.admits(decoded) else { return nil }
        params[param.name] = decoded
      } else if expected != actual {
        return nil
      }
    }
    return params
  }

  /// One `:name`, `:name(a|b)` or `:name(!a|b)` segment of a route pattern.
  struct PathParam {
    let name: String
    let values: Set<String>?
    let refuses: Bool

    init?(_ segment: Substring) {
      guard segment.hasPrefix(":") else { return nil }
      let body = segment.dropFirst()
      guard let open = body.firstIndex(of: "("), body.hasSuffix(")") else {
        (name, values, refuses) = (String(body), nil, false)
        return
      }
      var list = body[body.index(after: open)..<body.index(before: body.endIndex)]
      refuses = list.hasPrefix("!")
      if refuses { list = list.dropFirst() }
      name = String(body[..<open])
      values = Set(list.split(separator: "|").map(String.init))
    }

    /// Whether it takes any value but the ones it refuses (an id), rather than one of a few named pages.
    var open: Bool { values == nil || refuses }

    func admits(_ value: String) -> Bool {
      guard let values else { return true }
      return refuses ? !values.contains(value) : values.contains(value)
    }
  }

  /// A route pattern split into its path and the query keys it needs: `/products/orders?order=:orderId` matches
  /// `/products/orders` only when the link carries a non-empty `order`, and binds it as `orderId` (the console's own
  /// order and quote addresses, AGL-4215).
  struct RoutePattern {
    let path: String
    let query: [(key: String, param: String)]
    /// How many segments take any value; a pattern with fewer wins a tie.
    let openParams: Int

    init(_ pattern: String) {
      let parts = pattern.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
      path = String(parts[0])
      query = parts.count > 1
        ? parts[1].split(separator: "&").compactMap { pair in
          let kv = pair.split(separator: "=", maxSplits: 1)
          guard kv.count == 2, kv[1].hasPrefix(":") else { return nil }
          return (String(kv[0]), String(kv[1].dropFirst()))
        }
        : []
      openParams = path.split(separator: "/").filter { PathParam($0)?.open == true }.count
    }

    var segments: Int { path.split(separator: "/", omittingEmptySubsequences: true).count }

    /// The query params it binds, or nil when the link lacks one it needs.
    func bind(_ linkQuery: NativeParams) -> NativeParams? {
      var bound: NativeParams = [:]
      for (key, param) in query {
        guard let value = linkQuery[key], !value.isEmpty else { return nil }
        bound[param] = value
      }
      return bound
    }
  }

  /// A link without its `#fragment`, which names a spot on a page and never a page (`/admin/orgs/{id}#site-care`).
  public static func withoutFragment(_ link: String) -> String {
    link.firstIndex(of: "#").map { String(link[..<$0]) } ?? link
  }

  /// A notification's stored link as the console follows it (`normalizeNotificationLink`, AGL-644): host
  /// notifications are stored as `/{hostDocId}/…` and opened at `/{orgSlug}/hosts/{subdomain}/…`, and `/org/…`
  /// is the workspace's own `/{orgSlug}/…`. Anything else, and an absolute URL, is left as it is.
  public static func notificationLink(
    _ link: String?, orgSlug: String?, hostID: String?, hostSubdomain: String?
  ) -> String? {
    guard let link, !link.isEmpty else { return nil }
    guard link.hasPrefix("/") else { return link }
    if let orgSlug, !orgSlug.isEmpty, let hostID, !hostID.isEmpty, let hostSubdomain, !hostSubdomain.isEmpty {
      let prefix = "/\(hostID)"
      if link == prefix || link.hasPrefix(prefix + "/") || link.hasPrefix(prefix + "?") {
        return "/\(orgSlug)/hosts/\(hostSubdomain)" + link.dropFirst(prefix.count)
      }
    }
    if let orgSlug, !orgSlug.isEmpty {
      if link == "/org" || link.hasPrefix("/org/") || link.hasPrefix("/org?") {
        return "/\(orgSlug)" + link.dropFirst("/org".count)
      }
      if link == "/hosts" { return "/\(orgSlug)/hosts" }
    }
    return link
  }

  public static func resolve(_ link: String, routes: [any DeepLinkRoute]) -> LinkTarget? {
    guard let raw = consolePath(of: link) else { return nil }
    let full = withoutFragment(raw)
    let path: String
    let query: NativeParams
    if let at = full.firstIndex(of: "?") {
      path = String(full[..<at])
      query = queryParams(String(full[full.index(after: at)...]))
    } else {
      path = full
      query = [:]
    }
    let scope = splitConsoleScope(path)
    if let (screen, params) = match(scope.rest, query: query, routes: routes) {
      var merged = params
      if let org = scope.orgSlug { merged["orgSlug"] = org }
      if let host = scope.hostSlug { merged["hostSlug"] = host }
      return .screen(screen, merged)
    }
    return isBesignerPath(raw) ? .besigner(raw) : .unavailable(full)
  }

  /// The registered screen a scoped console path (`/products/orders`, the part after `/{orgSlug}/hosts/{hostSlug}`) and
  /// its query open, with the query, the query keys a pattern binds and the path's params; nil when no route answers it.
  public static func match(_ rest: String, query: NativeParams, routes: [any DeepLinkRoute]) -> (screen: String, params: NativeParams)? {
    // Most specific pattern first: in a tie in length, the one that needs more of the query, then the one with fewer
    // segments that take any value (`/marketplace/payouts` and `:section(payouts|…)` before `:listingId`).
    let ordered = routes.enumerated().map { (offset: $0.offset, route: $0.element, pattern: RoutePattern($0.element.path)) }
      .sorted { a, b in
        if a.pattern.segments != b.pattern.segments { return a.pattern.segments > b.pattern.segments }
        if a.pattern.query.count != b.pattern.query.count { return a.pattern.query.count > b.pattern.query.count }
        if a.pattern.openParams != b.pattern.openParams { return a.pattern.openParams < b.pattern.openParams }
        return a.offset < b.offset
      }
    for (_, route, pattern) in ordered {
      guard let params = matchPathPattern(pattern.path, rest), let bound = pattern.bind(query) else { continue }
      var merged = query
      merged.merge(bound) { _, new in new }
      merged.merge(params) { _, new in new }
      return (route.screen, merged)
    }
    return nil
  }
}
