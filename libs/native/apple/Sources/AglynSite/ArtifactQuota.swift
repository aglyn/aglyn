// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

// The per-plan count beside Create on the components, layouts and templates
// lists: `3/10 layouts on your plan`, the figure the console prints above its
// table and the one `/api/hosts/resources` refuses a create at (AGL-473). The
// cap is the plan's quota from `/api/orgs/entitlements` (`componentsPerHost`,
// `sharedLayoutsPerHost`, `templatesPerHost`), the count is the server's
// aggregate over what the route counts, not the length of the window the list
// has read (AGL-1716). The Kotlin kit's `ArtifactQuota.kt`.

extension ArtifactKind {
  /// The quota key `/api/hosts/resources` enforces for this list.
  public var quotaKey: String {
    switch self {
    case .component: "componentsPerHost"
    case .layout: "sharedLayoutsPerHost"
    case .template: "templatesPerHost"
    }
  }
}

/// The plan's cap for a list from the entitlements body: a number, or nil for an unlimited plan (the route writes
/// `null`, JSON having no Infinity) and for a quota the body does not name.
public func artifactQuotaLimit(_ body: JSONValue?, kind: ArtifactKind) -> Double? {
  guard case .object(let quotas)? = body?["quotas"], case .number(let cap)? = quotas[kind.quotaKey], cap.isFinite else { return nil }
  return cap
}

/// The two aggregates that count what the create route counts. Components and layouts: every document less the
/// tombstones (a delete stamps `deletedAt` and leaves the document). Templates: everything that is not a starter's page,
/// less the deleted ones, which `templateTombstoneQuery` reads (a second inequality beside the starter one needs a
/// composite index).
public func artifactCountQueries(_ kind: ArtifactKind, hostID: String) -> (total: FirestoreQuery, subtract: FirestoreQuery?) {
  let path = ["hosts", hostID, kind.collection]
  switch kind {
  case .component, .layout:
    let queries = liveCountQueries(path)
    return (queries.total, queries.tombstones)
  case .template:
    return (FirestoreQuery(path, filters: [ListQueryConstraint(path: "source.type", op: .notEqual, value: "starter")]), nil)
  }
}

/// How many deleted templates the readout reads to subtract; a site with more counts the rest as live, which only
/// overstates.
public let templateTombstoneWindow = 500

/// A site's deleted templates, for the template count to subtract (AGL-3918).
public func templateTombstoneQuery(hostID: String) -> FirestoreQuery {
  FirestoreQuery(["hosts", hostID, ArtifactKind.template.collection], filters: [tombstoneConstraint()], limit: templateTombstoneWindow)
}

/// Of a site's deleted templates, how many the `source.type != 'starter'` count included: a template whose
/// `source.type` is set and is not a starter's (the filter skips a template without the field). The console's
/// `deletedTemplatesCounted`.
public func deletedTemplatesCounted(_ tombstones: [FirestoreDocument]) -> Int {
  tombstones.filter { document in
    guard let type = (document.data["source"] as? [String: Any])?["type"], !(type is NSNull) else { return false }
    return (type as? String) != "starter"
  }.count
}

/// The count never goes below zero: the two aggregates are separate round trips and a delete between them can make the
/// second the larger.
public func artifactLiveCount(total: Int, subtract: Int?) -> Int { max(0, total - (subtract ?? 0)) }

/// One list's readout: the plan's cap and the site's count, each nil until it is known.
@MainActor
@Observable
public final class ArtifactQuotaModel {
  /// Whether the plan has answered; a readout before that says it is still checking.
  public private(set) var ready = false
  /// The plan's cap; nil is unlimited.
  public private(set) var limit: Double?
  /// The server's count; nil while it is pending or refused, and the list's own window stands in then.
  public private(set) var count: Int?

  @ObservationIgnored private var planKey: String?

  public init() {}

  /// Reads the plan once for the site and list.
  public func loadPlan(api: ConsoleAPIClient, kind: ArtifactKind, hostID: String) async {
    let key = "\(hostID)|\(kind.rawValue)"
    guard key != planKey else { return }
    planKey = key
    ready = false
    limit = nil
    do {
      let body = try await api.request("/api/orgs/entitlements", query: [("hostId", hostID)])
      limit = artifactQuotaLimit(body, kind: kind)
      ready = true
    } catch {
      // Asked again the next time the list opens; the readout keeps saying it is checking.
      planKey = nil
    }
  }

  /// Asks the server for the count again; run when the list's rows change, which is when a create or a delete could have.
  public func recount(_ reader: FirestoreReader, kind: ArtifactKind, hostID: String) async {
    let queries = artifactCountQueries(kind, hostID: hostID)
    guard let total = try? await reader.count(queries.total) else { return }
    var subtract: Int?
    if let tombstones = queries.subtract {
      // A refused second aggregate leaves the total, which can only overstate; the list's window stands in instead.
      guard let removed = try? await reader.count(tombstones) else { return }
      subtract = removed
    } else if kind == .template {
      guard let deleted = try? await reader.readOnce(templateTombstoneQuery(hostID: hostID)) else { return }
      subtract = deletedTemplatesCounted(deleted)
    }
    if Task.isCancelled { return }
    count = artifactLiveCount(total: total, subtract: subtract)
  }
}
