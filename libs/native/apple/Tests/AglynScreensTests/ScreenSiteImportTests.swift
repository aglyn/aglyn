// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// Importing a site package (`site-import.screens.json`), step by step as the console's wizard takes it: the
/// defaults for each kind of change, a choice per item, the missing items and what to do about each, the
/// values a merge keeps, and what must be acknowledged before the import writes. Kotlin replays the same
/// cases (ScreenSiteImportTest).
@MainActor
final class ScreenSiteImportTests: XCTestCase {
  override func setUp() async throws { ScreenStash.clear() }

  override func tearDown() async throws { ScreenStash.clear() }

  private func spec(_ id: String) throws -> ScreenSpec {
    let text = try String(
      contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("site-import.screens.json"), encoding: .utf8)
    let file = try XCTUnwrap(JSONValue.decode(Data(text.utf8)))
    let found = try XCTUnwrap(file["screens"].array.first { $0["id"]?.stringValue == id })
    return try XCTUnwrap(ScreenSpec(found))
  }

  private func api(_ transport: HTTPTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
  }

  private func sent(_ transport: RecordingTransport, _ at: Int) throws -> JSONValue {
    try XCTUnwrap(transport.requests[at].httpBody.flatMap(JSONValue.decode))
  }

  /// A block's action, by its id (a button in an `actions` block or a row action of a list).
  private func action(_ screen: ScreenSpec, _ id: String) throws -> ActionSpec {
    for block in screen.blocks {
      for key in ["items", "actions"] {
        for raw in block[key].array where raw["id"]?.stringValue == id {
          return try XCTUnwrap(ActionSpec(raw))
        }
      }
    }
    return try XCTUnwrap(nil as ActionSpec?, "no action \(id) on \(screen.id)")
  }

  /// What a button sees: the site, what the wizard has kept, and the form or row it was pressed on.
  private func scope(_ extra: [String: JSONValue] = [:]) -> JSONValue {
    var record: [String: JSONValue] = ["site": ["id": "h1"], "stash": .object(ScreenStash.values)]
    for (key, value) in extra { record[key] = value }
    return .object(record)
  }

  private func row(_ key: String, choices: [String] = ["replace", "keepBoth", "merge", "skip"]) -> JSONValue {
    ["key": .string(key), "choices": .array(choices.map(JSONValue.string))]
  }

