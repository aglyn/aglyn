// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynInboxPlugin

/// The console's own answers, recorded by `generate-native-contracts.mjs`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  // Tests/AglynInboxPluginTests/InboxTests.swift → libs/plugins/inbox/src/ios → libs
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func entries(_ value: Any?) -> [(String, Any?)] {
  let map = value as? [String: Any] ?? [:]
  return map.keys.sorted().map { ($0, map[$0]) }
}

final class InboxTests: XCTestCase {
  func testMessageSenderAnswersAsTheConsoleDoes() throws {
    for (index, item) in try functionCases("messageSender").enumerated() {
      let sender = messageSender(entries(item.args.first).map { (key: $0.0, value: $0.1) })
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(sender.name, expected["name"] as? String, "case \(index)")
      XCTAssertEqual(sender.email, expected["email"] as? String, "case \(index)")
    }
  }

  func testSubmissionSenderAnswersAsTheConsoleDoes() throws {
    for (index, item) in try functionCases("submissionSender").enumerated() {
      let fields = entries(item.args.first)
      let sender = item.args.count > 1 ? submissionSender(fields, fallback: item.args[1] as! String) : submissionSender(fields)
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(sender.label, expected["label"] as? String, "case \(index)")
      XCTAssertEqual(sender.email, expected["email"] as? String, "case \(index)")
      XCTAssertEqual(sender.initials, expected["initials"] as? String, "case \(index)")
    }
  }

  func testRoutingChipsAnswerAsTheConsoleDoes() throws {
    for (index, item) in try functionCases("routingChips").enumerated() {
      let chips = routingChips(item.args.first as? [String: Any])
      let expected = (item.result as? [[String: Any]] ?? []).map { "\($0["label"] ?? "")|\($0["color"] ?? "")" }
      XCTAssertEqual(chips.map { "\($0.label)|\($0.color.rawValue)" }, expected, "case \(index)")
    }
  }

  func testTheDefaultReplySubjectIsTheConsoles() throws {
    for (index, item) in try functionCases("defaultReplySubject").enumerated() {
      XCTAssertEqual(
        defaultReplySubject(siteName: item.args[0] as? String, formName: item.args[1] as? String), item.result as? String,
        "case \(index)")
    }
  }

  func testTheFormPickIsAClauseAndAFormsOwnListIsItsBase() {
    XCTAssertTrue(submissionsRequest(formID: nil, read: nil, search: "").clauses.isEmpty)
    let picked = submissionsRequest(formID: nil, read: "false", search: " ada ", pickedForm: "form-1")
    XCTAssertEqual(picked.clauses.map { "\($0.field)=\($0.value)" }, ["read=false", "formId=form-1"])
    XCTAssertEqual(picked.search, ["ada"])
    XCTAssertNil(picked.base)
    let scoped = submissionsRequest(formID: "form-2", read: nil, search: "", pickedForm: "form-1")
    XCTAssertTrue(scoped.clauses.isEmpty)
    XCTAssertEqual(scoped.base?.map(\.path), ["formId"])
  }

  func testPermissionsFollowTheSiteRole() {
    XCTAssertEqual(InboxPermissions(role: "admin"), InboxPermissions(canWrite: true, canReply: true))
    XCTAssertEqual(InboxPermissions(role: "author"), InboxPermissions(canWrite: true, canReply: false))
    XCTAssertEqual(InboxPermissions(role: nil), InboxPermissions(canWrite: false, canReply: false))
  }
}
