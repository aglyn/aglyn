// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynDataPlugin

final class DatasetAccessTests: XCTestCase {
  private let writer = ["data.manage": true, "org.eraseRecords": true, "data.viewRecords": true, "data.export": true]

  private func site(_ role: String?, stamp: [String: Bool] = [:]) -> [String: Any] {
    ["memberRoles": role.map { ["u": $0] } ?? [:], "memberPermissions": ["u": stamp]]
  }

  func testOnePlacementIsOneHostToken() {
    XCTAssertEqual(oneSitePlacement(["host:h1"]), "h1")
    XCTAssertNil(oneSitePlacement(["host:h1", "host:h2"]))
    XCTAssertNil(oneSitePlacement(["org:*"]))
    XCTAssertNil(oneSitePlacement(nil))
  }

  func testEverySiteAnswersToTheWorkspaceKey() {
    XCTAssertTrue(datasetAccess(workspace: writer, orgWide: true, orgRole: "editor", visibleTo: ["org:*"], site: nil, uid: "u").canWrite)
    XCTAssertEqual(
      datasetAccess(workspace: [:], orgWide: true, orgRole: "viewer", visibleTo: ["org:*"], site: nil, uid: "u").writeRefusal,
      "Your role does not include \"Manage data\" — ask an organization admin")
  }

  func testASiteNarrowsAWorkspaceWriterButSharingStaysTheirs() {
    let access = datasetAccess(
      workspace: writer, orgWide: true, orgRole: "editor", visibleTo: ["host:h1"],
      site: site("viewer", stamp: ["data.siteManage": false]), uid: "u")
    XCTAssertFalse(access.canWrite)
    XCTAssertTrue(access.sharingOnly)
    XCTAssertTrue(access.writeRefusal.contains("Manage this site"))
  }

  func testASiteRaisesAViewer() {
    XCTAssertTrue(
      datasetAccess(
        workspace: [:], orgWide: true, orgRole: "viewer", visibleTo: ["host:h1"],
        site: site("editor", stamp: ["data.siteManage": true]), uid: "u"
      ).canWrite)
  }

  func testASiteMemberCannotDeleteWhatIsSharedBeyondOneSite() {
    let access = datasetAccess(
      workspace: writer, orgWide: false, orgRole: "editor", visibleTo: ["host:h1", "host:h2"], site: nil, uid: "u")
    XCTAssertFalse(access.canDelete)
    XCTAssertTrue(access.deleteRefusal.hasPrefix("This dataset is shared beyond one site"))
  }

  func testReadsAndExportsAskTheirOwnKeys() {
    let access = datasetAccess(
      workspace: ["data.viewRecords": false, "data.export": false], orgWide: true, orgRole: "viewer", visibleTo: ["org:*"],
      site: nil, uid: "u")
    XCTAssertFalse(access.canRead)
    XCTAssertFalse(access.canExport)
  }
}