  private let plan = #"""
    {"plan":{"items":[
      {"key":"page/a","kind":"page","id":"a","name":"Home","status":"differs","comparison":"differs","proposed":"skip","needsChoice":true,"choices":["replace","keepBoth","merge","skip"],"deps":[],"missing":[]},
      {"key":"page/z","kind":"page","id":"z","name":"Terms","status":"differs","comparison":"differs","proposed":"skip","needsChoice":true,"choices":["replace","skip"],"deps":[],"missing":[]},
      {"key":"page/b","kind":"page","id":"b","name":"About","status":"new","comparison":"new","proposed":"create","needsChoice":false,"choices":["create","skip"],"deps":[{"kind":"layout","id":"other"}],"missing":[{"kind":"layout","id":"other"}]},
      {"key":"email/c","kind":"email","id":"c","status":"identical","comparison":"identical","proposed":"skip","needsChoice":false,"choices":["skip","replace","keepBoth"],"deps":[],"missing":[]}
    ],"counts":{"new":1,"identical":1,"differs":2,"missingDependency":0},"kinds":[]},
    "capRefusal":null,"warnings":[],"warningsTotal":0,"unknownKinds":[],"notSent":[]}
    """#

  private func reviewed(warnings: String, total: Int) -> String {
    #"{"capRefusal":null,"warnings":\#(warnings),"warningsTotal":\#(total),"unknownKinds":[],"notSent":[]}"#
  }

  private let dangling = #"""
    [{"code":"danglingReference","item":"page/b","dependency":"layout/other","message":"page/b points at layout/other."},
     {"code":"danglingReference","item":"page/a","dependency":"layout/other","message":"page/a points at layout/other."}]
    """#

  func testTheDefaultsDecideEveryItemButTheOnesThatDifferAndEachChoiceFollowsFromThem() async throws {
    let transport = RecordingTransport(responses: [(200, plan)])
    let importing = try spec("core.site.import")
    let model = ScreenModel(spec: importing, context: [:], api: api(transport))
    let submit = try XCTUnwrap(importing.blocks.first { $0.id == "package" }?["submit"].flatMap(ActionSpec.init))
    let file: JSONValue = ["manifest": ["items": []]]
    _ = await model.run(submit, in: scope(["form": ["package": file]]))
    XCTAssertEqual(try sent(transport, 0)["action"], "plan")
    XCTAssertEqual(ScreenStash.values["package"], file)
    // New items are added and unchanged ones left; a changed item waits for the person.
    XCTAssertEqual(ScreenStash.values["decisions"], ["page/b": "create", "email/c": "skip"])
    XCTAssertEqual(ScreenStash.values["undecided"], ["page/a": "page/a", "page/z": "page/z"])
    XCTAssertEqual(ScreenStash.values["bulk"]?["new"], "create")

    let review = try spec("core.site.import.review")
    let reviewing = ScreenModel(spec: review, context: [:], api: api(transport))
    // A default for the changed items, where an item can take it; the one that cannot stays undecided.
    let bulk = try action(review, "bulk")
    _ = await reviewing.run(bulk, in: scope(["form": ["new": "create", "differs": "keepBoth", "identical": "skip"]]))
    XCTAssertEqual(
      ScreenStash.values["decisions"], ["page/a": "keepBoth", "page/b": "create", "email/c": "skip"])
    XCTAssertEqual(ScreenStash.values["undecided"], ["page/z": "page/z"])
    XCTAssertEqual(try XCTUnwrap(bulk.prompt.first { $0.key == "differs" }).choices(in: scope()).map(\.value), ["", "skip", "replace", "keepBoth"])
    // A choice of its own beats the default, and the item no longer waits.
    let choose = try action(review, "choose")
    _ = await reviewing.run(choose, in: scope(["item": row("page/z", choices: ["replace", "skip"]), "form": ["decision": "skip"]]))
    XCTAssertEqual(ScreenStash.values["overrides"], ["page/z": "skip"])
    XCTAssertEqual(ScreenStash.values["decisions"]?["page/z"], "skip")
    XCTAssertEqual(ScreenStash.values["decisions"]?["page/a"], "keepBoth")
    XCTAssertEqual(ScreenStash.values["undecided"], [:])
    // Setting the defaults again leaves the choice made.
    _ = await reviewing.run(bulk, in: scope(["form": ["new": "skip", "differs": "replace", "identical": "skip"]]))
    XCTAssertEqual(
      ScreenStash.values["decisions"], ["page/a": "replace", "page/z": "skip", "page/b": "skip", "email/c": "skip"])
    XCTAssertEqual(ScreenStash.values["undecided"], [:])
  }

  /// The console's own answers (`packageDecisions`, replayed in native-site-import-matches-the-console.spec.ts)
  /// for the defaults, the choices and the plan's proposals, through the screen's own expressions.
  func testEveryItemIsDecidedAsTheConsoleDecidesIt() async throws {
    let cases = try XCTUnwrap(
      JSONValue.decode(try Data(contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("site-import-cases.json"))))
    let importing = try spec("core.site.import")
    let model = ScreenModel(spec: importing, context: [:], api: api(RecordingTransport(responses: [])))
    let submit = try XCTUnwrap(importing.blocks.first { $0.id == "package" }?["submit"].flatMap(ActionSpec.init))
    let decide = try XCTUnwrap(submit.after?.action)
    XCTAssertGreaterThan(cases["decisions"].array.count, 5)
    for one in cases["decisions"].array {
      let name = one["name"]?.stringValue ?? ""
      ScreenStash.clear()
      ScreenStash.set(["plan": ["plan": ["items": one["items"] ?? []]], "bulk": one["bulk"] ?? [:], "overrides": one["overrides"] ?? [:]])
      _ = await model.run(decide, in: scope())
      XCTAssertEqual(ScreenStash.values["decisions"], one["expect"]?["decisions"], name)
      XCTAssertEqual(ScreenStash.values["undecided"].objectEntries.map(\.key), one["expect"]?["undecided"].arrayOfStrings, name)
    }
  }

  func testTheMissingItemsComeFromThePlanAndEachAnswerIsSentBackWithTheDecisions() async throws {
    ScreenStash.set([
      "package": ["manifest": ["items": []]],
      "plan": try XCTUnwrap(JSONValue.decode(Data(plan.utf8))),
      "decisions": ["page/a": "merge", "page/b": "create", "page/z": "replace", "email/c": "skip"],
      "depChoices": [:], "merge": [:],
    ])
    let transport = RecordingTransport(responses: [
      (200, reviewed(warnings: dangling, total: 2)),
      (200, reviewed(warnings: #"[{"code":"droppedReference","item":"page/b","dependency":"layout/other","message":"Removed."}]"#, total: 1)),
      (200, reviewed(warnings: #"[{"code":"mappedReference","item":"page/b","dependency":"layout/other","message":"Mapped."}]"#, total: 1)),
    ])
    let review = try spec("core.site.import.review")
    let reviewing = ScreenModel(spec: review, context: [:], api: api(transport))
    let next = try action(review, "next")
    _ = await reviewing.run(next, in: scope())
    let first = try sent(transport, 0)
    XCTAssertEqual(first["action"], "plan")
    XCTAssertEqual(first["hostId"], "h1")
    XCTAssertEqual(first["decisions"]?["page/a"], "merge")
    XCTAssertNil(first["dependencyChoices"])  // nothing answered yet: not sent
    XCTAssertNil(first["mergeChoices"])
    // One prompt per missing item, however many items name it.
    XCTAssertEqual(ScreenStash.values["prompts"].objectEntries.map(\.key), ["layout/other"])
    XCTAssertEqual(ScreenStash.values["warnCodes"], ["danglingReference": "danglingReference"])
    XCTAssertEqual(ScreenStash.values["by"]?["merge"], ["page/a": "page/a"])
    XCTAssertEqual(ScreenStash.values["by"]?["create"], ["page/b": "page/b"])
    XCTAssertEqual(ScreenStash.values["by"]?["replace"], ["page/z": "page/z"])

    let missing = try spec("core.site.import.deps")
    let deps = ScreenModel(spec: missing, context: [:], api: api(transport))
    let prompt: JSONValue = ["key": "layout/other", "value": ["code": "danglingReference", "dependency": "layout/other"]]
    _ = await deps.run(try action(missing, "drop"), in: scope(["item": prompt]))
    XCTAssertEqual(try sent(transport, 1)["dependencyChoices"], ["layout/other": "drop"])
    XCTAssertEqual(ScreenStash.values["depChoices"], ["layout/other": "drop"])
    XCTAssertEqual(ScreenStash.values["warnCodes"], ["droppedReference": "droppedReference"])
    // Importing a missing item is offered only when the file carries it.
    let importIt = try action(missing, "import")
    XCTAssertFalse(ScreenValues.condition(importIt.when, in: scope(["item": prompt])))
    XCTAssertTrue(ScreenValues.condition(importIt.when, in: scope(["item": ["key": "page/b"]])))

    // Pointing at an item the site has sends the id it holds.
    let pick = try spec("core.site.import.pick")
    let picking = ScreenModel(spec: pick, context: [:], api: api(transport))
    _ = await picking.run(
      try action(pick, "use"), in: scope(["params": ["dep": "layout/other", "kind": "layout"], "item": ["$id": "lay1", "kind": "layout"]]))
    XCTAssertEqual(try sent(transport, 2)["dependencyChoices"], ["layout/other": ["mapTo": "lay1"]])
    XCTAssertEqual(ScreenStash.values["depChoices"], ["layout/other": ["mapTo": "lay1"]])
  }

  func testWhatMustBeAcknowledgedFollowsFromWhatTheImportWillDo() async throws {
    ScreenStash.set([
      "package": ["manifest": ["items": []]],
      "decisions": ["page/a": "merge", "page/b": "create", "page/z": "replace", "email/c": "skip"],
      "depChoices": ["layout/other": "drop"],
      "merge": ["page/a": ["title": "package"], "page/b": ["x": "site"]],
      "by": ["merge": ["page/a": "page/a"], "replace": ["page/z": "page/z"], "create": ["page/b": "page/b"]],
      "warnCodes": ["droppedReference": "droppedReference"],
      "review": try XCTUnwrap(JSONValue.decode(Data(reviewed(warnings: dangling, total: 5).utf8))),
    ])
    let apply = try spec("core.site.import.apply")
    let transport = RecordingTransport(responses: [(200, #"{"importId":"i1","written":3,"counts":{},"warnings":[],"warningsTotal":0}"#)])
    let applying = ScreenModel(spec: apply, context: ["site": ["id": "h1"]], api: api(transport))
    await applying.load()
    XCTAssertEqual(applying.context["is"]?["needsAck"], true)
    let write = try action(apply, "apply")
    let ack = try XCTUnwrap(write.prompt.first)
    XCTAssertTrue(ack.coversAll)
    // Overwrites, each class of reference warning, and the warnings that did not fit the list.
    let ids = ack.choices(in: applying.context).map(\.value)
    XCTAssertEqual(ids, ["overwrite", "droppedReference", "moreWarnings"])
    XCTAssertTrue(ack.unmet(["overwrite", "droppedReference"], in: applying.context))
    XCTAssertFalse(ack.unmet(.array(ids.map(JSONValue.string)), in: applying.context))
    XCTAssertTrue(ScreenValues.condition(write.when, in: applying.context))
    XCTAssertFalse(ScreenValues.condition(try action(apply, "applyNow").when, in: applying.context))

    _ = await applying.run(write, in: scope(["form": ["ack": .array(ids.map(JSONValue.string))]]))
    let body = try sent(transport, 0)
    XCTAssertEqual(body["action"], "apply")
    XCTAssertEqual(body["decisions"]?["page/z"], "replace")
    XCTAssertEqual(body["dependencyChoices"], ["layout/other": "drop"])
    // Only an item merged takes its key-by-key choices to the route.
    XCTAssertEqual(body["mergeChoices"], ["page/a": ["title": "package"]])
    XCTAssertEqual(ScreenStash.values["result"]?["importId"], "i1")

    // Nothing written over and no warning: the import needs no acknowledgement.
    ScreenStash.set([
      "decisions": ["page/b": "create"], "by": ["create": ["page/b": "page/b"]], "warnCodes": [:],
      "review": try XCTUnwrap(JSONValue.decode(Data(reviewed(warnings: "[]", total: 0).utf8))),
    ])
    let quiet = ScreenModel(spec: apply, context: ["site": ["id": "h1"]], api: api(transport))
    await quiet.load()
    XCTAssertEqual(quiet.context["is"]?["needsAck"], false)
    XCTAssertTrue(ScreenValues.condition(try action(apply, "applyNow").when, in: quiet.context))
    XCTAssertFalse(ScreenValues.condition(write.when, in: quiet.context))
  }

  func testAnItemShowsEachValueItChangesAndTheKeysAMergeChoosesBetween() async throws {
    ScreenStash.set(["package": ["manifest": ["items": []]], "decisions": ["page/a": "merge"], "merge": ["page/a": ["title": "package"]]])
    let compare = #"""
      {"items":[{"key":"page/a","kind":"page","id":"a","incoming":{"title":"New","seo":{"x":1},"note":"file"},
       "existing":{"id":"a","content":{"title":"Old","seo":{"x":1},"note":""}}}]}
      """#
    let transport = RecordingTransport(responses: [(200, compare)])
    let item = try spec("core.site.import.item")
    let model = ScreenModel(spec: item, context: ["site": ["id": "h1"], "params": ["key": "page/a"]], api: api(transport))
    await model.load()
    let body = try sent(transport, 0)
    XCTAssertEqual(body["action"], "compare")
    XCTAssertEqual(body["keys"], ["page/a"])
    XCTAssertEqual(body["package"], ["manifest": ["items": []]])
    let changes = ScreenValues.lookup("data.diff.changes", in: model.context).array
    XCTAssertEqual(changes.compactMap { $0["label"]?.stringValue }, ["note", "title"])
    // A key the site has not set takes the file's value unless told otherwise.
    let keys = ScreenValues.lookup("data.keys", in: model.context).array
    XCTAssertEqual(keys.compactMap { $0["key"]?.stringValue }, ["note", "title"])
    XCTAssertEqual(keys.first?["merged"], "package")
    XCTAssertEqual(keys.last?["merged"], "site")
    // Choosing whose value a key keeps is kept under the item.
    let choose = try XCTUnwrap(
      item.blocks.first { $0.title == "Choose each value" }?["actions"].array.first.flatMap(ActionSpec.init))
    _ = await model.run(choose, in: scope(["params": ["key": "page/a"], "item": ["key": "note"], "form": ["side": "site"]]))
    XCTAssertEqual(ScreenStash.values["merge"], ["page/a": ["title": "package", "note": "site"]])
  }

  func testADatasetShowsItsRecordsOneValueAtATimeAndAMergeShowsKeys() async throws {
    ScreenStash.set(["package": ["manifest": ["items": []]], "decisions": ["dataset/d": "replace"]])
    let compare = #"""
      {"items":[{"key":"dataset/d","kind":"dataset","id":"d",
       "incoming":{"name":"Leads 2","records":[{"$id":"1","name":"A2"},{"$id":"3","name":"C"}]},
       "existing":{"id":"d","content":{"name":"Leads","records":[{"$id":"1","name":"A"},{"$id":"2","name":"B"}]}}}]}
      """#
    let item = try spec("core.site.import.item")
    let model = ScreenModel(
      spec: item, context: ["site": ["id": "h1"], "params": ["key": "dataset/d"]], api: api(RecordingTransport(responses: [(200, compare)])))
    await model.load()
    let diff = ScreenValues.lookup("data.diff", in: model.context)
    XCTAssertEqual(diff?["recordField"], "records")
    // The values but the records, and then each record value that differs (a record only a side holds, whole).
    XCTAssertEqual(diff?["changes"].array.compactMap { $0["label"]?.stringValue }, ["name"])
    let records = ScreenValues.lookup("data.diff.records.changes", in: model.context).array
    XCTAssertEqual(records.compactMap { $0["label"]?.stringValue }, ["1 › name", "3", "2"])
    XCTAssertEqual(records.compactMap { $0["status"]?.stringValue }, ["changed", "added", "removed"])
    XCTAssertEqual(
      ScreenValues.lookup("data.diff.records.summary", in: model.context),
      "1 new record · 1 changed record · 1 record not in the file · 0 unchanged")
    XCTAssertEqual(ScreenValues.render("{const.recordStatus[@item.status]}", in: ScreenContext.with(model.context, item: records[2])), "Not in the file")
    // Merging shows the keys to choose between in place of the values.
    let merging = ScreenContext.with(model.context, "stash", ["decisions": ["dataset/d": "merge"]])
    let shown = item.blocks.filter { ScreenValues.condition($0.when, in: merging) }.compactMap(\.title)
    XCTAssertTrue(shown.contains("Choose each value"))
    XCTAssertFalse(shown.contains("Values that change"))
    XCTAssertTrue(shown.contains("Records"))
  }

  func testEveryRecordThatDiffersIsHeldAndTheListShowsThemAPageAtATime() async throws {
    ScreenStash.set(["package": ["manifest": ["items": []]], "decisions": ["dataset/d": "replace"]])
    let before = (0..<320).map { #"{"$id":"r\#($0)","name":"A"}"# }.joined(separator: ",")
    let after = (0..<320).map { #"{"$id":"r\#($0)","name":"B"}"# }.joined(separator: ",")
    let compare = #"{"items":[{"key":"dataset/d","kind":"dataset","id":"d","incoming":{"records":[\#(after)]},"existing":{"id":"d","content":{"records":[\#(before)]}}}]}"#
    let item = try spec("core.site.import.item")
    let model = ScreenModel(
      spec: item, context: ["site": ["id": "h1"], "params": ["key": "dataset/d"]], api: api(RecordingTransport(responses: [(200, compare)])))
    await model.load()
    // The console pages through every record; nothing past the values' limit of 200 is dropped.
    XCTAssertEqual(ScreenValues.lookup("data.diff.records.changes", in: model.context).array.count, 320)
    XCTAssertEqual(ScreenValues.lookup("data.diff.records.more", in: model.context), 0)
    let records = try XCTUnwrap(item.blocks.first { $0.title == "Records" })
    XCTAssertEqual(records["page"], 50)
  }

  func testThePickListHoldsOnlyTheSiteItemsOfTheMissingItemsKind() async throws {
    let catalog = #"{"manifest":{"items":[{"$id":"lay1","kind":"layout","name":"Main"},{"$id":"p1","kind":"page","name":"Home"},{"$id":"lay2","kind":"layout","slug":"wide"}]},"kinds":[]}"#
    let pick = try spec("core.site.import.pick")
    let model = ScreenModel(spec: pick, context: ["site": ["id": "h1"], "params": ["dep": "layout/other", "kind": "layout"]], api: api(RoutedTransport([("/api/hosts/export", catalog)])))
    await model.load()
    let rows = ScreenValues.scopes(
      items: "data.catalog.manifest.items", filter: "item.kind == @params.kind", in: model.context)
    XCTAssertEqual(rows.compactMap { ScreenValues.lookup("item.$id", in: $0)?.stringValue }, ["lay1", "lay2"])
    XCTAssertEqual(ScreenValues.render("{params.dep:head} and {params.dep:tail}", in: model.context), "layout and other")
  }
}
