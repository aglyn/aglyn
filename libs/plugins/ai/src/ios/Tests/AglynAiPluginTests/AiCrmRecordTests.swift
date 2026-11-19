// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynAiPlugin

/// The AI summary on a CRM record (AGL-2917): the console's `ai-crm.ts` and `ai-crm-record-card.component.tsx`.
final class AiCrmRecordTests: XCTestCase {
  func testAnAnswerReadsAsTheConsoleReadsIt() {
    let raw: JSONValue = .object([
      "kind": "record", "record": .object(["kind": "contact", "id": "c-1"]), "summary": "Dana asked for a quote.", "standing": "Warm",
      "asOf": "2026-11-16",
      "nextStep": .object(["title": "Send the quote", "kind": "email", "priority": "high", "dueInDays": .number(2), "reason": "She asked."]),
      "stage": .object(["stageId": "s-2", "stageName": "Proposal", "reason": "A quote is out."]),
    ])
    let proposal = AiCrmRecordProposal(raw)
    XCTAssertEqual(proposal?.summary, "Dana asked for a quote.")
    XCTAssertEqual(proposal?.nextStep.map(aiCrmNextStepLine), "Send the quote (Email, high priority, due in 2 days)")
    XCTAssertEqual(proposal?.stage?.id, "s-2")
    // An email or a mapping, or a record kind the CRM does not have, is not a summary.
    XCTAssertNil(AiCrmRecordProposal(.object(["kind": "email", "record": .object(["kind": "contact", "id": "c"]), "subject": "s", "body": "b"])))
    XCTAssertNil(AiCrmRecordProposal(.object(["kind": "record", "record": .object(["kind": "ticket", "id": "c"]), "summary": "s"])))
  }

  func testDueWords() {
    XCTAssertEqual(aiCrmDueWords(0), "due today")
    XCTAssertEqual(aiCrmDueWords(1), "due tomorrow")
    XCTAssertEqual(aiCrmDueWords(5), "due in 5 days")
    XCTAssertEqual(aiCrmTaskKindWords("todo"), "To-do")
  }

  func testAJobAnswersOnlyItsOwnRecord() {
    let job: JSONValue = .object([
      "kind": "crm",
      "outputs": .array([.object(["resource": "crm", "proposal": .object(["kind": "record", "record": .object(["kind": "deal", "id": "d-1"])])])]),
    ])
    XCTAssertTrue(aiCrmJobAnswersRecord(job, kind: "deal", id: "d-1"))
    XCTAssertFalse(aiCrmJobAnswersRecord(job, kind: "deal", id: "d-2"))
    XCTAssertFalse(aiCrmJobAnswersRecord(job, kind: "contact", id: "d-1"))
    XCTAssertFalse(aiCrmJobAnswersRecord(.object(["kind": "seo"]), kind: "deal", id: "d-1"))
  }
}
