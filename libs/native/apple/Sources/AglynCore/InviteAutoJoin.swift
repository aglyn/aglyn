// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Observation

/// Invitations join on their own (AGL-4023, standing): once the account exists and its address is confirmed, every
/// invitation waiting for it is accepted through the console's own `POST /api/orgs/invites` `accept`, the way the
/// console's `InviteAutoAcceptProvider` does on every load. Nobody is asked to accept or decline. The server keeps its
/// checks (a confirmed address, the seat quota, the sign-in lockout on a hand-off); a join it refuses is shown as
/// "almost ready", never with a reason or a choice, because the refusal is the inviter's to fix and the inviter has been
/// told. Each invitation is tried once a session; the next session tries a refused one again. Never during a support
/// session, which must not act as the customer.
@MainActor
@Observable
public final class InviteAutoJoin {
  public enum Status: Equatable, Sendable {
    /// Being accepted.
    case joining
    /// Accepted: the person is a member now.
    case joined
    /// The server did not let it finish yet: shown as "almost ready".
    case waiting
  }

  /// The invitations found for the account, in the order the server listed them.
  public private(set) var invites: [PendingInvite] = []
  public private(set) var statuses: [String: Status] = [:]

  @ObservationIgnored private let list: @Sendable () async -> [PendingInvite]
  @ObservationIgnored private let accept: @Sendable (PendingInvite) async throws -> Void
  @ObservationIgnored private var attempted = Set<String>()
  @ObservationIgnored private var running = false

  public init(
    list: @escaping @Sendable () async -> [PendingInvite],
    accept: @escaping @Sendable (PendingInvite) async throws -> Void
  ) {
    self.list = list
    self.accept = accept
  }

  /// Joins through the console's routes, as the console does.
  public convenience init(service: SignUpService) {
    self.init(list: { await service.pendingInvites() }, accept: { try await service.answer($0, accept: true) })
  }

  /// The invitations being joined right now ("Joining Acme…").
  public var joining: [PendingInvite] { invites.filter { statuses[$0.id] == .joining } }
  /// The invitations whose join the server has not let finish ("Your access to Acme is almost ready").
  public var waiting: [PendingInvite] { invites.filter { statuses[$0.id] == .waiting } }

  /// Reads the account's invitations and accepts each one not tried yet this session; answers the workspaces joined,
  /// so the caller can open one. Does nothing during a support session.
  @discardableResult
  public func run(impersonating: Bool) async -> [String] {
    guard !impersonating, !running else { return [] }
    running = true
    defer { running = false }
    let found = await list()
    invites = found
    var joined: [String] = []
    for invite in found where !attempted.contains(invite.id) {
      attempted.insert(invite.id)
      statuses[invite.id] = .joining
      do {
        try await accept(invite)
        statuses[invite.id] = .joined
        joined.append(invite.orgID)
      } catch {
        statuses[invite.id] = .waiting
      }
    }
    return joined
  }
}
