// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// Bring my site (AGL-4152) in the apps, as the console's: the start (the address, the proof that it is yours, Keep my
/// site or Improve it, then the read) and the import job's page, where the next wave is started with the choice. Kotlin
/// replays the same cases (ScreenBringMySiteTest).
@MainActor
final class ScreenBringMySiteTests: XCTestCase {
  override func setUp() async throws { ScreenStash.clear() }

  override func tearDown() async throws { ScreenStash.clear() }

  private func screen(_ id: String) throws -> ScreenSpec {
    let url = ScreenSpecTests.screensDir.appendingPathComponent(
      "../../plugins/ai/src/ios/Sources/AglynAiPlugin/Resources/ai.screens.json"
    ).standardizedFileURL
    let file = try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
    return try XCTUnwrap(file["screens"].array.compactMap(ScreenSpec.init).first { $0.id == id })
  }

  private func api(_ transport: HTTPTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
  }

  private func sent(_ transport: RecordingTransport, _ at: Int) throws -> JSONValue {
    try XCTUnwrap(transport.requests[at].httpBody.flatMap(JSONValue.decode))
  }

  private func action(_ screen: ScreenSpec, _ id: String) throws -> ActionSpec {
    for block in screen.blocks {
      if let submit = block["submit"], submit["label"] != nil, block.id == id { return try XCTUnwrap(ActionSpec(submit)) }
      for raw in block["items"].array where raw["id"]?.stringValue == id { return try XCTUnwrap(ActionSpec(raw)) }
    }
    for raw in screen.raw["actions"].array where raw["id"]?.stringValue == id { return try XCTUnwrap(ActionSpec(raw)) }
    return try XCTUnwrap(nil as ActionSpec?, "no action \(id)")
  }

  private func shown(_ screen: ScreenSpec, _ model: ScreenModel) -> [String] {
    screen.blocks.filter { ScreenValues.condition($0.when, in: model.context) }.map { block in
      ScreenValues.render(block.title ?? block["text"]?.stringValue ?? block.raw["id"]?.stringValue ?? block.type, in: model.context)
    }
  }

  private func waves(_ statuses: [String]) -> JSONValue {
    .array(statuses.enumerated().map { index, status in
      let started = status != "waiting"
      let slots: [JSONValue] = index == 0 ? ["p1", "p2", "p3"] : [.string("p\(index + 3)")]
      let record: JSONValue = [
        "index": .number(Double(index)), "label": .string(index == 0 ? "Main pages" : "Blog \(index)"),
        "group": .string(index == 0 ? "main" : "blog"), "slots": .array(slots), "frame": .bool(index == 0),
        "status": .string(status), "startedAt": started ? "2026-11-11T20:00:00Z" : .null, "finish": started ? "keep" : .null,
        "wording": .bool(false),
      ]
      return record
    })
  }

  private func job(_ statuses: [String], status: String = "needs_review", reason: String = "wave", extra: JSONValue = [:]) -> String {
    var state: JSONValue = ["domain": "example.com", "finish": "keep", "wording": .bool(false), "waves": waves(statuses)]
    if case .object(let more) = extra, case .object(var base) = state {
      for (key, value) in more { base[key] = value }
      state = .object(base)
    }
    let job: JSONValue = [
      "id": "j1", "kind": "import", "status": .string(status), "brief": "Bring in example.com",
      "review": ["reason": .string(reason), "message": "Main pages is in. Review it, then start the next wave."],
      "siteImport": state, "steps": [], "outputs": [],
    ]
    return String(decoding: try! JSONValue.object(["jobs": .array([job])]).encoded(), as: UTF8.self)
  }

  private func loaded(_ body: String) async throws -> (ScreenSpec, ScreenModel) {
    let spec = try screen("ai.job")
    let transport = RecordingTransport(responses: [(200, body)])
    let model = ScreenModel(
      spec: spec, context: ["org": ["id": "o1"], "site": ["id": "h1"], "params": ["jobId": "j1"]], api: api(transport))
    await model.load()
    return (spec, model)
  }

