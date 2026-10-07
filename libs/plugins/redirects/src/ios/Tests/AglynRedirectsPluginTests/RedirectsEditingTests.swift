// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynRedirectsPlugin

private final class FakeWrites: RedirectsWriteAPI, @unchecked Sendable {
  var answer: RedirectCheck = .ready(source: "/old", destination: "/new", statusCode: 301, kind: "exact", notice: nil)
  var calls: [String] = []
  var fields: [String: Any] = [:]

  func check(_ draft: RedirectDraft) async throws -> RedirectCheck {
    calls.append("check")
    return answer
  }
  func create(_ fields: [String: Any]) async throws {
    calls.append("create")
    self.fields = fields
  }
  func update(_ id: String, _ fields: [String: Any]) async throws {
    calls.append("update:\(id)")
    self.fields = fields
  }
  func setEnabled(_ id: String, _ enabled: Bool) async throws { calls.append("enabled:\(id):\(enabled)") }
  func delete(_ id: String) async throws { calls.append("delete:\(id)") }
  func announce(_ source: String?) async { calls.append("announce:\(source ?? "")") }
}

@MainActor
final class RedirectsEditingTests: XCTestCase {
  private func row(_ id: String = "r1", source: String = "/old", destination: String = "https://example.com") -> RedirectRow {
    RedirectRow(id: id, rule: HostRedirect(destination: destination, enabled: true, source: source, statusCode: 302))
  }

  func testANewRuleIsCheckedCreatedAndAnnounced() async {
    let writes = FakeWrites()
    let editor = RedirectsEditor(api: writes, uid: "u1")
    editor.add()
    editor.draft?.source = "/old"
    editor.draft?.destination = "/new"
    await editor.save()
    XCTAssertEqual(writes.calls, ["check", "create", "announce:/old"])
    XCTAssertNil(editor.draft)
    XCTAssertEqual(writes.fields["statusCode"] as? Int, 301)
    XCTAssertEqual(writes.fields["priority"] as? Int, 100)
    XCTAssertNil(writes.fields["externalDestinationApprovedBy"])
    XCTAssertNotNil(editor.notice)
  }

  func testARefusalKeepsTheSheetOpenWithThePagesWords() async {
    let writes = FakeWrites()
    writes.answer = .refused("That path already redirects.")
    let editor = RedirectsEditor(api: writes, uid: "u1")
    editor.add()
    await editor.save()
    XCTAssertEqual(writes.calls, ["check"])
    XCTAssertNotNil(editor.draft)
    XCTAssertEqual(editor.error, "That path already redirects.")
  }

  func testAnEditStampsOrClearsTheOutsideApprovalAndAnnouncesTheOldSource() async {
    let writes = FakeWrites()
    writes.answer = .ready(source: "/moved", destination: "https://example.com", statusCode: 302, kind: "exact", notice: nil)
    let editor = RedirectsEditor(api: writes, uid: "u1")
    editor.edit(row())
    await editor.save()
    XCTAssertEqual(writes.calls, ["check", "update:r1", "announce:/moved", "announce:/old"])
    XCTAssertEqual(writes.fields["externalDestinationApprovedBy"] as? String, "u1")

    let local = FakeWrites()
    let second = RedirectsEditor(api: local, uid: "u1")
    second.edit(row(destination: "/inside"))
    await second.save()
    XCTAssertEqual(local.fields["externalDestinationApprovedBy"] as? FirestoreSentinel, .delete)
  }

  func testSwitchAndDeleteAreThePagesWrites() async {
    let writes = FakeWrites()
    let editor = RedirectsEditor(api: writes, uid: "u1")
    await editor.toggle(row(), false)
    editor.askDelete(row())
    await editor.confirmDelete()
    XCTAssertEqual(writes.calls, ["enabled:r1:false", "announce:/old", "delete:r1", "announce:/old"])
    XCTAssertNil(editor.deleting)
  }

  func testOnlyASitePathStaysInside() {
    XCTAssertFalse(isExternalRedirectDestination("/new"))
    XCTAssertTrue(isExternalRedirectDestination("//evil.example"))
    XCTAssertTrue(isExternalRedirectDestination("https://example.com"))
  }
}
