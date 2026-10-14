// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/*
 * A resource's sharing scope (`visibleTo`), as scope-tokens.ts words and
 * checks it (the Kotlin kit's MemberAccess.kt); the data plugin's tests
 * replay the console's answers.
 */

/// Roles that may change org data (`canWriteOrgData()` in the rules).
public let orgWriterRoles: Set<String> = ["owner", "admin", "editor"]

/// The most sites one stored scope may name (`MAX_SCOPE_HOSTS`).
public let maxScopeHosts = 30

private func hostIDs(_ visibleTo: [String]?) -> [String] {
  (visibleTo ?? []).filter { $0.hasPrefix("host:") && $0.count > 5 }.map { String($0.dropFirst(5)) }
}

/// "All sites", "Bakery only", "3 sites" or "No sites" (`describeScope`).
public func describeScope(_ visibleTo: [String]?, hostNames: [String: String] = [:]) -> String {
  if let visibleTo, visibleTo.contains(OrgAccess.orgScopeToken) { return "All sites" }
  let ids = hostIDs(visibleTo)
  switch ids.count {
  case 0: return "No sites"
  case 1: return hostNames[ids[0]].map { "\($0) only" } ?? "1 site"
  default: return "\(ids.count) sites"
  }
}

/// A picked scope as it may be stored, or the problem with it (`scopeToStore`).
public func scopeToStore(_ input: [String]?) -> (scope: [String]?, problem: String?) {
  let tokens = (input ?? []).filter { $0 == OrgAccess.orgScopeToken || ($0.hasPrefix("host:") && $0.count > 5) }
  var scope: [String]?
  if tokens.isEmpty {
    scope = nil
  } else if tokens.contains(OrgAccess.orgScopeToken) {
    scope = [OrgAccess.orgScopeToken]
  } else {
    var seen = Set<String>()
    let unique = tokens.filter { seen.insert($0).inserted }
    scope = unique.count <= maxScopeHosts ? unique : nil
  }
  if scope != nil { return (scope, nil) }
  return (
    nil,
    tokens.isEmpty
      ? "Choose at least one site, or share with All sites." : "Choose \(maxScopeHosts) sites or fewer, or share with All sites."
  )
}

/// Whether `after` takes access away from a site `before` reached (`narrowsScope`).
public func narrowsScope(_ before: [String]?, _ after: [String]?) -> Bool {
  let wideBefore = before?.contains(OrgAccess.orgScopeToken) == true
  let wideAfter = after?.contains(OrgAccess.orgScopeToken) == true
  if wideBefore { return !wideAfter }
  if wideAfter { return false }
  let kept = Set(after ?? [])
  return (before ?? []).contains { !kept.contains($0) }
}