  func testTheJobsListOffersBringMySiteWhereTheRouteSaysItIsReady() async throws {
    let spec = try screen("ai.jobs")
    let jobsLoad = try XCTUnwrap(spec.loads.first { $0.key == "jobs" })
    XCTAssertEqual(
      ScreenValues.render(jobsLoad.url, in: ["org": ["id": "o1"], "site": ["id": "h1"]]), "/api/ai/jobs?orgId=o1&hostId=h1&limit=50&siteImport=1")
    let bring = try action(spec, "import")
    XCTAssertEqual(bring.navigate?.screen, "ai.import.start")
    for (offer, offered) in [("ready", true), ("role", false), ("plan", false)] {
      let model = ScreenModel(
        spec: spec, context: ["org": ["id": "o1"], "site": ["id": "h1"]],
        api: api(RoutedTransport([("siteImport=1", #"{"jobs":[],"siteImport":"\#(offer)"}"#)])))
      await model.load()
      XCTAssertEqual(ScreenValues.condition(bring.when, in: model.context), offered, offer)
    }
  }

  func testAnImportWaitingForItsNextWaveShowsTheChoiceAndStartsTheWaveWithIt() async throws {
    let (spec, model) = try await loaded(job(["review", "waiting", "waiting"]))
    let context = model.context
    XCTAssertEqual(ScreenValues.lookup("is.waveWaits", in: context), true)
    XCTAssertEqual(ScreenValues.lookup("is.manyWait", in: context), true)
    // The fields say how the new site looks, the waves list each wave, and the choice is offered.
    let fields = try XCTUnwrap(spec.blocks.first { $0.type == "fields" })
    let job = try XCTUnwrap(ScreenValues.lookup("data.jobs.jobs.0", in: context))
    let rows = fields["rows"].array.filter { ScreenValues.condition($0["when"]?.stringValue, in: ScreenContext.with(context, item: job)) }
    let looks = rows.filter { ScreenValues.render($0["label"]?.stringValue ?? "", in: context) == "How your new site looks" }
    XCTAssertEqual(looks.map { ScreenValues.render($0["value"]?.stringValue ?? "", in: context) }, ["Keep my site"])
    let titles = shown(spec, model)
    XCTAssertTrue(titles.contains("Every wave (3)"))
    XCTAssertTrue(titles.contains("Main pages is in. Review it, then start the next wave."))
    XCTAssertTrue(
      titles.contains(
        "Start every remaining wave runs the 2 waves left one after another, with no review between them. You review the last one."))
    XCTAssertTrue(titles.contains { $0.hasPrefix("Next: Blog 1. A wave is paid from your AI credits.") })

    let start = try action(spec, "startWave")
    XCTAssertEqual(ScreenValues.render(start.label, in: context), "Start Blog 1")
    // The prompt opens on the import's own choice, Keep my site, with the switch on for a move to Improve it.
    let fieldsAsked = start.inputs(in: context)
    XCTAssertEqual(fieldsAsked.map(\.key), ["finish", "wording"])
    XCTAssertEqual(initialValue(fieldsAsked[0], in: context), .text("keep"))
    XCTAssertEqual(initialValue(fieldsAsked[1], in: context), .flag(true))
    XCTAssertEqual(
      fieldsAsked[0].choiceRows(in: context).map(\.label), ["Keep my site", "Improve it"])
    XCTAssertEqual(
      fieldsAsked[0].choiceRows(in: context).last?.detail,
      "Aglyn AI redesigns each page with your pictures, menus and forms, in a theme built around your brand.")
    XCTAssertEqual(ScreenValues.render(fieldsAsked[1].label, in: context), "Also improve my wording")
    XCTAssertTrue(ScreenValues.render(fieldsAsked[1].help ?? "", in: context).hasSuffix("About 25 more AI credits for each main page."))
    // The wording switch shows only under Improve it.
    XCTAssertFalse(ScreenValues.condition(fieldsAsked[1].when, in: ScreenContext.with(context, "form", ["finish": "keep"])))
    XCTAssertTrue(ScreenValues.condition(fieldsAsked[1].when, in: ScreenContext.with(context, "form", ["finish": "improve"])))

    // The wave starts on the resume door with the choice, the wording a boolean and only under Improve it.
    let run = RecordingTransport(responses: [(200, #"{"job":{"id":"j1"}}"#), (200, #"{"job":{"id":"j1"}}"#), (200, #"{"job":{"id":"j1"}}"#)])
    let runner = ScreenModel(spec: spec, context: context, api: api(run))
    let improve = await runner.run(start, in: ScreenContext.with(context, "form", ["finish": "improve", "wording": true]))
    XCTAssertEqual(improve, .done(message: "Bringing in Blog 1", response: ["job": ["id": "j1"]]))
    XCTAssertEqual(run.requests[0].url?.path, "/api/ai/jobs/j1/resume")
    XCTAssertEqual(try sent(run, 0), ["orgId": "o1", "hostId": "h1", "finish": "improve", "wording": true])
    _ = await runner.run(start, in: ScreenContext.with(context, "form", ["finish": "keep"]))
    XCTAssertEqual(try sent(run, 1), ["orgId": "o1", "hostId": "h1", "finish": "keep", "wording": false])
    // Start every remaining wave says so to the same door.
    _ = await runner.run(try action(spec, "startAll"), in: ScreenContext.with(context, "form", ["finish": "improve", "wording": false]))
    XCTAssertEqual(try sent(run, 2), ["orgId": "o1", "hostId": "h1", "finish": "improve", "wording": false, "startAll": true])
  }

  func testTheChoiceSpeaksOfNewCopyUnderAGenerativeImproveIt() async throws {
    let (spec, model) = try await loaded(
      job(["review", "waiting"], extra: ["finish": "improve", "wording": .bool(true), "generative": .bool(true)]))
    let context = model.context
    XCTAssertEqual(ScreenValues.lookup("is.manyWait", in: context), false)
    XCTAssertFalse(shown(spec, model).contains { $0.hasPrefix("Start every remaining wave runs") })
    let start = try action(spec, "startWave")
    let asked = start.inputs(in: context)
    XCTAssertEqual(initialValue(asked[0], in: context), .text("improve"))
    XCTAssertEqual(initialValue(asked[1], in: context), .flag(true))
    XCTAssertEqual(ScreenValues.render(asked[1].label, in: context), "Also write new copy")
    XCTAssertTrue(ScreenValues.render(asked[1].help ?? "", in: context).hasSuffix("About 32 more AI credits for each main page."))
    XCTAssertTrue(asked[0].choiceRows(in: context).last?.detail?.hasSuffix("It shows you the plan before anything is built.") == true)
    let fields = try XCTUnwrap(spec.blocks.first { $0.type == "fields" })
    let job = try XCTUnwrap(ScreenValues.lookup("data.jobs.jobs.0", in: context))
    let looks = fields["rows"].array.filter {
      ScreenValues.condition($0["when"]?.stringValue, in: ScreenContext.with(context, item: job))
        && ScreenValues.render($0["label"]?.stringValue ?? "", in: context) == "How your new site looks"
    }
    XCTAssertEqual(looks.map { $0["value"]?.stringValue }, ["Improve it, with new copy"])
  }

  func testNoWaveIsOfferedWhileOneRunsThePlanWaitsOrTheReadStopped() async throws {
    for body in [
      job(["review", "running", "waiting"]),
      job(["review", "waiting"], extra: ["plan": ["nav": [:]]]),
      job(["waiting", "waiting"], reason: "blocked", extra: ["verdict": ["kind": "home-blocked"]]),
      job(["done", "done"], status: "done"),
    ] {
      let (_, model) = try await loaded(body)
      XCTAssertEqual(ScreenValues.lookup("is.waveWaits", in: model.context), false, body)
    }
    // A plan its owner already accepted no longer waits.
    let (_, accepted) = try await loaded(job(["review", "waiting"], extra: ["plan": ["nav": [:]], "planAccepted": .bool(true)]))
    XCTAssertEqual(ScreenValues.lookup("is.waveWaits", in: accepted.context), true)
  }

  func testTheStartAsksTheAddressThenTheProofThenTheChoiceAndStartsTheRead() async throws {
    let spec = try screen("ai.import.start")
    XCTAssertEqual(spec.scope, "site")
    XCTAssertTrue(ScreenValues.condition(spec.requires, in: ["org": ["can": ["ai.import": true]]]))
    XCTAssertFalse(ScreenValues.condition(spec.requires, in: ["org": ["can": ["ai.import": false]]]))
    let pending = #"{"domain":"example.com","status":"pending","current":false,"provenMethod":null,"provenAt":null,"dns":{"host":"_aglyn-challenge.example.com","type":"TXT","value":"aglyn-domain-verification=abc"},"meta":{"name":"aglyn-domain-verification","content":"abc","tag":"<meta name=\"aglyn-domain-verification\" content=\"abc\">"},"email":{"domain":"example.com","pendingAddress":null,"expiresAt":null,"attemptsLeft":null}}"#
    let proven = pending.replacingOccurrences(of: #""status":"pending","current":false,"provenMethod":null,"provenAt":null"#, with: #""status":"proven","current":true,"provenMethod":"dns","provenAt":1762891200000"#)
    let offer = #"{"jobs":[],"siteImport":"ready"}"#
    func phase(_ claims: String) async -> ScreenModel {
      let model = ScreenModel(
        spec: spec, context: ["org": ["id": "o1"], "site": ["id": "h1"]],
        api: api(RoutedTransport([("siteImport=1", offer), ("ownership?orgId=o1", #"{"claims":[\#(claims)]}"#)])))
      await model.load()
      return model
    }
    let start = await phase("")
    XCTAssertEqual(shown(spec, start), ["Your current website"])

    // 1. The address is claimed, and the claim's own domain is kept for this site.
    let run = RecordingTransport(responses: [
      (200, #"{"claim":\#(pending)}"#),
      (200, #"{"result":{"status":"not-yet","message":"No record yet."}}"#),
      (200, #"{"job":{"id":"j9"}}"#),
    ])
    let runner = ScreenModel(spec: spec, context: start.context, api: api(run))
    _ = await runner.run(try action(spec, "address"), in: ScreenContext.with(start.context, "form", ["address": "https://www.Example.com/"]))
    XCTAssertEqual(run.requests[0].url?.path, "/api/ai/site-import/ownership")
    XCTAssertEqual(try sent(run, 0), ["orgId": "o1", "action": "claim", "domain": "https://www.Example.com/"])
    XCTAssertEqual(ScreenStash.values["aiImportDomain"], "example.com")
    XCTAssertEqual(ScreenStash.values["aiImportSite"], "h1")

    // 2. Not proved yet: the three ways, each with its check.
    let proving = await phase(pending)
    XCTAssertEqual(
      shown(spec, proving),
      ["Prove it is yours", "Prove the site is yours, any one way below. Nothing is read from your site until you do, so only a site you own can be brought in.",
        "Add a DNS record", "actions", "Add a tag to your home page", "actions", "Get a code by email", "actions"])
    let claim = try XCTUnwrap(ScreenValues.lookup("data.claims.claims.0", in: proving.context))
    XCTAssertEqual(ScreenValues.render("{item.dns.host:before/.}", in: ScreenContext.with(proving.context, item: claim)), "_aglyn-challenge")
    XCTAssertEqual(ScreenValues.render(try action(spec, "copyName").copy ?? "", in: proving.context), "_aglyn-challenge")
    XCTAssertEqual(ScreenValues.render(try action(spec, "copyValue").copy ?? "", in: proving.context), "aglyn-domain-verification=abc")
    XCTAssertTrue(ScreenValues.condition(try action(spec, "sendCode").when, in: proving.context))
    XCTAssertFalse(ScreenValues.condition(try action(spec, "sendNewCode").when, in: proving.context))
    XCTAssertFalse(ScreenValues.condition(try action(spec, "confirmCode").when, in: proving.context))
    let check = await runner.run(try action(spec, "checkDns"), in: proving.context)
    XCTAssertEqual(check.response?["result"]?["status"], "not-yet")
    XCTAssertEqual(ScreenModel.message(for: try action(spec, "checkDns"), response: check.response, in: proving.context), "No record yet.")
    XCTAssertEqual(try sent(run, 1), ["orgId": "o1", "domain": "example.com", "action": "check", "method": "dns"])

    // 3. Proved: what happens next, the choice (Improve it, wording on, as the console starts it), and the read.
    let proved = await phase(proven)
    XCTAssertEqual(shown(spec, proved).first, "Bring in example.com")
    let read = try XCTUnwrap(spec.blocks.first { $0.id == "read" })
    let fields = read["fields"].array.compactMap(FieldSpec.init)
    XCTAssertEqual(fields.map { initialValue($0, in: proved.context) }, [.text("improve"), .flag(true)])
    let submit = try action(spec, "read")
    XCTAssertEqual(submit.navigate?.screen, "ai.job")
    let started = await runner.run(submit, in: ScreenContext.with(proved.context, "form", ["finish": "improve", "wording": false]))
    XCTAssertEqual(started.response, ["job": ["id": "j9"]])
    XCTAssertEqual(run.requests[2].url?.path, "/api/ai/jobs")
    XCTAssertEqual(
      try sent(run, 2),
      ["orgId": "o1", "hostId": "h1", "kind": "import", "brief": "Bring in example.com",
        "inputs": ["domain": "example.com", "finish": "improve", "wording": false]])
    XCTAssertEqual(ScreenStash.values["aiImportDomain"] ?? .null, .null)
  }

  func testTheStartSaysWhyWhenTheWorkspaceCannotBringASiteIn() async throws {
    let spec = try screen("ai.import.start")
    let transport = RoutedTransport([("siteImport=1", #"{"jobs":[],"siteImport":"plan"}"#)])
    let model = ScreenModel(spec: spec, context: ["org": ["id": "o1"], "site": ["id": "h1"]], api: api(transport))
    await model.load()
    XCTAssertEqual(
      shown(spec, model), ["Bring your current website in, every page and photo, on any paid plan. Upgrade to bring yours in."])
  }
}
