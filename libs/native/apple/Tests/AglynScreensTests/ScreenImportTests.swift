// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// The records import wizard (`transfer-import.screens.json`) and the grammar it leans on: a file read in
/// the encoding it was saved in, sent in parts, an action asked until the route says it is done, and the
/// choices each step keeps for the next.
@MainActor
final class ScreenImportTests: XCTestCase {
  override func setUp() async throws {
    ScreenValues.timeZone = TimeZone(identifier: "UTC")!
    ScreenStash.clear()
  }

  override func tearDown() async throws { ScreenStash.clear() }

  private func spec(_ id: String) throws -> ScreenSpec {
    let text = try String(
      contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("transfer-import.screens.json"), encoding: .utf8)
    let file = try XCTUnwrap(JSONValue.decode(Data(text.utf8)))
    let found = try XCTUnwrap(file["screens"].array.first { $0["id"]?.stringValue == id })
    return try XCTUnwrap(ScreenSpec(found))
  }

  private func api(_ transport: RecordingTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
  }

  private func body(_ transport: RecordingTransport, _ at: Int) throws -> JSONValue {
    try XCTUnwrap(transport.requests[at].httpBody.flatMap(JSONValue.decode))
  }

  func testAChosenFileIsReadInTheEncodingItWasSavedIn() {
    XCTAssertEqual(ScreenValues.decodeFileText(Data([0xEF, 0xBB, 0xBF] + Array("a,b".utf8))), "a,b")
    XCTAssertEqual(ScreenValues.decodeFileText(Data([0xFF, 0xFE, 0x61, 0x00, 0x2C, 0x00, 0x62, 0x00])), "a,b")
    XCTAssertEqual(ScreenValues.decodeFileText(Data([0xFE, 0xFF, 0x00, 0x61, 0x00, 0x2C, 0x00, 0x62])), "a,b")
    XCTAssertEqual(ScreenValues.decodeFileText(Data("café".utf8)), "café")
    // A spreadsheet's "CSV" is Windows-1252: é is one byte, and 0x80 is the euro sign.
    XCTAssertEqual(ScreenValues.decodeFileText(Data([0x63, 0x61, 0x66, 0xE9])), "café")
    XCTAssertEqual(ScreenValues.decodeFileText(Data([0x80, 0x31])), "€1")
  }

  func testAFileIsCutIntoPartsThatEachFitTheBudgetOnceEncoded() throws {
    let text = String(repeating: "a\"b\n€😀/", count: 40)
    let parts = ScreenValues.splitUpload(text, budget: 100)
    XCTAssertGreaterThan(parts.count, 1)
    XCTAssertEqual(parts.joined(), text)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    for part in parts { XCTAssertLessThanOrEqual(try encoder.encode(part).count - 2, 100) }
    XCTAssertEqual(ScreenValues.splitUpload("", budget: 10), [""])
    XCTAssertEqual(ScreenValues.splitUpload("abc", budget: 10), ["abc"])
  }

