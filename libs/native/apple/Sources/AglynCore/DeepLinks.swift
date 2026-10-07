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

  /// Matches `/a/:b/c` against a path; returns the `:` params or nil.
  public static func matchPathPattern(_ pattern: String, _ path: String) -> NativeParams? {
    let want = pattern.split(separator: "/", omittingEmptySubsequences: true)
    let have = path.split(separator: "/", omittingEmptySubsequences: true)
    guard want.count == have.count else { return nil }
    var params: NativeParams = [:]
    for (expected, actual) in zip(want, have) {
      if expected.hasPrefix(":") {
        guard let decoded = String(actual).removingPercentEncoding else { return nil }
        params[String(expected.dropFirst())] = decoded
      } else if expected != actual {
        return nil
      }
    }
    return params
  }

  public static func resolve(_ link: String, routes: [any DeepLinkRoute]) -> LinkTarget? {
    guard let full = consolePath(of: link) else { return nil }
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
    // Most specific pattern first: fewer `:` segments wins a tie in length.
    let segments = { (route: any DeepLinkRoute) in route.path.components(separatedBy: "/").count }
    let colons = { (route: any DeepLinkRoute) in route.path.filter { $0 == ":" }.count }
    let ordered = routes.enumerated().sorted { a, b in
      let (la, lb) = (segments(a.element), segments(b.element))
      if la != lb { return la > lb }
      let (ca, cb) = (colons(a.element), colons(b.element))
      if ca != cb { return ca < cb }
      return a.offset < b.offset
    }
    for (_, route) in ordered {
      guard let params = matchPathPattern(route.path, scope.rest) else { continue }
      var merged = query
      if let org = scope.orgSlug { merged["orgSlug"] = org }
      if let host = scope.hostSlug { merged["hostSlug"] = host }
      merged.merge(params) { _, new in new }
      return .screen(route.screen, merged)
    }
    return isBesignerPath(path) ? .besigner(full) : .unavailable(full)
  }
}
