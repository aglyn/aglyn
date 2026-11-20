// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The picker's Plan, Your role and Pinned filters (the console's WORKSPACE_FILTER_FIELDS).
final class WorkspacePickerFilterTests: XCTestCase {
  func testEachFilterIsAnExactMatch() {
    let acme = WorkspaceOrg(id: "a", name: "Acme", slug: "acme", role: "owner")
    XCTAssertTrue(WorkspacePickerFilter().admits(acme, plan: nil, pinned: false))
    XCTAssertTrue(WorkspacePickerFilter(plan: "pro").admits(acme, plan: "pro", pinned: false))
    XCTAssertFalse(WorkspacePickerFilter(plan: "pro").admits(acme, plan: nil, pinned: false), "a plan not yet read is no match")
    XCTAssertFalse(WorkspacePickerFilter(role: "admin").admits(acme, plan: "pro", pinned: false))
    XCTAssertTrue(WorkspacePickerFilter(role: "owner", pinned: true).admits(acme, plan: "pro", pinned: true))
    XCTAssertFalse(WorkspacePickerFilter(pinned: false).admits(acme, plan: "pro", pinned: true))
    XCTAssertEqual(WorkspacePickerFilter(plan: "pro", pinned: true).count, 2)
    XCTAssertEqual(WorkspacePickerFilter.plans.first?.label, "Free")
    XCTAssertEqual(WorkspacePickerFilter.plans.last?.value, "enterprise")
  }
}
