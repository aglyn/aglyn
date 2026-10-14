// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// The export picker's catalog, search, presets and reorder, replayed from the cases the console's own functions answer
/// (`libs/native/contracts/transfer-catalog-cases.json`; the Kotlin kit replays the same file).
final class TransferCatalogTests: XCTestCase {
  private func cases() throws -> JSONValue {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("../../../contracts/transfer-catalog-cases.json").standardizedFileURL
    return try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
  }

  private func fields(_ list: JSONValue?) -> [TransferFieldInfo] { list?.arrayValue?.compactMap(TransferFieldInfo.decode) ?? [] }

  private func groups(_ list: JSONValue?) -> [TransferFieldGroupInfo] {
    list?.arrayValue?.compactMap { entry in entry["id"]?.stringValue.map { TransferFieldGroupInfo(id: $0, label: entry["label"]?.stringValue ?? $0) } } ?? []
  }

  private func strings(_ list: JSONValue?) -> [String] { list?.arrayValue?.compactMap(\.stringValue) ?? [] }

  private func list(_ value: JSONValue?) -> [JSONValue] { value?.arrayValue ?? [] }

  private func catalog(_ file: JSONValue) -> TransferFieldCatalog {
    TransferFieldCatalog(fields: fields(file["fields"]), groups: groups(file["groups"]), brand: "Aglyn")
  }

  func testTheFieldsComeInTheConsolesOrderUnderItsGroups() throws {
    let file = try cases()
    let built = catalog(file)
    XCTAssertEqual(built.fields.map(\.id), strings(file["catalog"]?["fieldIds"]))
    XCTAssertEqual(built.groups, groups(file["catalog"]?["groups"]))
    // The Aglyn id is added when the resource does not name it, and never twice when it does.
    XCTAssertEqual(built.field("id")?.label, "Aglyn ID")
    XCTAssertEqual(built.field("id")?.matchKey, true)
    let named = TransferFieldCatalog(fields: fields(file["withId"]?["standard"]), groups: groups(file["groups"]), brand: "Aglyn")
    XCTAssertEqual(named.fields.map(\.id), strings(file["withId"]?["fieldIds"]))
    XCTAssertEqual(named.groups, groups(file["withId"]?["groups"]))
    XCTAssertEqual(named.field("id")?.label, "Record ID")
  }

  func testSearchGroupingSelectionPresetsAndReorderReplayTheConsolesAnswers() throws {
    let file = try cases()
    let built = catalog(file)
    for one in list(file["search"]) {
      let query = one["query"]?.stringValue ?? ""
      XCTAssertEqual(built.search(query).map(\.id), strings(one["ids"]), query)
    }
    XCTAssertGreaterThan(list(file["search"]).count, 5)
    for one in list(file["group"]) {
      let narrowed = one["fieldIds"]?.arrayValue == nil ? nil : strings(one["fieldIds"])
      let got = built.grouped(narrowed)
      let want = list(one["groups"])
      XCTAssertEqual(got.map(\.group.id), want.compactMap { $0["group"]?["id"]?.stringValue })
      XCTAssertEqual(got.map { $0.fields.map(\.id) }, want.map { strings($0["ids"]) })
    }
    for one in list(file["selection"]) {
      let got = built.resolve(selection: strings(one["selected"]), ensure: strings(one["ensure"]))
      XCTAssertEqual(got.fieldIDs, strings(one["expect"]?["fieldIds"]))
      XCTAssertEqual(got.unknown, strings(one["expect"]?["unknown"]))
    }
    for one in list(file["preset"]) {
      let hints = TransferPresetHints(
        matchKeyFieldIDs: strings(one["hints"]?["matchKeyFieldIds"]), minimalFieldIDs: strings(one["hints"]?["minimalFieldIds"]))
      let got: TransferFieldSelection
      if let saved = one["saved"] {
        got = built.resolve(TransferSavedPreset(id: "s", label: "S", fieldIDs: strings(saved["fieldIds"])))
      } else {
        got = built.resolve(try XCTUnwrap(one["preset"]?.stringValue.flatMap(TransferPreset.init(rawValue:))), hints: hints)
      }
      XCTAssertEqual(got.fieldIDs, strings(one["expect"]?["fieldIds"]), "\(one)")
      XCTAssertEqual(got.unknown, strings(one["expect"]?["unknown"]), "\(one)")
    }
    for one in list(file["move"]) {
      XCTAssertEqual(
        moveTransferField(strings(one["ids"]), from: Int(one["from"]?.numberValue ?? 0), to: Int(one["to"]?.numberValue ?? 0)),
        strings(one["expect"]))
    }
  }

