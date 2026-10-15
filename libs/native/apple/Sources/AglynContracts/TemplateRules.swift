// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// Where a page made from a template lands, and how its placeholders are
// filled, ported once from libs/aglyn/src/lib/app-utils/{screen-slug,
// template-slug,resolve-named-tokens}.ts. function-cases.generated.json holds
// the answers the TypeScript gives, and the tests replay every one.

public let screenRootPath = "/"

private func stripping(_ text: String, _ pattern: String, with replacement: String = "") -> String {
  text.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
}

/// Root path `/`; anything else one lower-case url-safe segment, or nil for nothing (empty, or `###`).
public func normalizeScreenSlug(_ input: String?) -> String? {
  let trimmed = (input ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { return nil }
  if trimmed == screenRootPath { return screenRootPath }
  var segment = trimmed.lowercased()
  segment = stripping(segment, "^/+|/+$")
  segment = stripping(segment, "\\s+", with: "-")
  segment = stripping(segment, "[^a-z0-9\\-_]")
  segment = stripping(segment, "-{2,}", with: "-")
  segment = stripping(segment, "^-+|-+$")
  return segment.isEmpty ? nil : segment
}

/// The reserved segment a routing-map path would collide with (`search`, `api`, `404`…), or nil when it is servable.
public func reservedScreenRouteSegment(_ path: String?) -> String? {
  guard let path, !path.isEmpty, path != screenRootPath else { return nil }
  let first = stripping(path, "^/+").split(separator: "/", omittingEmptySubsequences: false).first.map(String.init) ?? ""
  return ContractValues.shared.reservedScreenRouteSegments.contains(first) ? first : nil
}

/// What an author reads when a slug names a reserved segment.
public func reservedScreenRouteMessage(_ segment: String) -> String {
  "\"/\(segment)\" is a reserved address on every Aglyn site — pick another slug"
}

/// A raw slug holding an interior `/`: a slug is one path segment (leading and trailing slashes are not separators).
public func screenSlugHasPathSeparator(_ input: String?) -> Bool {
  let trimmed = (input ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty || trimmed == screenRootPath { return false }
  return stripping(trimmed, "^/+|/+$").contains("/")
}

/// Why one template page cannot get the address it asks for, or nil when it can.
public func templateScreenAddressRefusal(slug: String?, displayName: String?) -> String? {
  if screenSlugHasPathSeparator(slug) { return ContractValues.shared.screenSlugPathSeparatorMessage }
  let requested = normalizeScreenSlug(slug) ?? normalizeScreenSlug(displayName) ?? "page"
  return reservedScreenRouteSegment(requested).map(reservedScreenRouteMessage)
}

/// The address a page claims and the one it asked for.
public struct TemplateSlug: Equatable, Sendable {
  public let slug: String
  public let requestedSlug: String
}

/// The address a template page claims. A collision falls back (the home page
/// to its name, then numeric suffixes); it never overwrites. Adds what it
/// hands out to `taken`.
public func resolveTemplateSlug(slug: String?, displayName: String, taken: inout Set<String>) -> TemplateSlug {
  let named = normalizeScreenSlug(displayName) ?? "page"
  let requested = normalizeScreenSlug(slug) ?? named
  let base = requested == screenRootPath && taken.contains(screenRootPath) ? named : requested
  var claimed = base
  var attempt = 2
  while taken.contains(claimed) {
    claimed = "\(base)-\(attempt)"
    attempt += 1
  }
  taken.insert(claimed)
  return TemplateSlug(slug: claimed, requestedSlug: requested)
}

/// Gives a multi-page bundle a home page when nothing in it claims one and the
/// site has none: the first page takes the root.
public func withBundleRootScreen<T>(
  _ screens: [T], taken: some Collection<String>, slug: (T) -> String?, setting: (T, String) -> T
) -> [T] {
  guard let first = screens.first, !taken.contains(screenRootPath) else { return screens }
  if screens.contains(where: { normalizeScreenSlug(slug($0)) == screenRootPath }) { return screens }
  return [setting(first, screenRootPath)] + screens.dropFirst()
}

/// A template's `{{name}}` placeholders filled in across every node's props
/// (nested maps and lists too); a name with no value is blanked. No values, no
/// change.
public func resolveNamedTokens(_ nodes: [String: Any], tokens: [String: String]?) -> [String: Any] {
  guard let tokens, !tokens.isEmpty else { return nodes }
  let alternatives = tokens.keys.map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|")
  guard let pattern = try? NSRegularExpression(pattern: "\\{\\{\\s*(\(alternatives))\\s*\\}\\}") else { return nodes }
  func substitute(_ value: Any) -> Any {
    switch value {
    case let text as String:
      let source = text as NSString
      var out = ""
      var cursor = 0
      for match in pattern.matches(in: text, range: NSRange(location: 0, length: source.length)) {
        out += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
        out += tokens[source.substring(with: match.range(at: 1))] ?? ""
        cursor = match.range.location + match.range.length
      }
      return out + source.substring(from: cursor)
    case let list as [Any]: return list.map(substitute)
    case let map as [String: Any]: return map.mapValues(substitute)
    default: return value
    }
  }
  return nodes.mapValues { node in
    guard var map = node as? [String: Any], let props = map["props"], !(props is NSNull) else { return node }
    map["props"] = substitute(props)
    return map
  }
}

/// The bare `{{name}}` tokens in a captured tree, sorted: what a saved template
/// asks for when it is used. A `{{var:…}}`/`{{fn:…}}` binding resolves against
/// the site and a `{{prop.*}}` token binds to a property the template carries,
/// so neither is a placeholder.
public func detectTemplatePlaceholders(_ nodes: [String: Any]) -> [String] {
  guard let pattern = try? NSRegularExpression(pattern: "\\{\\{\\s*([a-zA-Z][A-Za-z0-9_.\\-]*)\\s*\\}\\}") else { return [] }
  var found = Set<String>()
  func walk(_ value: Any) {
    switch value {
    case let text as String:
      let source = text as NSString
      for match in pattern.matches(in: text, range: NSRange(location: 0, length: source.length)) {
        let name = source.substring(with: match.range(at: 1))
        if !name.contains(":") && !name.hasPrefix(ContractValues.shared.componentPropTokenPrefix) { found.insert(name) }
      }
    case let list as [Any]: list.forEach(walk)
    case let map as [String: Any]: map.values.forEach(walk)
    default: break
    }
  }
  walk(nodes)
  return found.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
}
