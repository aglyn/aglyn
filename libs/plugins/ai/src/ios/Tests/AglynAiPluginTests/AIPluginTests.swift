// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynAiPlugin

final class AIPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares, and its links resolve.
  @MainActor
  func testRegistersItsDeclaredScreensAndLinks() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(
      screens: [
        "ai.allotment", "ai.credits", "ai.hostMember", "ai.job", "ai.jobs", "ai.member", "ai.signals", "ai.staffOrg", "ai.staffUser",
      ],
      widgets: ["ai.seo-start", "ai.site-memory"],
      quickActions: ["ai.open"],
      deepLinks: ["ai.job.link", "ai.jobs.link", "ai.signals.link"])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "ai", contributes: declared, register: registerAINative)], into: registry)
    XCTAssertEqual(result.failed, [])
    // What it adds to Setup → SEO and Business profile is in those pages' slots, and never on Home.
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "hostSeo").map(\.id), ["ai.seo-start"])
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "hostBusinessProfile").map(\.id), ["ai.site-memory"])
    XCTAssertEqual(registry.widgets(for: .aglyn).map(\.id), [])
    if case .screen(let screen, let params)? = registry.resolve("/acme/hosts/shop/ai-jobs/j1") {
      XCTAssertEqual(screen, "ai.job")
      XCTAssertEqual(params["jobId"], "j1")
    } else {
      XCTFail("an AI job link did not open the job")
    }
  }

  func testAStoredPreferenceIsReadAsTheConsoleReadsIt() {
    let read = aiSitePreferenceOf(id: "tone-casual", raw: ["text": "  Prefers a casual tone  ", "count": 3, "lastSeenAtMs": 1_700_000_000_000.0])
    XCTAssertEqual(read, AiSitePreference(id: "tone-casual", text: "Prefers a casual tone", count: 3, lastSeenAtMs: 1_700_000_000_000))
    XCTAssertEqual(aiSitePreferenceOf(id: "a", raw: ["text": String(repeating: "x", count: 200)])?.text.count, 120)
    // A count that is not a positive number is one edit; a missing time is the epoch.
    XCTAssertEqual(aiSitePreferenceOf(id: "a", raw: ["text": "t", "count": 0])?.count, 1)
    XCTAssertEqual(aiSitePreferenceOf(id: "a", raw: ["text": "t", "count": "many"])?.count, 1)
    XCTAssertEqual(aiSitePreferenceOf(id: "a", raw: ["text": "t", "count": 2.7])?.count, 2)
    XCTAssertEqual(aiSitePreferenceOf(id: "a", raw: ["text": "t"])?.lastSeenAtMs, 0)
    // A row with no words, or none at all, is not a preference.
    XCTAssertNil(aiSitePreferenceOf(id: "a", raw: ["text": "   "]))
    XCTAssertNil(aiSitePreferenceOf(id: "a", raw: nil))
    XCTAssertEqual(aiSitePreferenceSeen(1), "Seen in 1 applied edit")
    XCTAssertEqual(aiSitePreferenceSeen(4), "Seen in 4 applied edits")
  }

  func testPreferencesListMostRepeatedThenMostRecent() {
    func doc(_ id: String, _ data: [String: Any]) -> FirestoreDocument { FirestoreDocument(id: id, data: data) }
    let rows = [
      doc("a", ["text": "A", "count": 1, "lastSeenAtMs": 5]), doc("b", ["text": "B", "count": 3, "lastSeenAtMs": 1]),
      doc("c", ["text": "C", "count": 1, "lastSeenAtMs": 9]), doc("d", ["count": 9]),
    ]
    XCTAssertEqual(aiSitePreferences(rows).map(\.id), ["b", "c", "a"])
  }

  private func json(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

  func testTheLatestGuidedStartListingIsFoundForThisSite() {
    let jobs = json(
      """
      {"jobs":[
        {"id":"j3","kind":"seo","hostId":"h1","outputs":[]},
        {"id":"j2","kind":"site","hostId":"other","outputs":[{"resource":"seo","proposal":{"kind":"site-listing","values":{"seo.title":"Other","seo.description":"Other site"}}}]},
        {"id":"j1","kind":"site","hostId":"h1","outputs":[
          {"resource":"page","proposal":{}},
          {"resource":"seo","proposal":{"kind":"site-listing","values":{"seo.title":"Hair by Ana","seo.description":"Cuts and color in Austin."},"notes":["Written from your answers."]}}]},
        {"id":"j0","kind":"site","hostId":"h1","outputs":[{"resource":"seo","proposal":{"kind":"site-listing","values":{"seo.title":"Old","seo.description":"Older"}}}]}
      ]}
      """)
    let found = aiLatestSiteListing(jobs, hostID: "h1")
    XCTAssertEqual(found?.jobID, "j1")
    XCTAssertEqual(found?.proposal, AiSiteSeoProposal(title: "Hair by Ana", description: "Cuts and color in Austin.", notes: ["Written from your answers."]))
    XCTAssertEqual(found?.proposal.values, ["seo.title": "Hair by Ana", "seo.description": "Cuts and color in Austin."])
    XCTAssertNil(aiLatestSiteListing(jobs, hostID: "nobody"))
    XCTAssertNil(aiLatestSiteListing(nil, hostID: "h1"))
  }

  func testAProposalWithoutTwoWordsIsNoProposal() {
    func outputs(_ values: String) -> JSONValue {
      json(#"[{"resource":"seo","proposal":{"kind":"site-listing","values":\#(values)}}]"#)
    }
    XCTAssertNil(aiSiteSeoProposalOf(outputs(#"{"seo.title":"T"}"#)))
    XCTAssertNil(aiSiteSeoProposalOf(outputs(#"{"seo.title":"T","seo.description":"  "}"#)))
    XCTAssertNil(aiSiteSeoProposalOf(outputs(#"{"seo.title":1,"seo.description":"D"}"#)))
    XCTAssertEqual(aiSiteSeoProposalOf(outputs(#"{"seo.title":"T","seo.description":"D"}"#))?.title, "T")
  }

  func testAListingTheSettingsAlreadySayIsNotOfferedAgain() {
    let proposal = AiSiteSeoProposal(title: "Hair by Ana", description: "Cuts and color.", notes: [])
    XCTAssertTrue(aiSiteSeoAlreadySaid(proposal, seo: ["title": " Hair by Ana ", "description": "Cuts and color."]))
    // One of two matching still leaves something to take.
    XCTAssertFalse(aiSiteSeoAlreadySaid(proposal, seo: ["title": "Hair by Ana", "description": "Rewritten"]))
    XCTAssertFalse(aiSiteSeoAlreadySaid(proposal, seo: nil))
  }
}
