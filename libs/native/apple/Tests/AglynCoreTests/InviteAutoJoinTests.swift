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

  /// With several invitations, the newest is the one a person is opened into; the rest join where they stand (AGL-4047).
  func testOnlyTheNewestInvitationOpens() async {
    let calls = Calls()
    let older = PendingInvite(id: "i1", orgID: "o1", orgName: "Acme", role: "editor", handoff: false, createdAtMs: 1_000)
    let newer = PendingInvite(id: "i2", orgID: "o2", orgName: "North", role: "admin", handoff: false, createdAtMs: 2_000)
    let auto = join([older, newer], calls)
    let joined = await auto.run(impersonating: false)
    XCTAssertEqual(joined, ["o2", "o1"], "both join, newest first")
    XCTAssertEqual(auto.opens, "o2")
    XCTAssertEqual(auto.invites.map(\.id), ["i2", "i1"])
  }

  func testARefusedNewestOpensNothing() async {
    let calls = Calls()
    calls.refuse = ["i2"]
    let older = PendingInvite(id: "i1", orgID: "o1", orgName: "Acme", role: "editor", handoff: false, createdAtMs: 1_000)
    let newer = PendingInvite(id: "i2", orgID: "o2", orgName: "North", role: "admin", handoff: false, createdAtMs: 2_000)
    let auto = join([older, newer], calls)
    let joined = await auto.run(impersonating: false)
    XCTAssertEqual(joined, ["o1"])
    XCTAssertNil(auto.opens, "an older invitation joins where the person stands")
  }

  /// First-run provisioning reads this so the gap after a join never looks like no invitation and no workspace.
  func testJoiningOrJoinedHoldsProvisioningAndARefusalDoesNot() async {
    let calls = Calls()
    let auto = join([acme], calls)
    XCTAssertFalse(auto.joinedOrJoining)
    _ = await auto.run(impersonating: false)
    XCTAssertTrue(auto.joinedOrJoining)

    let refused = Calls()
    refused.refuse = ["i1"]
    let waiting = join([acme], refused)
    _ = await waiting.run(impersonating: false)
    XCTAssertFalse(waiting.joinedOrJoining, "a refused join is no reason to hold the workspace back")
  }

  func testASupportSessionNeverJoinsForTheCustomer() async {
    let calls = Calls()
    let auto = join([acme], calls)
    let joined = await auto.run(impersonating: true)
    XCTAssertEqual(joined, [])
    XCTAssertTrue(calls.accepted.isEmpty)
  }
}
