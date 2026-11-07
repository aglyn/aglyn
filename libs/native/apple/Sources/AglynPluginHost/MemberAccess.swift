// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * A resource's sharing scope (`visibleTo`), as scope-tokens.ts words and
 * checks it (the Kotlin kit's MemberAccess.kt); the data plugin's tests
 * replay the console's answers.
 */

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

/// The `scopeMode` a document kept up by the all-except sweep carries (`SCOPE_MODE_ALL_EXCEPT`).
public let scopeModeAllExcept = "allExcept"

/// How a document is shared, as a person would choose it (`ScopeSharing`).
public enum ScopeSharing: Equatable, Sendable {
  case all
  case selected(hostIDs: [String])
  case allExcept(exceptHostIDs: [String], includedHostIDs: [String])
  case none
}

private func uniqueStrings(_ values: [String]) -> [String] {
  var seen = Set<String>()
  return values.filter { !$0.isEmpty && seen.insert($0).inserted }
}

/// The excluded sites a marker names, or nil when the marker is not one to act on (anything but host tokens), so a
/// damaged marker never reads as "except nothing".
private func markerExceptHostIDs(_ doc: [String: Any]?) -> [String]? {
  guard doc?["scopeMode"] as? String == scopeModeAllExcept, let except = doc?["scopeExcept"] as? [Any] else { return nil }
  var ids: [String] = []
  for token in except {
    guard let text = token as? String, text.hasPrefix("host:"), text.count > 5 else { return nil }
    ids.append(String(text.dropFirst(5)))
  }
  return uniqueStrings(ids)
}

/// How a document is shared (`scopeSharingOf`). The marker is read only where it agrees with what readers enforce: a
/// document carrying `org` is All sites whatever a marker beside it says, and a damaged marker reads as the chosen sites.
public func scopeSharingOf(_ doc: [String: Any]?) -> ScopeSharing {
  let tokens = (doc?["visibleTo"] as? [Any]).map { $0.compactMap { $0 as? String } }
  if tokens?.contains(OrgAccess.orgScopeToken) == true { return .all }
  let included = uniqueStrings(hostIDs(tokens))
  if tokens != nil, let except = markerExceptHostIDs(doc) {
    return .allExcept(exceptHostIDs: except, includedHostIDs: included)
  }
  return included.isEmpty ? .none : .selected(hostIDs: included)
}

/// The sentence for how a document is shared (`describeSharing`): `describeScope`, plus "All sites except …". Sites are
/// named only where `hostNames` has them, so a reader who cannot see a site's name is told how many, never an id.
public func describeSharing(_ doc: [String: Any]?, hostNames: [String: String] = [:]) -> String {
  guard case .allExcept(let except, let included) = scopeSharingOf(doc) else {
    return describeScope((doc?["visibleTo"] as? [Any])?.compactMap { $0 as? String }, hostNames: hostNames)
  }
  if included.isEmpty { return "No sites" }
  let names = except.map { hostNames[$0] }
  if names.count == 1 { return "All sites except \(names[0] ?? "1 site")" }
  if names.count == 2, let first = names[0], let second = names[1] { return "All sites except \(first) and \(second)" }
  return "All sites except \(names.count) sites"
}

/// What a person picked (`ScopeSharingChoice`).
public enum ScopeSharingChoice: Equatable, Sendable {
  case all
  case selected(hostIDs: [String])
  case allExcept(exceptHostIDs: [String])
}

/// What a sharing choice writes (`ScopeSharingFields`): a nil marker means the document must not carry it.
public struct ScopeSharingFields: Equatable, Sendable {
  public let visibleTo: [String]
  public let scopeMode: String?
  public let scopeExcept: [String]?

  public init(visibleTo: [String], scopeMode: String?, scopeExcept: [String]?) {
    self.visibleTo = visibleTo
    self.scopeMode = scopeMode
    self.scopeExcept = scopeExcept
  }
}

/// What a sharing choice writes, or why it cannot be (`sharingFromChoice`). `orgHostIDs` is the workspace's sites as the
/// writer read them; an exclusion naming a site no longer there is dropped.
public func sharingFromChoice(
  _ choice: ScopeSharingChoice, orgHostIDs: [String], maxIncluded: Int? = nil, keepHostIDs: [String] = []
) -> (fields: ScopeSharingFields?, problem: String?) {
  switch choice {
  case .all: return (ScopeSharingFields(visibleTo: [OrgAccess.orgScopeToken], scopeMode: nil, scopeExcept: nil), nil)
  case .selected(let hostIDs):
    let stored = scopeToStore(hostIDs.map { "host:\($0)" })
    guard let scope = stored.scope else { return (nil, stored.problem) }
    return (ScopeSharingFields(visibleTo: scope, scopeMode: nil, scopeExcept: nil), nil)
  case .allExcept(let exceptHostIDs):
    let org = uniqueStrings(orgHostIDs)
    let except = uniqueStrings(exceptHostIDs).filter { org.contains($0) }
    if except.isEmpty { return (nil, "Choose at least one site to leave out, or share with All sites.") }
    let out = Set(except)
    let kept = Set(keepHostIDs)
    let included = org.filter { !out.contains($0) || kept.contains($0) }.sorted()
    if included.isEmpty { return (nil, "Keep at least one site in, or choose the sites.") }
    if let maxIncluded, included.count > maxIncluded {
      let reach = maxIncluded == 1 ? "1 site" : "\(maxIncluded) sites"
      return (nil, "This can reach \(reach) at most. Leave out more sites, or choose the sites.")
    }
    return (
      ScopeSharingFields(
        visibleTo: included.map { "host:\($0)" }, scopeMode: scopeModeAllExcept, scopeExcept: except.map { "host:\($0)" }),
      nil
    )
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
