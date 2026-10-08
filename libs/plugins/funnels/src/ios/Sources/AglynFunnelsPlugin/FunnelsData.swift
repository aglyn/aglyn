// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation
import Observation

/// The ranges the card offers, in days.
let funnelRanges = [7, 14, 30, 90]

private let dayMs = 86_400_000

/// The last `days` UTC days, ending today, as the results door reads a range.
func recentRange(days: Int, nowMs: Int) -> (from: String, to: String) {
  (isoDay(nowMs - (days - 1) * dayMs), isoDay(nowMs))
}

private func isoDay(_ ms: Int) -> String {
  let formatter = DateFormatter()
  formatter.calendar = Calendar(identifier: .iso8601)
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(identifier: "UTC")
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
}

/// A funnel as the console stores it, with its id. A draft is one an AI build made for review.
public struct FunnelRow: Identifiable, Equatable, Sendable {
  public let id: String
  public let definition: FunnelDefinition
  public let draft: Bool
  /// Moves when the funnel is saved, so a result is read again.
  public let version: String

  public init(id: String, definition: FunnelDefinition, draft: Bool = false, version: String = "") {
    self.id = id
    self.definition = definition
    self.draft = draft
    self.version = version
  }

  /// Nil for a document that is not a valid funnel, as the card drops it.
  init?(_ doc: FirestoreDocument) {
    guard let definition = try? doc.decode(FunnelDefinition.self) else { return nil }
    let inputs = definition.steps.map {
      FunnelStepInput(type: $0.type.rawValue, key: $0.key, match: $0.match?.rawValue, label: $0.label)
    }
    guard normalizeFunnelDefinition(name: definition.name, steps: inputs).funnel != nil else { return nil }
    self.init(
      id: doc.id, definition: definition, draft: doc.string("status") == "draft",
      version: doc.data["updatedAt"].map { String(describing: $0) } ?? "")
  }

  public var name: String { definition.name }
  public var steps: [FunnelStep] { definition.steps }
}

enum HostFunnels {
  /// By name, as the card lists them.
  static func inListOrder(_ rows: [FunnelRow]) -> [FunnelRow] {
    rows.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  }
}

/// What the signed-in person may do here: the paid analytics tier gates
/// everything, the role gates changes.
struct FunnelsAccessState: Equatable {
  var canManage: Bool
  var entitled: Bool
  var ready: Bool

  init(role: String?, org: [String: Any]?, orgReady: Bool) {
    canManage = role == "admin" || role == "editor"
    entitled = orgReady && planFeatureCarried(org, ContractValues.shared.funnelFeature)
    ready = orgReady
  }

  static func == (a: FunnelsAccessState, b: FunnelsAccessState) -> Bool {
    a.canManage == b.canManage && a.entitled == b.entitled && a.ready == b.ready
  }
}

@MainActor
@Observable
final class FunnelsAccess {
  @ObservationIgnored let host = ObservedDocument()
  @ObservationIgnored let org = ObservedDocument()
  private var uid = ""
  private var fallbackRole: String?

  func start(_ context: NativePluginContext) {
    uid = context.uid
    fallbackRole = context.siteRole
    if let hostID = context.hostID { host.start(context.firestore, ["hosts", hostID]) }
    if let orgID = context.orgID { org.start(context.firestore, ["orgs", orgID]) }
  }

  func stop() {
    host.stop()
    org.stop()
  }

  var state: FunnelsAccessState {
    let role = (host.document?.data["memberRoles"] as? [String: Any])?[uid] as? String ?? fallbackRole
    return FunnelsAccessState(role: role, org: org.document?.data, orgReady: org.ready)
  }
}

/// A site's funnels, live: `hosts/{hostId}/funnels`, the collection the Funnels card reads.
@MainActor
@Observable
final class HostFunnelsModel {
  private(set) var rows: [FunnelRow] = []
  private(set) var ready = false
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String?) {
    listener?.remove()
    rows = []
    ready = false
    failed = false
    guard let hostID else { return }
    listener = reader.listen(FirestoreQuery(["hosts", hostID, "funnels"], limit: ContractValues.shared.funnelsMaxPerSite)) {
      [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.rows = HostFunnels.inListOrder(docs.compactMap(FunnelRow.init))
        self.failed = false
      case .failure:
        self.rows = []
        self.failed = true
      }
      self.ready = true
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}
