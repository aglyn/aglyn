// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynCrmPlugin

/// The bar over a CRM list decides what it writes and what it names as the console's bulk bars do.
final class CrmBulkTests: XCTestCase {
  private func row(_ id: String, tags: [String] = [], company: String? = nil, status: String? = nil, converted: Bool = false)
    -> CrmBulkRow
  {
    CrmBulkRow(id: id, label: "\(id)@example.com", tags: tags, companyID: company, status: status, converted: converted)
  }

  func testEachListOffersTheConsolesActsInOrder() {
    XCTAssertEqual(crmBulkActions(.contact, orgLevel: false), [.addTag, .removeTag, .owner, .stage, .company, .removeFromSite])
    // At the workspace's level there is no site to remove a person from.
    XCTAssertEqual(crmBulkActions(.contact, orgLevel: true), [.addTag, .removeTag, .owner, .stage, .company])
    XCTAssertEqual(crmBulkActions(.lead, orgLevel: false), [.owner, .status, .unqualify])
    XCTAssertEqual(crmBulkActions(.company, orgLevel: false), [.addTag, .removeTag, .owner, .delete])
    XCTAssertEqual(crmBulkActions(.deal, orgLevel: false), [.stage, .owner, .lost, .delete])
    XCTAssertEqual(crmBulkTaskActions, [.complete, .assign, .due, .delete])
  }

  func testATagIsNormalizedAsTheConsoleDoes() {
    XCTAssertEqual(crmBulkTag("  VIP Customer "), "vip customer")
    XCTAssertNil(crmBulkTag("   "))
    XCTAssertEqual(crmBulkTag(String(repeating: "a", count: 80))?.count, 60)
  }

  func testAddingATagSkipsHoldersSilentlyAndNamesRowsAtTheCap() {
    let full = (0..<crmBulkTagsCap).map { "t\($0)" }
    let plan = crmBulkPlanAddTag([row("a", tags: ["VIP"]), row("b"), row("c", tags: full)], tag: "vip")
    XCTAssertEqual(plan.rows.map(\.id), ["b"])
    XCTAssertEqual(plan.skipped, [CrmBulkSkip(label: "c@example.com", reason: "already has 20 tags")])
    XCTAssertEqual(crmBulkPlanRemoveTag([row("a", tags: ["VIP"]), row("b")], tag: "vip").rows.map(\.id), ["a"])
  }

  func testSetCompanyLeavesContactsAlreadyFiledThere() {
    let plan = crmBulkPlanSetCompany([row("a", company: "acme"), row("b", company: "other"), row("c")], companyID: "acme")
    XCTAssertEqual(plan.rows.map(\.id), ["b", "c"])
    XCTAssertEqual(crmBulkPlanSetCompany([row("a", company: "acme"), row("c")], companyID: nil).rows.map(\.id), ["a"])
  }

  func testLeadStatusAndUnqualifyNameWhatTheyLeave() {
    let rows = [row("a", status: "new"), row("b", status: "working"), row("c", status: "new", converted: true)]
    let label = leadStatusLabel("working")
    let status = crmBulkPlanLeadStatus(rows, status: "working", label: label)
    XCTAssertEqual(status.rows.map(\.id), ["a"])
    XCTAssertEqual(status.skipped.map(\.reason), ["already \(label)", "was converted"])
    let unqualify = crmBulkPlanUnqualify([row("a", status: "new"), row("b", status: "unqualified"), row("c", converted: true)])
    XCTAssertEqual(unqualify.rows.map(\.id), ["a"])
    XCTAssertEqual(unqualify.skipped.map(\.reason), ["is already closed", "was converted"])
  }

  func testSetStageNeedsOnePipeline() {
    func deal(_ pipeline: String?) -> CrmBulkRow { CrmBulkRow(id: UUID().uuidString, label: "Deal", pipelineID: pipeline) }
    XCTAssertEqual(crmBulkPipeline([deal("p1"), deal("p1")]), .some("p1"))
    XCTAssertEqual(crmBulkPipeline([deal(nil)]), .some(nil))
    XCTAssertNil(crmBulkPipeline([deal("p1"), deal("p2")]) as String??)
  }