  func testAFileGoesUpInPartsWithTheJobTheFirstAnswerNamed() async throws {
    let transport = RecordingTransport(responses: [
      (200, #"{"job":{"id":"j7"},"complete":false}"#), (200, #"{"job":{"id":"j7"},"complete":false}"#),
      (200, #"{"job":{"id":"j7"},"complete":true}"#),
    ])
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api(transport))
    let upload = try XCTUnwrap(
      ActionSpec([
        "label": "Upload", "url": "/api/transfer/upload",
        "body": ["orgId": "o1", "content": "{form.file}", "delimiter?": "{form.delimiter}", "headerRow": "{form.headerRow}"],
        "chunk": ["field": "content", "bytes": 10, "idFrom": "job.id", "idKey": "jobId", "firstOnly": ["delimiter", "headerRow"], "until": "complete"],
      ]))
    let scope: JSONValue = ["form": ["file": "abcdefghijklmnopqrstuvwxyz", "delimiter": ";", "headerRow": true]]
    guard case .done(_, let answer) = await model.run(upload, in: scope) else { return XCTFail("expected the upload to finish") }
    XCTAssertEqual(answer?["complete"], true)
    XCTAssertEqual(transport.requests.count, 3)
    XCTAssertEqual(
      try body(transport, 0),
      ["orgId": "o1", "content": "abcdefghij", "delimiter": ";", "headerRow": true, "part": 0, "parts": 3])
    XCTAssertEqual(try body(transport, 1), ["orgId": "o1", "content": "klmnopqrst", "part": 1, "parts": 3, "jobId": "j7"])
    XCTAssertEqual(try body(transport, 2), ["orgId": "o1", "content": "uvwxyz", "part": 2, "parts": 3, "jobId": "j7"])

    // A file that has not landed whole is not an upload.
    let short = RecordingTransport(responses: [(200, #"{"job":{"id":"j8"},"complete":false}"#)])
    let lone = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api(short))
    guard case .failed(let message) = await lone.run(upload, in: ["form": ["file": "abc"]]) else { return XCTFail("expected a failure") }
    XCTAssertEqual(message, "The file did not finish uploading. Try again.")
    XCTAssertEqual(short.requests.count, 1)
    XCTAssertNil(try body(short, 0)["part"])
  }

  func testAnActionIsAskedAgainUntilTheRouteIsDoneAndTheStashShowsEachPass() async throws {
    let transport = RecordingTransport(responses: [
      (200, #"{"done":false,"progress":{"rowsDone":10,"rowCount":30}}"#), (200, #"{"done":false,"progress":{"rowsDone":20,"rowCount":30}}"#),
      (200, #"{"done":true,"progress":{"rowsDone":30,"rowCount":30}}"#),
    ])
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api(transport))
    let apply = try XCTUnwrap(
      ActionSpec([
        "label": "Import", "url": "/api/transfer/apply", "body": ["jobId": "j1"],
        "repeat": ["until": "response.done", "max": 10, "stop": "response.job.status == failed"],
        "stash": ["importProgress": "{response.progress}"],
      ]))
    guard case .done(_, let answer) = await model.run(apply, in: [:]) else { return XCTFail("expected it to finish") }
    XCTAssertEqual(answer?["done"], true)
    XCTAssertEqual(transport.requests.count, 3)
    XCTAssertEqual(ScreenStash.values["importProgress"], ["rowsDone": 30, "rowCount": 30])

    // A route that says the job failed ends it with the route's own words.
    ScreenStash.clear()
    let failing = RecordingTransport(responses: [
      (200, #"{"done":false,"job":{"status":"applying"}}"#),
      (200, #"{"done":false,"job":{"status":"failed","error":{"message":"The file changed."}}}"#),
    ])
    let stopped = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api(failing))
    let careful = try XCTUnwrap(
      ActionSpec([
        "label": "Import", "url": "/api/transfer/apply",
        "repeat": ["until": "response.done", "stop": "response.job.status == failed", "stopMessage": "{response.job.error.message|'Stopped.'}"],
      ]))
    guard case .failed(let message) = await stopped.run(careful, in: [:]) else { return XCTFail("expected a failure") }
    XCTAssertEqual(message, "The file changed.")
    XCTAssertEqual(failing.requests.count, 2)

    // And it stops at the ceiling rather than asking for ever.
    let endless = RecordingTransport(responses: Array(repeating: (200, #"{"done":false}"#), count: 5))
    let capped = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api(endless))
    _ = await capped.run(try XCTUnwrap(ActionSpec(["label": "Go", "url": "/api/x", "repeat": ["until": "response.done", "max": 3]])), in: [:])
    XCTAssertEqual(endless.requests.count, 3)
  }

  func testAFollowUpRunsWithTheStashJustMadeAndItsFailureFailsTheAction() async throws {
    let transport = RecordingTransport(responses: [(200, #"{"job":{"id":"j1"}}"#), (200, #"{"match":{"mapping":{"0":"email"}}}"#)])
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api(transport))
    let upload = try XCTUnwrap(
      ActionSpec([
        "label": "Upload", "url": "/api/transfer/upload", "stash": ["importJob": "{response.job.id}"],
        "after": ["label": "Read", "url": "/api/transfer/analyze", "body": ["jobId": "{stash.importJob}"], "stash": ["importMapping": "{response.match.mapping}"]],
      ]))
    guard case .done = await model.run(upload, in: [:]) else { return XCTFail("expected it to finish") }
    XCTAssertEqual(try body(transport, 1), ["jobId": "j1"])
    XCTAssertEqual(ScreenStash.values["importMapping"], ["0": "email"])

    let broken = RecordingTransport(responses: [(200, #"{"job":{"id":"j2"}}"#), (500, #"{"error":"The file could not be read."}"#)])
    let other = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api(broken))
    guard case .failed(let message) = await other.run(upload, in: [:]) else { return XCTFail("expected a failure") }
    XCTAssertEqual(message, "The file could not be read.")
  }

  func testEachScopeKnowsItsPositionAndAnActionMayRefuseToReload() throws {
    let context: JSONValue = ["data": ["headers": ["A", "B", "C"]]]
    let scopes = ScreenValues.scopes(items: "data.headers", filter: "item != B", in: context)
    XCTAssertEqual(scopes.map { ScreenValues.render("{index}:{item}", in: $0) }, ["0:A", "2:C"])
    XCTAssertTrue(try XCTUnwrap(ActionSpec(["label": "Go", "stash": ["a": 1], "reload": true])).reload)
    XCTAssertFalse(try XCTUnwrap(ActionSpec(["label": "Go", "stash": ["a": 1]])).reload)
  }

  private func analysis() -> JSONValue {
    [
      "headers": ["Email", "Name", "Plan"],
      "rowCount": 2,
      "samples": [["a@x.com", "Ann", "pro"], ["b@x.com", "Bo", "free"]],
      "match": [
        "mapping": ["0": "email"],
        "proposals": [["column": 0, "fieldId": "email", "reason": "exactAlias", "confidence": 0.99]],
      ],
      "mappingProblems": ["duplicates": [], "unmappedRequired": [], "invalid": []],
    ]
  }

  private let info: JSONValue = [
    "fields": [
      ["id": "email", "label": "Email", "matchKey": true],
      ["id": "name", "label": "Name"],
      ["id": "created", "label": "Created", "system": true],
      ["id": "score", "label": "Score", "derived": true],
    ]
  ]

  func testTheColumnsStepShowsEachColumnWithItsValuesAndProposalAndKeepsTheMapping() async throws {
    let columns = try spec("core.settings.data.import.columns")
    let list = try XCTUnwrap(columns.blocks.first { $0.title == "Columns" })
    let consts = try XCTUnwrap(columns.raw["constants"])
    let context: JSONValue = [
      "org": ["id": "o1"], "const": consts, "data": ["analysis": analysis(), "info": info],
      "stash": ["importMapping": ["0": "email"], "importFile": "people.csv"],
    ]
    let rows = ScreenValues.scopes(items: "data.analysis.headers", in: context)
    func line(_ key: String, _ row: Int) -> String { ScreenValues.render(list[key]?.stringValue ?? "", in: rows[row]) }
    XCTAssertEqual(line("primary", 0), "Email")
    XCTAssertEqual(line("secondary", 0), "a@x.com, b@x.com")
    XCTAssertEqual(line("tertiary", 0), "Proposed: Email · Same name")
    XCTAssertEqual(line("trailing", 0), "Email")
    XCTAssertEqual(line("trailing", 1), "Ignored")
    XCTAssertEqual(line("tertiary", 1), "Proposed: nothing · no match")
    XCTAssertEqual(line("secondary", 2), "pro, free")

    // Choosing a field for a column keeps it under the column's position; the choice offers only what a file can write.
    let choose = try XCTUnwrap(list["actions"].array.first.flatMap(ActionSpec.init))
    XCTAssertTrue(choose.reload)
    let picking = ScreenContext.with(rows[1], "form", ["field": "name"])
    let transport = RecordingTransport(responses: [])
    _ = await ScreenModel(spec: columns, context: [:], api: api(transport)).run(choose, in: ScreenContext.with(picking, "stash", ["importMapping": ["0": "email"]]))
    XCTAssertEqual(ScreenStash.values["importMapping"], ["0": "email", "1": "name"])
    XCTAssertEqual(try XCTUnwrap(choose.prompt.first).choices(in: rows[1]).map(\.value), ["", "email", "name"])
    // Ignoring a column takes it out of the mapping.
    ScreenStash.clear()
    _ = await ScreenModel(spec: columns, context: [:], api: api(transport)).run(
      choose, in: ScreenContext.with(ScreenContext.with(rows[0], "form", ["field": ""]), "stash", ["importMapping": ["0": "email"]]))
    XCTAssertEqual(ScreenStash.values["importMapping"], [:])

    // Continue waits for a usable mapping: no field two columns share, no required field left out, something mapped.
    let actions = try XCTUnwrap(columns.blocks.last { $0.type == "actions" })
    let next = try XCTUnwrap(actions["items"].array.first.flatMap(ActionSpec.init))
    XCTAssertTrue(ScreenValues.condition(next.when, in: context))
    var shared = context
    shared = ScreenContext.with(shared, "data", ["analysis": ScreenContext.with(analysis(), "mappingProblems", ["duplicates": [["fieldId": "email", "columns": [0, 1]]], "unmappedRequired": [], "invalid": []]), "info": info])
    XCTAssertFalse(ScreenValues.condition(next.when, in: shared))
    XCTAssertFalse(ScreenValues.condition(next.when, in: ScreenContext.with(context, "stash", ["importMapping": [:]])))
    let problems = columns.blocks.filter { $0.type == "list" && $0.title != "Columns" }
    XCTAssertEqual(
      ScreenValues.scopes(items: problems[0]["items"]?.stringValue ?? "", in: shared).map { ScreenValues.render(problems[0]["primary"]?.stringValue ?? "", in: $0) },
      ["Email is chosen for more than one column. Choose one column for it."])
  }

  func testContinuingFromTheColumnsKeepsTheListsProposalsUnderTheChoicesAlreadyMade() async throws {
    let columns = try spec("core.settings.data.import.columns")
    let actions = try XCTUnwrap(columns.blocks.last { $0.type == "actions" })
    let next = try XCTUnwrap(actions["items"].array.first.flatMap(ActionSpec.init))
    let answer = #"""
      {"picklists":[
        {"fieldId":"status","proposals":{"actv":{"action":"mapTo","valueId":"a"},"old":{"action":"leaveBlank"}}},
        {"fieldId":"tier","proposals":{"gold":{"action":"addValue"}}}]}
      """#
    let transport = RecordingTransport(responses: [(200, answer)])
    ScreenStash.set(["importJob": "j1", "importMapping": ["0": "email"], "importPicklists": ["status": ["old": ["action": "refuseRow"]]]])
    let scope: JSONValue = ["org": ["id": "o1"], "stash": .object(ScreenStash.values)]
    _ = await ScreenModel(spec: columns, context: [:], api: api(transport)).run(next, in: scope)
    // The person's earlier choice wins over the proposal; the rest of the proposals are on screen to change.
    XCTAssertEqual(
      ScreenStash.values["importPicklists"],
      [
        "status": ["actv": ["action": "mapTo", "valueId": "a"], "old": ["action": "refuseRow"]],
        "tier": ["gold": ["action": "addValue"]],
      ])
    XCTAssertEqual(try body(transport, 0), ["orgId": "o1", "jobId": "j1", "mapping": ["0": "email"]])
  }

  func testChoosingWhatAListValueBecomesKeepsItUnderItsFieldAndValue() async throws {
    let values = try spec("core.settings.data.import.values")
    let list = try XCTUnwrap(values.blocks.first { $0.title == "Values a list does not hold" })
    let picklists: JSONValue = [
      [
        "fieldId": "status", "spec": ["restricted": true], "proposals": [:],
        "set": ["values": [["id": "a", "label": "Active", "active": true], ["id": "z", "label": "Old", "active": false]]],
        "unmatched": [["key": "actv", "value": "actv", "count": 2, "suggestions": [["valueId": "a", "label": "Active", "confidence": 0.8]]]],
      ]
    ]
    let context: JSONValue = [
      "const": try XCTUnwrap(values.raw["constants"]), "data": ["analysis": ["picklists": picklists], "info": info],
      "stash": ["importPicklists": ["status": ["old": ["action": "leaveBlank"], "actv": ["action": "mapTo", "valueId": "a"]]]],
    ]
    let rows = ScreenValues.scopes(items: "data.analysis.picklists", within: "unmatched", in: context)
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(ScreenValues.render(list["primary"]?.stringValue ?? "", in: rows[0]), "“actv”")
    XCTAssertEqual(ScreenValues.render(list["tertiary"]?.stringValue ?? "", in: rows[0]), "Closest: Active")
    XCTAssertEqual(ScreenValues.render(list["trailing"]?.stringValue ?? "", in: rows[0]), "Map to a list value")
    let choose = try XCTUnwrap(list["actions"].array.first.flatMap(ActionSpec.init))
    let fields = choose.prompt
    XCTAssertEqual(fields.map(\.key), ["action", "valueId", "label", "meaning", "group"])
    XCTAssertEqual(fields[1].choices(in: rows[0]).map(\.value), ["a"])  // an inactive value is not offered
    XCTAssertEqual(initialValue(fields[1], in: rows[0]), .text("a"))
    let answered = ScreenContext.with(rows[0], "form", ["action": "addValue", "label": "Actively", "meaning": "", "group": ""])
    XCTAssertTrue(ScreenValues.condition(fields[2].when, in: answered))
    XCTAssertFalse(ScreenValues.condition(fields[3].when, in: answered))  // this list names no meanings
    _ = await ScreenModel(spec: values, context: [:], api: api(RecordingTransport(responses: []))).run(choose, in: answered)
    XCTAssertEqual(
      ScreenStash.values["importPicklists"],
      ["status": ["old": ["action": "leaveBlank"], "actv": ["action": "addValue", "label": "Actively"]]])
  }

  func testTheReviewPlansAgainWithThePoliciesAndTheRowChoicesAndAsksForEveryAcknowledgement() async throws {
    let review = try spec("core.settings.data.import.review")
    let plan = #"{"summary":{"create":1},"acknowledgementsRequired":["overwriteNonBlank"],"ambiguous":[],"conflicts":[],"warnings":[],"sample":[],"recordLabels":{}}"#
    let transport = RecordingTransport(responses: [(200, plan)])
    ScreenStash.set([
      "importJob": "j1", "importMapping": ["0": "email"], "importKeys": ["email"],
      "importPolicy": ["record": ["onMatch": "update", "onNew": "create", "onAmbiguous": "ask"], "fieldDefault": ["mode": "fillBlanks", "blank": "leave"]],
      "importFields": ["name": ["mode": "overwrite"]], "importRows": ["2": ["action": "skip"]],
    ])
    let ambiguous = try XCTUnwrap(review.blocks.first { $0.title == "Rows that match more than one record" })
    let actions = ambiguous["actions"].array.compactMap(ActionSpec.init)
    XCTAssertEqual(actions.map(\.id), ["record", "skip"])
    let row: JSONValue = ["row": 5, "recordIds": ["r1", "r2"]]
    let scope = ScreenContext.with(
      ScreenContext.with(["org": ["id": "o1"], "stash": .object(ScreenStash.values)], item: row), "form", ["record": "r2"])
    _ = await ScreenModel(spec: review, context: [:], api: api(transport)).run(actions[0], in: scope)
    XCTAssertEqual(
      try body(transport, 0),
      [
        "orgId": "o1", "jobId": "j1", "mapping": ["0": "email"], "matchKeys": ["email"],
        "policy": [
          "record": ["onMatch": "update", "onNew": "create", "onAmbiguous": "ask"], "fieldDefault": ["mode": "fillBlanks", "blank": "leave"],
          "fields": ["name": ["mode": "overwrite"]], "rows": ["2": ["action": "skip"], "5": ["recordId": "r2"]],
        ],
      ])
    XCTAssertEqual(ScreenStash.values["importRows"], ["2": ["action": "skip"], "5": ["recordId": "r2"]])
    XCTAssertEqual(ScreenValues.lookup("summary.create", in: ScreenStash.values["importPlan"] ?? .null), 1)

    // Import asks for every acknowledgement the plan requires; with none to ask, it runs straight away.
    let last = try XCTUnwrap(review.blocks.last { $0.type == "actions" })
    let apply = try XCTUnwrap(last["items"].array.first.flatMap(ActionSpec.init))
    let applyNow = try XCTUnwrap(last["items"].array.last.flatMap(ActionSpec.init))
    func offered(_ plan: JSONValue) -> [String] {
      [apply, applyNow].filter { ScreenValues.condition($0.when, in: ["stash": ["importPlan": plan]]) }.map(\.id)
    }
    XCTAssertEqual(offered(["acknowledgementsRequired": ["overwriteNonBlank"]]), ["apply"])
    XCTAssertEqual(offered(["acknowledgementsRequired": []]), ["applyNow"])
    let ack = try XCTUnwrap(apply.prompt.first)
    let waiting: JSONValue = ["stash": .object(ScreenStash.values)]
    XCTAssertTrue(ack.unmet(["x"], in: waiting))
    XCTAssertNotNil(apply.repeating)
    XCTAssertEqual(apply.repeating?["until"]?.stringValue, "response.done")
  }

  func testTheOpenStepSendsAnImportToWhereItStands() throws {
    let open = try spec("core.settings.data.import.open")
    let actions = try XCTUnwrap(open.blocks.first { $0.type == "actions" })["items"].array.compactMap(ActionSpec.init)
    func shown(_ status: String) -> [String] {
      actions.filter { ScreenValues.condition($0.when, in: ["data": ["status": ["job": ["status": .string(status)]]]]) }.map(\.id)
    }
    XCTAssertEqual(shown("draft"), ["continue"])
    XCTAssertEqual(shown("planned"), ["continue"])
    XCTAssertEqual(shown("applying"), ["resume"])
    XCTAssertEqual(shown("failed"), ["resume"])
    XCTAssertEqual(shown("applied"), ["results"])
    XCTAssertEqual(shown("undone"), ["results"])
  }

  /// The console's own answers for the two comparisons a site item import shows, replayed.
  func testTheItemDiffAndMergeKeysReplayTheConsolesCases() throws {
    let url = ScreenSpecTests.screensDir.appendingPathComponent("../contracts/function-cases.generated.json").standardizedFileURL
    let file = try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
    for name in ["packageJsonDiff", "packageMergeKeys", "packageItemChanges"] {
      let cases = try XCTUnwrap(file["functions"]?[name]?["cases"]).array
      XCTAssertGreaterThan(cases.count, 5, name)
      for one in cases {
        let args: [JSONValue?] = one["args"].array.map { Optional($0) }
        XCTAssertEqual(ScreenFunctions.call(name, args), one["result"], "\(name) \(args)")
      }
    }
    XCTAssertNil(ScreenFunctions.call("nothing", []))
  }
}
