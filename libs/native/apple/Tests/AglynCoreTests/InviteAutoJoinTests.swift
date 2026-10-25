// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Invitations join on their own (AGL-4023): accepted once the account is in use, never asked about.
@MainActor
final class InviteAutoJoinTests: XCTestCase {
  private final class Calls: @unchecked Sendable {
    var accepted: [String] = []
    var refuse: Set<String> = []
  }

  private let acme = PendingInvite(id: "i1", orgID: "o1", orgName: "Acme Builders", role: "editor", handoff: false)
  private let north = PendingInvite(id: "i2", orgID: "o2", orgName: "North Studio", role: "admin", handoff: true)

  private func join(_ invites: [PendingInvite], _ calls: Calls) -> InviteAutoJoin {
    InviteAutoJoin(
      list: { invites },
      accept: { invite in
        if calls.refuse.contains(invite.id) { throw ConsoleAPIError(status: 409, message: "still being set up") }
        calls.accepted.append(invite.id)
      })
  }

  func testEveryInvitationIsAcceptedWithoutAsking() async {
    let calls = Calls()
    let auto = join([acme, north], calls)
    let joined = await auto.run(impersonating: false)
    XCTAssertEqual(joined, ["o1", "o2"])
    XCTAssertEqual(calls.accepted, ["i1", "i2"])
    XCTAssertEqual(auto.statuses, ["i1": .joined, "i2": .joined])
    XCTAssertTrue(auto.waiting.isEmpty)
  }

  func testARefusedJoinWaitsQuietlyAndIsNotRetriedThisSession() async {
    let calls = Calls()
    calls.refuse = ["i2"]
    let auto = join([acme, north], calls)
    _ = await auto.run(impersonating: false)
    XCTAssertEqual(auto.waiting.map(\.id), ["i2"])
    calls.refuse = []
    let again = await auto.run(impersonating: false)
    XCTAssertEqual(again, [], "each invitation is tried once a session")
    XCTAssertEqual(calls.accepted, ["i1"])
  }

  func testASupportSessionNeverJoinsForTheCustomer() async {
    let calls = Calls()
    let auto = join([acme], calls)
    let joined = await auto.run(impersonating: true)
    XCTAssertEqual(joined, [])
    XCTAssertTrue(calls.accepted.isEmpty)
  }
}