  func testSentencesAndReportsReadAsTheConsoles() {
    let contacts = CrmBulkNoun(.contact)
    XCTAssertEqual(crmBulkDoneSentence(.addTag, noun: contacts, count: 1), "Tagged 1 contact")
    XCTAssertEqual(crmBulkDoneSentence(.removeFromSite, noun: contacts, count: 3), "3 contacts removed from this site")
    XCTAssertEqual(crmBulkDoneSentence(.owner, noun: CrmBulkNoun(.lead), count: 2, cleared: true), "Owner cleared on 2 leads")
    XCTAssertEqual(crmBulkDoneSentence(.stage, noun: CrmBulkNoun(.deal), count: 2, named: "Proposal"), "Moved 2 deals to Proposal")
    XCTAssertEqual(crmBulkDoneSentence(.delete, noun: CrmBulkNoun(.company), count: 2), "Deleted 2 companies")
    XCTAssertEqual(crmBulkDoneSentence(.due, noun: .task, count: 1, cleared: true), "Due date cleared on 1 task")
    XCTAssertEqual(crmBulkSentence(CrmBulkOutcome(), attempted: 2) { _ in "" }, "Nothing was changed")
    XCTAssertEqual(crmBulkSentence(CrmBulkOutcome(), attempted: 0) { _ in "" }, "Nothing to change")
    XCTAssertNil(CrmBulkReport([], noun: contacts))
    let one = CrmBulkReport([CrmBulkSkip(label: "a@example.com", reason: "not permitted")], noun: contacts)
    XCTAssertEqual(one?.heading, "One contact was not changed:")
    XCTAssertEqual(one?.lines, ["a@example.com — not permitted"])
    XCTAssertEqual(CrmBulkReport([.init(label: "x", reason: "y"), .init(label: "z", reason: "w")], noun: .task)?.heading, "2 tasks were not changed:")
  }

  func testDestructiveActsAskInTheConsolesWords() {
    XCTAssertEqual(crmBulkConfirm(.delete, noun: CrmBulkNoun(.company), count: 1)?.button, "Delete company")
    XCTAssertEqual(crmBulkConfirm(.delete, noun: CrmBulkNoun(.deal), count: 3)?.title, "Delete 3 deals?")
    XCTAssertEqual(crmBulkConfirm(.removeFromSite, noun: CrmBulkNoun(.contact), count: 2)?.button, "Remove contacts")
    XCTAssertEqual(crmBulkConfirm(.delete, noun: .task, count: 1)?.title, "Delete this task?")
    XCTAssertNil(crmBulkConfirm(.owner, noun: .task, count: 1))
  }

  func testABatchNamesEveryRowItDidNotWrite() async {
    let rows = [row("a"), row("b"), row("c")]
    let outcome = await crmBulkBatch(rows, chunk: 2) { ids in
      ids.contains("a") ? [CrmBulkAnswer(id: "a", ok: true), CrmBulkAnswer(id: "b", ok: false, error: "not on this site")] : []
    }
    XCTAssertEqual(outcome.done, 1)
    XCTAssertEqual(
      outcome.refused,
      [CrmBulkSkip(label: "b@example.com", reason: "not on this site"), CrmBulkSkip(label: "c@example.com", reason: "the write failed")])
    let refusedWhole = await crmBulkBatch(rows) { _ in throw ConsoleAPIError(status: 403, message: "You can't edit contacts here.") }
    XCTAssertEqual(refusedWhole.refused.map(\.reason), Array(repeating: "You can't edit contacts here.", count: 3))
  }

  func testEachRowsRefusalIsNamed() async {
    let outcome = await crmBulkEach([row("a"), row("b")]) { row in
      if row.id == "b" { throw ConsoleAPIError(status: 409, message: "") }
    }
    XCTAssertEqual(outcome, CrmBulkOutcome(done: 1, refused: [CrmBulkSkip(label: "b@example.com", reason: "the write failed")]))
  }

  func testRouteAnswersAreReadPerContact() {
    let answer: JSONValue = .object([
      "results": .array([
        .object(["contactId": .string("a"), "ok": .bool(true)]),
        .object(["contactId": .string("b"), "ok": .bool(false), "error": .string("no longer exists")]),
      ])
    ])
    XCTAssertEqual(crmBulkAnswers(answer), [CrmBulkAnswer(id: "a", ok: true), CrmBulkAnswer(id: "b", ok: false, error: "no longer exists")])
  }

  func testAContactIsWrittenThroughItsHoldersSite() {
    let org: [String: Any] = [
      "hosts": ["s1": true, "s2": true, "s3": true],
      "consentGroups": ["brand": ["name": "Brand", "hostIds": ["s2", "s3"]]],
    ]
    XCTAssertEqual(crmHolderSite("s1", org: org), "s1")
    XCTAssertEqual(crmHolderSite("brand", org: org), "s2")
    XCTAssertNil(crmHolderSite("org", org: org))
    XCTAssertNil(crmHolderSite("", org: org))
  }
}
