// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynFunnelsPlugin

private let fixtureInventory = FunnelInventory(
  forms: [FunnelInventoryItem(id: "f1", name: "Contact")], overlays: [], pages: ["/", "/pricing"], products: [],
  services: [FunnelInventoryItem(id: "s1", name: "Intro call")])

private final class FakeAPI: FunnelsAPI, @unchecked Sendable {
  var calls: [String] = []
  var saved: [FunnelDefinition] = []
  var failure: Error?
  var recordingChanged = false
  var proposal = FunnelProposal(
    draft: FunnelDefinition(
      name: "Idea",
      steps: [FunnelStep(key: "/pricing", match: .exact, type: .page), FunnelStep(key: "s1", type: .booking)]),
    dropped: ["No page at /nope"])

  private func check() throws { if let failure { throw failure } }
  func inventory() async throws -> FunnelInventory {
    calls.append("inventory")
    try check()
    return fixtureInventory
  }
  func result(funnelID: String, from: String, to: String, fresh: Bool) async throws -> FunnelResult {
    calls.append("result \(funnelID) \(from) \(to) \(fresh)")
    throw ConsoleAPIError(status: 0, message: "unused")
  }
  func save(_ funnel: FunnelDefinition, funnelID: String?) async throws -> FunnelSaved {
    calls.append("save \(funnelID ?? "nil")")
    try check()
    saved.append(funnel)
    return FunnelSaved(funnelID: funnelID ?? "new1", recordingChanged: recordingChanged)
  }
  func activate(_ funnelID: String) async throws -> FunnelSaved {
    calls.append("activate \(funnelID)")
    return FunnelSaved(funnelID: funnelID, recordingChanged: recordingChanged)
  }
  func delete(_ funnelID: String) async throws -> FunnelSaved {
    calls.append("delete \(funnelID)")
    return FunnelSaved(funnelID: funnelID, recordingChanged: recordingChanged)
  }
  func propose(_ brief: String) async throws -> FunnelProposal {
    calls.append("propose \(brief)")
    try check()
    return proposal
  }
  func draftDropOff(funnelID: String, step: Int, afterHours: Int, action: DropOffAction) async throws -> DropOffDrafted {
    calls.append("act \(funnelID) \(step) \(afterHours) \(action.rawValue)")
    return DropOffDrafted(automationID: "a1", name: "Follow up: Signup step 1", replayed: false)
  }
  func announceSiteWide() async { calls.append("announce") }
}

@MainActor
final class FunnelsTests: XCTestCase {
  private func row(_ id: String = "fn1", draft: Bool = false) -> FunnelRow {
    FunnelRow(
      id: id,
      definition: FunnelDefinition(
        name: "Signup", steps: [FunnelStep(key: "/pricing", match: .exact, type: .page), FunnelStep(key: "f1", type: .form)]),
      draft: draft)
  }

  func testAStoredFunnelReadsAsTheCardReadsIt() {
    let doc = FirestoreDocument(
      id: "fn1",
      data: [
        "name": "Signup", "status": "draft", "createdAt": Date(),
        "steps": [["type": "page", "key": "/pricing", "match": "prefix"], ["type": "form", "key": "f1", "label": "Contact"]],
      ])
    let parsed = FunnelRow(doc)
    XCTAssertEqual(parsed?.draft, true)
    XCTAssertEqual(parsed?.steps.count, 2)
    XCTAssertEqual(parsed?.steps.first?.match, .prefix)
  }

  func testADocumentThatIsNotAValidFunnelIsDropped() {
    let one = FirestoreDocument(id: "a", data: ["name": "One", "steps": [["type": "page", "key": "/"]]])
    let future = FirestoreDocument(
      id: "b", data: ["name": "Future", "steps": [["type": "page", "key": "/"], ["type": "hologram", "key": "x"]]])
    XCTAssertNil(FunnelRow(one))
    XCTAssertNil(FunnelRow(future))
  }

  func testFunnelsListByNameWithoutCase() {
    let a = FunnelRow(id: "1", definition: FunnelDefinition(name: "beta", steps: row().steps))
    let b = FunnelRow(id: "2", definition: FunnelDefinition(name: "Alpha", steps: row().steps))
    XCTAssertEqual(HostFunnels.inListOrder([a, b]).map(\.name), ["Alpha", "beta"])
  }

  func testARangeEndsTodayInUTCDays() {
    let now = 1_791_460_800_000  // 2026-10-08T12:00:00Z
    XCTAssertEqual(recentRange(days: 7, nowMs: now).from, "2026-10-02")
    XCTAssertEqual(recentRange(days: 7, nowMs: now).to, "2026-10-08")
    XCTAssertEqual(recentRange(days: 90, nowMs: now).from, "2026-07-11")
  }

  func testAccessFollowsTheRoleAndThePaidTier() {
    let pro: [String: Any] = ["plan": "pro"]
    XCTAssertTrue(FunnelsAccessState(role: "admin", org: pro, orgReady: true).canManage)
    XCTAssertTrue(FunnelsAccessState(role: "editor", org: pro, orgReady: true).entitled)
    XCTAssertFalse(FunnelsAccessState(role: "author", org: pro, orgReady: true).canManage)
    XCTAssertFalse(FunnelsAccessState(role: "admin", org: ["plan": "starter"], orgReady: true).entitled)
    XCTAssertFalse(FunnelsAccessState(role: "admin", org: pro, orgReady: false).entitled)
  }

