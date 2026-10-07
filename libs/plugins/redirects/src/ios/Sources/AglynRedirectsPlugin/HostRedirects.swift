// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/// One redirect rule as the console's Redirects page shows it: the
/// generated `HostRedirect` contract, with its document id.
public struct RedirectRow: Identifiable, Equatable, Sendable {
  public let id: String
  public let rule: HostRedirect
  /// Soft-deleted: gone for the console and the serve path.
  public let deleted: Bool

  public init(id: String, rule: HostRedirect, deleted: Bool = false) {
    self.id = id
    self.rule = rule
    self.deleted = deleted
  }

  init(_ doc: FirestoreDocument) {
    self.init(
      id: doc.id,
      rule: HostRedirect(
        destination: doc.string("destination") ?? "", enabled: doc.bool("enabled"),
        externalDestinationApprovedBy: doc.string("externalDestinationApprovedBy"),
        kind: doc.string("kind").map { HostRedirectKind(rawValue: $0) ?? .unknown },
        priority: doc.double("priority"), source: doc.string("source") ?? "",
        statusCode: doc.int("statusCode") ?? 301),
      deleted: doc.data["deletedAt"] != nil && !(doc.data["deletedAt"] is NSNull))
  }

  public var source: String { rule.source }
  public var destination: String { rule.destination }
  public var statusCode: Int { rule.statusCode }
  public var isOn: Bool { rule.enabled != false }
  public var priority: Double { rule.priority ?? HostRedirects.defaultPriority }
}

public enum HostRedirects {
  /// The console Redirects page's own ceiling: a window the page holds whole,
  /// so the app shows the same rules the console does.
  public static let window = 200
  /// The serve path's default priority for a rule without one (`REDIRECT_DEFAULT_PRIORITY`).
  public static let defaultPriority: Double = 100

  /// Evaluation order, as the serve path applies it: priority, then source.
  /// A soft-deleted rule is gone for the console and for the serve path.
  public static func inEvaluationOrder(_ rows: [RedirectRow]) -> [RedirectRow] {
    rows.filter { !$0.deleted }.sorted {
      $0.priority != $1.priority ? $0.priority < $1.priority : $0.source < $1.source
    }
  }
}

/// A site's redirect rules, live: `hosts/{hostId}/redirects`, which a member
/// of the site may read, under the same rules the console reads it with.
@MainActor
@Observable
final class HostRedirectsModel {
  private(set) var rows: [RedirectRow] = []
  private(set) var ready = false
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String?) {
    listener?.remove()
    rows = []
    ready = false
    failed = false
    guard let hostID else { return }
    listener = reader.listen(FirestoreQuery(["hosts", hostID, "redirects"], limit: HostRedirects.window)) {
      [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.rows = HostRedirects.inEvaluationOrder(docs.map(RedirectRow.init))
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