  func testTheFieldsAnswerCarriesWhatTheDialogNeeds() {
    let answer: JSONValue = [
      "resource": ["label": "Contacts", "formats": ["csv", "json", "other"], "exportOnly": true],
      "groups": [["id": "contact", "label": "Contact"]],
      "fields": [
        ["id": "email", "label": "Email", "group": "contact", "matchKey": true, "aliases": ["mail"]],
        ["id": "custom:vip", "label": "VIP", "custom": true], ["id": "createdAt", "system": true, "readOnly": true],
      ],
      "presetHints": ["matchKeyFieldIds": ["email"], "minimalFieldIds": ["phone"]],
      "resourcePresets": [["id": "mailchimp", "label": "Mailchimp", "description": "Their layout", "fieldIds": ["email"], "headers": ["email": "Email Address"]]],
      "prefs": [
        "presets": [["id": "preset-1", "label": "Mine", "fieldIds": ["email", "createdAt"]]],
        "export": ["presetId": "preset-1", "fieldIds": ["email"], "format": "json", "bom": true, "scope": "filter"],
      ],
    ]
    let decoded = TransferFields.decode(answer)
    XCTAssertEqual(decoded.resourceLabel, "Contacts")
    XCTAssertEqual(decoded.formats, [.csv, .json])  // a format the app does not know is left out
    XCTAssertTrue(decoded.exportOnly)
    XCTAssertEqual(decoded.fields.map(\.kind), [nil, "Custom", "System"])
    XCTAssertEqual(decoded.fields.first?.aliases, ["mail"])
    XCTAssertEqual(decoded.presetHints, TransferPresetHints(matchKeyFieldIDs: ["email"], minimalFieldIDs: ["phone"]))
    XCTAssertEqual(decoded.resourcePresets.first?.headers, ["email": "Email Address"])
    XCTAssertEqual(decoded.resourcePresets.first?.description, "Their layout")
    XCTAssertEqual(decoded.savedPresets.map(\.label), ["Mine"])
    XCTAssertEqual(decoded.lastExport, TransferExportPrefs(presetID: "preset-1", fieldIDs: ["email"], format: .json, bom: true, scope: "filter"))
    // No resource block means a CSV, importable, with nothing remembered.
    let bare = TransferFields.decode(["fields": [["id": "a"]]])
    XCTAssertEqual(bare.formats, [.csv])
    XCTAssertFalse(bare.exportOnly)
    XCTAssertNil(bare.lastExport)
  }

  private func contacts(last: TransferExportPrefs? = nil, exportOnly: Bool = false) throws -> (TransferFields, TransferFieldCatalog) {
    let file = try cases()
    let info = TransferFields(
      groups: groups(file["groups"]), fields: fields(file["fields"]), resourceLabel: "Contacts", formats: [.csv, .json], exportOnly: exportOnly,
      presetHints: TransferPresetHints(matchKeyFieldIDs: ["name", "email"], minimalFieldIDs: ["phone"]),
      resourcePresets: [TransferSavedPreset(id: "mailchimp", label: "Mailchimp", fieldIDs: ["email", "name"], description: "Their layout", headers: ["email": "Email Address"])],
      savedPresets: [TransferSavedPreset(id: "preset-1", label: "Mine", fieldIDs: ["notes", "gone", "email"])], lastExport: last)
    return (info, TransferFieldCatalog(fields: info.fields, groups: info.groups, brand: "Aglyn"))
  }

