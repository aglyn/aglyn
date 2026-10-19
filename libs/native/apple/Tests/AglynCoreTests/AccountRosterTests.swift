// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Add account (AGL-3945): who is signed in where on the device, and whose a tapped push is.
final class AccountRosterTests: XCTestCase {
  private let base = SignedInAccount(slot: SignedInAccount.baseSlot, uid: "u1", email: "a@example.test", displayName: "Ann Lee", orgIDs: ["o1"])
  private let added = SignedInAccount(slot: "s2", uid: "u2", email: "b@example.test", displayName: nil, orgIDs: ["o2"])

  func testTheAppsOwnAccountStaysFirstAndARepeatKeepsItsPlace() {
    var roster = AccountRosterRules.upsert(added, into: [])
    roster = AccountRosterRules.upsert(base, into: roster)
    XCTAssertEqual(roster.map(\.slot), ["base", "s2"])
    var renamed = added
    renamed.displayName = "Bo"
    renamed.orgIDs = []
    roster = AccountRosterRules.upsert(renamed, into: roster)
    XCTAssertEqual(roster.map(\.slot), ["base", "s2"])
    XCTAssertEqual(roster.last?.displayName, "Bo")
    XCTAssertEqual(roster.last?.orgIDs, ["o2"], "an update that knows no workspaces keeps the ones remembered")
  }

  func testSigningOneOutKeepsTheOthers() {
    let roster = AccountRosterRules.remove(slot: "base", from: [base, added])
    XCTAssertEqual(roster.map(\.slot), ["s2"])
  }

  func testATappedPushFindsTheAccountThatHoldsItsWorkspace() {
    XCTAssertEqual(AccountRosterRules.owner(ofOrg: "o2", in: [base, added], activeSlot: "base")?.slot, "s2")
    XCTAssertNil(AccountRosterRules.owner(ofOrg: "o1", in: [base, added], activeSlot: "base"), "the account in use holds it")
    XCTAssertNil(AccountRosterRules.owner(ofOrg: "o9", in: [base, added], activeSlot: "base"))
  }

  func testInitialsComeFromTheNameElseTheAddress() {
    XCTAssertEqual(accountInitials(name: "Zach Gover", email: nil), "ZG")
    XCTAssertEqual(accountInitials(name: "", email: "zach@example.test"), "Z")
    XCTAssertEqual(accountInitials(name: nil, email: nil), "?")
  }

  func testTheRosterIsKeptPerProject() {
    let defaults = UserDefaults(suiteName: "roster-tests")!
    defaults.removePersistentDomain(forName: "roster-tests")
    let storage = AccountRosterStorage(projectID: "demo-a", defaults: defaults)
    storage.save([base, added])
    storage.activeSlot = "s2"
    XCTAssertEqual(storage.load(), [base, added])
    XCTAssertEqual(AccountRosterStorage(projectID: "demo-b", defaults: defaults).load(), [])
    XCTAssertEqual(storage.activeSlot, "s2")
  }
}