  func testANewFunnelOpensOnTheSitesFirstPageThenAnyForm() async {
    let editor = FunnelsEditor(api: FakeAPI())
    await editor.add()
    XCTAssertEqual(editor.draft?.steps.map(\.type), [.page, .form])
    XCTAssertEqual(editor.draft?.steps[0].key, "/")
    XCTAssertEqual(editor.draft?.steps[1].key, "")
  }

  func testASaveMakesTheConsolesChecksThenSavesLabelledSteps() async {
    let api = FakeAPI()
    api.recordingChanged = true
    let editor = FunnelsEditor(api: api)
    await editor.add()
    editor.draft?.name = " Signup "
    editor.draft?.steps = [StepDraft(type: .page, key: "pricing/"), StepDraft(type: .form, key: "f1")]
    await editor.save()
    XCTAssertEqual(api.calls, ["inventory", "save nil", "announce"])
    XCTAssertEqual(api.saved.first?.name, "Signup")
    XCTAssertEqual(api.saved.first?.steps[0].key, "/pricing")
    XCTAssertEqual(api.saved.first?.steps[1].label, "Contact")
    XCTAssertNil(editor.draft)
    XCTAssertEqual(editor.notice, "Signup saved.")
  }

  func testAStepTheSiteDoesNotHaveStopsTheSaveInTheCardsWords() async {
    let api = FakeAPI()
    let editor = FunnelsEditor(api: api)
    await editor.add()
    editor.draft?.name = "Signup"
    editor.draft?.steps = [StepDraft(type: .page, key: "/pricing"), StepDraft(type: .page, key: "/gone")]
    await editor.save()
    XCTAssertEqual(editor.error, "Step 2: This site has no page at /gone.")
    XCTAssertFalse(api.calls.contains { $0.hasPrefix("save") })
    XCTAssertNotNil(editor.draft)
  }

  func testADraftWithTooFewStepsIsRefusedBeforeAnyCall() async {
    let api = FakeAPI()
    let editor = FunnelsEditor(api: api)
    await editor.edit(row())
    editor.draft?.steps = [StepDraft(type: .page, key: "/")]
    await editor.save()
    XCTAssertEqual(editor.error, "A funnel has 2 to 8 steps.")
    XCTAssertEqual(api.calls, ["inventory"])
  }

  func testAnEditKeepsTheFunnelsID() async {
    let api = FakeAPI()
    let editor = FunnelsEditor(api: api)
    await editor.edit(row("fn9"))
    await editor.save()
    XCTAssertTrue(api.calls.contains("save fn9"))
  }

  func testARefusalFromTheDoorKeepsTheEditorOpenInItsWords() async {
    let api = FakeAPI()
    let editor = FunnelsEditor(api: api)
    await editor.edit(row())
    api.failure = ConsoleAPIError(status: 403, message: "A site admin or editor changes what a site measures.")
    await editor.save()
    XCTAssertEqual(editor.error, "A site admin or editor changes what a site measures.")
    XCTAssertNotNil(editor.draft)
  }

  func testActivatingADraftSaysItIsMeasuredAndAnnouncesARecordingChange() async {
    let api = FakeAPI()
    api.recordingChanged = true
    let editor = FunnelsEditor(api: api)
    await editor.activate(row(draft: true))
    XCTAssertEqual(api.calls, ["activate fn1", "announce"])
    XCTAssertEqual(editor.notice, "Signup is live. It is measured from now on.")
  }

  func testDeleteAsksFirstThenRemoves() async {
    let api = FakeAPI()
    let editor = FunnelsEditor(api: api)
    editor.askDelete(row())
    XCTAssertEqual(editor.deleting?.id, "fn1")
    await editor.confirmDelete()
    XCTAssertEqual(api.calls, ["delete fn1"])
    XCTAssertNil(editor.deleting)
  }

  func testCreateWithAIOpensTheEditorOnTheProposalAndNamesWhatItLeftOut() async {
    let api = FakeAPI()
    let editor = FunnelsEditor(api: api)
    editor.askPropose()
    await editor.propose("   ")
    XCTAssertEqual(editor.error, "Describe the funnel first.")
    await editor.propose("pricing then a call")
    XCTAssertFalse(editor.proposing)
    XCTAssertEqual(editor.draft?.name, "Idea")
    XCTAssertNil(editor.draft?.id)
    XCTAssertEqual(editor.notice, "Left out, because the site has no match: No page at /nope")
  }

  func testActOnADropOffDraftsTheAutomationSwitchedOff() async {
    let api = FakeAPI()
    let editor = FunnelsEditor(api: api)
    editor.askDropOff(DropOffRequest(funnelID: "fn1", reachedStep: 1, stepLabel: "a", nextStepLabel: "b"))
    await editor.draftDropOff(afterHours: 24, action: .task)
    XCTAssertEqual(api.calls, ["act fn1 1 24 task"])
    XCTAssertNil(editor.dropOff)
    XCTAssertEqual(editor.notice, "Follow up: Signup step 1 is drafted, switched off. Switch it on under Automation when it reads right.")
  }

  func testTheWaitsTheCardOffers() {
    XCTAssertEqual(dropOffWaits(), [1, 24, 72, 168])
  }
}