  func testTheSheetOpensOnReimportableOrWhereThePersonLeftOff() throws {
    var (info, catalog) = try contacts()
    let first = TransferExportChoice.opening(info, catalog: catalog)
    XCTAssertEqual(first.presetID, "reimportable")
    XCTAssertEqual(first.fieldIDs, ["id", "name", "email", "phone", "notes", "orphan", "custom:vip", "tail"])
    XCTAssertEqual([first.format, first.bom, first.scope] as [AnyHashable], [TransferFormat.csv, false, "all"])
    // A resource nothing is imported into opens on Everything, since none of its fields could be written back.
    (info, catalog) = try contacts(exportOnly: true)
    XCTAssertEqual(TransferExportChoice.opening(info, catalog: catalog).presetID, "everything")
    // The resource's own preset asked for wins over the last choice.
    let asked = TransferExportChoice.opening(info, catalog: catalog, preset: "mailchimp")
    XCTAssertEqual([asked.presetID] + asked.fieldIDs, ["mailchimp", "email", "name"])
    // The last choice comes back, ids that no longer exist set aside, a format the resource lacks replaced by its first.
    (info, catalog) = try contacts(last: TransferExportPrefs(presetID: nil, fieldIDs: ["phone", "gone", "email"], format: .ndjson, bom: true, scope: "filter"))
    let again = TransferExportChoice.opening(info, catalog: catalog, hasFilter: true)
    XCTAssertEqual(again.presetID, "custom")
    XCTAssertEqual(again.fieldIDs, ["phone", "email"])
    XCTAssertEqual(again.unknown, ["gone"])
    XCTAssertEqual([again.format, again.bom, again.scope] as [AnyHashable], [TransferFormat.csv, true, "filter"])
    // A selection leads, then the filter; a last scope of "all" keeps the filter off.
    XCTAssertEqual(TransferExportChoice.opening(info, catalog: catalog, selectionCount: 3, hasFilter: true).scope, "selection")
    (info, catalog) = try contacts(last: TransferExportPrefs(presetID: "everything", fieldIDs: ["email"], format: .json, bom: false, scope: "all"))
    XCTAssertEqual(TransferExportChoice.opening(info, catalog: catalog, hasFilter: true).scope, "all")
    XCTAssertEqual(TransferExportChoice.opening(info, catalog: catalog, hasFilter: false).scope, "all")
  }

  func testChoosingAPresetFillsTheFieldsAndChangingThemMakesTheListHandPicked() throws {
    let (info, catalog) = try contacts()
    var choice = TransferExportChoice.opening(info, catalog: catalog)
    choice.choose(preset: "minimal", catalog: catalog, info: info, saved: info.savedPresets)
    XCTAssertEqual(choice.fieldIDs, ["id", "name", "email", "phone"])
    choice.choose(preset: "preset-1", catalog: catalog, info: info, saved: info.savedPresets)
    XCTAssertEqual(choice.fieldIDs, ["notes", "email"])
    XCTAssertEqual(choice.unknown, ["gone"])
    choice.choose(preset: "mailchimp", catalog: catalog, info: info, saved: info.savedPresets)
    XCTAssertEqual(choice.headers(info), ["email": "Email Address"])
    choice.format = .json
    XCTAssertEqual(choice.headers(info), [:])  // only a CSV carries them
    choice.format = .csv
    choice.pick(["email", "name"])
    XCTAssertEqual(choice.presetID, "custom")
    XCTAssertEqual(choice.headers(info), [:])  // the columns are the fields' labels once a field changes
    XCTAssertEqual(choice.unknown, [])
    XCTAssertNil(choice.prefs.presetID)
    choice.choose(preset: "custom", catalog: catalog, info: info, saved: [])
    XCTAssertEqual(choice.fieldIDs, ["email", "name"])
  }

  func testThePresetPickerListsTheConsolesEntriesInItsOrder() throws {
    let (info, _) = try contacts()
    let options = TransferExportChoice.presetOptions(info, saved: info.savedPresets, brand: "Aglyn")
    XCTAssertEqual(options.map(\.label), ["Everything", "Re-importable", "Minimal", "Mailchimp", "Mine", "Hand-picked"])
    XCTAssertEqual(options[1].description, "The Aglyn ID, the match keys and every field an import can write.")
    XCTAssertEqual(options[3].description, "Their layout")
    XCTAssertEqual(options[4].description, "3 fields")
    XCTAssertEqual(options.last?.description, "The fields as you chose them below.")
    let (exportOnly, _) = try contacts(exportOnly: true)
    XCTAssertEqual(TransferExportChoice.presetOptions(exportOnly, saved: []).prefix(2).map(\.label), ["Everything", "Minimal"])
  }

  func testASavedPresetNeedsANameAndFieldsAndIsRememberedAsTheConsoleRemembersIt() throws {
    let (info, catalog) = try contacts()
    var choice = TransferExportChoice.opening(info, catalog: catalog)
    XCTAssertNil(choice.saving(as: "   ", id: "p"))
    let kept = try XCTUnwrap(choice.saving(as: "  Weekly sync  ", id: "preset-x"))
    XCTAssertEqual(kept, TransferSavedPreset(id: "preset-x", label: "Weekly sync", fieldIDs: choice.fieldIDs))
    XCTAssertEqual(kept.json["label"], "Weekly sync")
    choice.pick([])
    XCTAssertNil(choice.saving(as: "Empty", id: "p"))
    choice.pick(["email"])
    choice.bom = true
    choice.format = .csv
    XCTAssertEqual(
      choice.prefs.json, ["presetId": .null, "fieldIds": ["email"], "format": "csv", "bom": true, "scope": "all"])
  }
}
