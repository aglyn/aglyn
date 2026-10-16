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
        "ai.allotment", "ai.credits", "ai.hostMember", "ai.import.productCopy", "ai.job", "ai.jobs", "ai.member", "ai.orgsSpendColumn", "ai.request",
        "ai.requests", "ai.signals", "ai.staffOrg", "ai.staffRequests", "ai.staffUser",
      ],
      widgets: ["ai.seo-audit", "ai.seo-start", "ai.site-memory"],
      quickActions: ["ai.open"],
      deepLinks: ["ai.job.link", "ai.jobs.link", "ai.signals.link"])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "ai", contributes: declared, register: registerAINative)], into: registry)
    XCTAssertEqual(result.failed, [])
    // What it adds to Setup → SEO and Business profile is in those pages' slots, and never on Home.
    XCTAssertEqual(registry.widgets(for: .aglyn, slot: "hostSeo").map(\.id), ["ai.seo-audit", "ai.seo-start"])
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

  private let auditJobs = """
    {"jobs":[
      {"id":"s2","kind":"seo","hostId":"other","status":"done","outputs":[{"resource":"seo","proposal":{"kind":"audit","pages":[],"queue":[],"batchSize":3,"siteProposal":false}}]},
      {"id":"s1","kind":"seo","hostId":"h1","status":"running","creditsSpent":4,"outputs":[
        {"resource":"seo","proposal":{"kind":"audit","pages":[
          {"screenId":"p1","name":"Home","path":"/","versionId":"v1"},
          {"screenId":"p2","name":"About","path":"/about","versionId":null},
          {"screenId":"p3","name":"Menu","path":"/menu","versionId":"v3"}],"queue":["p1","p2","p3"],"batchSize":2,"siteProposal":true}},
        {"resource":"seo","proposal":{"kind":"fixes","batch":1,"fixes":[
          {"screenId":"p1","values":{"title":"Home | Joe","description":"Fresh bread."},"content":[{"kind":"image-alt","nodeId":"a","alt":"Loaf"},{"kind":"image-alt","nodeId":"b","alt":"Oven"},{"kind":"h1-insert","text":"Joe's"}],"guidance":["Add a link to About."]},
          {"screenId":"p2","values":{},"content":[],"guidance":[]}]}},
        {"resource":"seo","proposal":{"kind":"site","site":{"values":{"seo.entity.type":"1","seo.agent.whenToUse":"Order bread."},"llmsPreview":"# Joe","notes":["From your pages."]}}},
        {"resource":"page","proposal":{"kind":"audit"}}
      ]}
    ]}
    """

  func testAnAuditIsPutBackTogetherFromAJobsOutputs() throws {
    let found = try XCTUnwrap(aiLatestSeoAudit(json(auditJobs), hostID: "h1"))
    XCTAssertEqual(found.job["id"]?.stringValue, "s1")
    let view = found.view
    XCTAssertEqual(view.pages.map(\.screenID), ["p1", "p2", "p3"])
    XCTAssertNil(view.pages[1].versionID)
    XCTAssertEqual(view.batches, 1)
    // Two pages a batch, three queued: two batches are owed and one is in, so the audit is not complete.
    XCTAssertEqual(view.owedBatches, 2)
    XCTAssertFalse(view.complete)
    XCTAssertEqual(view.fixOrder, ["p1", "p2"])
    XCTAssertEqual(view.site?.llmsPreview, "# Joe")
    XCTAssertEqual(aiSeoApplyCounts(view).pagesWithContent, 1)
    XCTAssertEqual(aiSeoApplyCounts(view).pagesWithValues, 1)
    XCTAssertEqual(aiSeoFixSummary(view.fixes["p1"]), "Title: Home | Joe · Description: Fresh bread. · 2 image descriptions · One main heading · Add a link to About.")
    XCTAssertEqual(aiSeoFixSummary(view.fixes["p2"]), "")
    XCTAssertEqual(aiSeoFixSummary(nil), "")
    XCTAssertNil(aiLatestSeoAudit(json(auditJobs), hostID: "nobody"))
  }

  func testAFinishedAuditIsCompleteOnlyWithEveryBatchAndTheSiteProposal() {
    func view(_ batches: Int, site: Bool) -> AiSeoAuditView {
      AiSeoAuditView(
        pages: [], queue: ["a", "b", "c"], batchSize: 2, siteProposal: true, fixes: [:], fixOrder: [],
        site: site ? AiSeoSiteProposal(values: [:], llmsPreview: "", notes: []) : nil, batches: batches)
    }
    XCTAssertFalse(view(2, site: false).complete)
    XCTAssertFalse(view(1, site: true).complete)
    XCTAssertTrue(view(2, site: true).complete)
    XCTAssertTrue(AiSeoAuditView(pages: [], queue: [], batchSize: 2, siteProposal: false, fixes: [:], fixOrder: [], site: nil, batches: 0).complete)
  }

  func testTheAppliedAnswerIsReadForItsDraftsAndWhatWasSkipped() {
    let result = aiSeoApplyResultOf(
      json(#"{"job":{},"versions":[{"screenId":"p1","versionId":"v9","name":"Home","fixes":3},{"screenId":"x"}],"staged":["p1","p2"],"skipped":[{"screenId":"p3","reason":"Already has a draft"}]}"#))
    XCTAssertEqual(result.versions, [AiSeoApplyResult.AppliedVersion(screenID: "p1", versionID: "v9", name: "Home")])
    XCTAssertEqual(result.staged, ["p1", "p2"])
    XCTAssertEqual(result.skipped.map { [$0.screenID, $0.reason] }, [["p3", "Already has a draft"]])
    XCTAssertEqual(aiSeoApplyResultOf(nil).versions, [])
  }

  func testAJobEndsOnADoneFailedOrCanceledStatus() {
    func job(_ status: String) -> JSONValue { json(#"{"id":"j","status":"\#(status)"}"#) }
    XCTAssertEqual(["done", "failed", "canceled", "running", "queued"].map { aiJobIsTerminal(job($0)) }, [true, true, true, false, false])
    let jobs = json(#"{"jobs":[{"id":"a"},{"id":"b"}]}"#)
    XCTAssertEqual(aiJobByID(jobs, "b")?["id"]?.stringValue, "b")
    XCTAssertNil(aiJobByID(jobs, "c"))
  }
}
