// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynInboxPlugin

@MainActor
final class SubmissionsTests: XCTestCase {
  /// Replays the console's own `messageSender` answers (function-cases.generated.json),
  /// as the Kotlin `MessageSenderTest` does.
  func testMessageSenderCases() throws {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // → AglynInboxPluginTests
      .deletingLastPathComponent()  // → Tests
      .deletingLastPathComponent()  // → ios
      .deletingLastPathComponent()  // → src
      .deletingLastPathComponent()  // → inbox
      .deletingLastPathComponent()  // → plugins
      .deletingLastPathComponent()  // → libs
      .appendingPathComponent("native/contracts/function-cases.generated.json")
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let functions = try XCTUnwrap(root["functions"] as? [String: Any])
    let entry = try XCTUnwrap(functions["messageSender"] as? [String: Any])
    let cases = try XCTUnwrap(entry["cases"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty)
    for item in cases {
      let arg = (item["args"] as? [Any])?.first
      let fields = (arg as? [String: Any]).map { object in
        object.sorted { $0.key < $1.key }.map { (key: $0.key, value: $0.value is NSNull ? nil : $0.value as Any?) }
      }
      let expected = item["result"] as? [String: Any] ?? [:]
      let actual = messageSender(fields)
      XCTAssertEqual(actual.name, expected["name"] as? String, "\(String(describing: arg))")
      XCTAssertEqual(actual.email, expected["email"] as? String, "\(String(describing: arg))")
    }
  }

  func testRegistersTheDeclaredIDsAndOpensASubmissionLinkNatively() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [
        NativePluginManifestEntry(
          id: "inbox",
          contributes: [
            "screens": ["inbox.submissions", "inbox.submission", "inbox.people"], "widgets": ["inbox.glance"],
            "quickActions": ["inbox.open", "inbox.people"],
            "deepLinks": ["inbox.page", "inbox.submissions-page", "inbox.people-page"],
          ], register: registerInboxNative)
      ], into: registry)
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(registry.screen("inbox.submissions")?.requiresSite, true)
    XCTAssertEqual(
      registry.resolve("https://app.aglyn.com/acme/hosts/shop/inbox/submissions?submission=s1"),
      .screen("inbox.submissions", ["orgSlug": "acme", "hostSlug": "shop", "submission": "s1"]))
  }

  private func has(_ plan: ListQueryPlan, _ path: String, _ op: ListQueryOp, _ value: ContractJSON) -> Bool {
    plan.filters.contains { $0.path == path && $0.op == op && $0.value == value }
  }

  func testQueriesTheSitesOrOneFormsSubmissionsWithTheReadFilterAndSearch() {
    let site = submissionsPlan(formID: nil, read: nil, search: "")
    XCTAssertTrue(site.filters.isEmpty)
    XCTAssertEqual(site.orderBy.path, "createdAt")
    XCTAssertEqual(site.firestoreQuery(submissionsPath("h")).path, "hosts/h/formSubmissions")
    let unread = submissionsPlan(formID: "contact", read: "false", search: "priya")
    XCTAssertTrue(has(unread, "formId", .equal, .string("contact")))
    XCTAssertTrue(has(unread, "read", .equal, .bool(false)))
    XCTAssertTrue(has(unread, "searchTokens", .arrayContains, .string("priya")))
    XCTAssertEqual(readChoices().map(\.label), ["All", "Unread", "Read"])
  }

  func testExportsWhatTheListShows() {
    XCTAssertEqual(submissionsExportScope(formID: nil, read: nil), ["kind": "all"])
    XCTAssertEqual(
      submissionsExportScope(formID: "contact", read: "true"),
      ["kind": "filter", "filter": ["formId": "contact", "read": true]])
  }

  func testReadsASubmission() {
    let submission = Submission(
      FirestoreDocument(
        id: "s1",
        data: [
          "formId": "contact", "formName": "Contact us", "read": false,
          "fields": ["name": "Priya Shah", "email": "priya@example.com", "message": "Hi there", "budget": NSNumber(value: 1200)],
          "createdAt": Date(timeIntervalSince1970: 1), "capturedRecord": ["kind": "lead"],
        ]))
    XCTAssertEqual(submission.from, "Priya Shah")
    XCTAssertEqual(submission.sender.email, "priya@example.com")
    XCTAssertEqual(submission.preview, "1200 · Hi there")
    XCTAssertEqual(submission.capturedKind, "lead")
    XCTAssertEqual(submission.orderedFields(["message", "name"]).map(\.key), ["message", "name", "budget", "email"])
    XCTAssertTrue(submission.with(read: true).read)
    XCTAssertEqual(Submission(FirestoreDocument(id: "x", data: [:])).from, "Someone")
  }

  func testRepliesThroughTheInboxRoute() {
    let api = SubmissionsAPI(
      api: ConsoleAPIClient(origin: "https://x.test", getIDToken: { _ in "t" }), writer: NoFirestoreWrites(),
      firestore: NoReader(), hostID: "h")
    XCTAssertEqual(
      api.replyBody("s1", subject: "Re: Contact us", message: "Thanks"),
      ["hostId": "h", "submissionId": "s1", "subject": "Re: Contact us", "message": "Thanks"])
  }
}

/// A reader that answers nothing, for the request-shape tests.
final class NoReader: FirestoreReader, @unchecked Sendable {
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  { NoListener() }
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  { NoListener() }
  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}
