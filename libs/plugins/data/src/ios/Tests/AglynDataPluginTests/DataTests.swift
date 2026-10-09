// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynDataPlugin

/// The console's own answers (function-cases.generated.json) for the dataset
/// model's ports, the records query plan, the scope wording and the filter
/// chips' operator words: the Kotlin `DataCasesTest`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  XCTAssertFalse(cases.isEmpty, name)
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
  try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed))
}

private func strings(_ value: Any?) -> [String]? { (value as? [Any])?.compactMap { $0 as? String } }

private func text(_ value: Any?) -> String? { value is NSNull ? nil : value as? String }

final class DataCasesTests: XCTestCase {
  func testFormatDatasetValue() throws {
    for item in try functionCases("formatDatasetValue") {
      let field = try decode(DatasetFieldDefinition.self, item.args[0])
      XCTAssertEqual(formatDatasetValue(field, item.args[1]), item.result as? String, "\(item.args)")
    }
  }

  func testDatasetValueToInput() throws {
    for item in try functionCases("datasetValueToInput") {
      let field = try decode(DatasetFieldDefinition.self, item.args[0])
      XCTAssertEqual(datasetValueToInput(field, item.args[1]), item.result as? String, "\(item.args)")
    }
  }

  func testParseDatasetFieldEntries() throws {
    for item in try functionCases("parseDatasetFieldEntries") {
      let expected = (item.result as? [[String: Any]] ?? []).map { [$0["id"] as? String ?? "", $0["name"] as? String ?? ""] }
      XCTAssertEqual(parseDatasetFieldEntries(item.args[0] as? String ?? "").map { [$0.id, $0.name] }, expected, "\(item.args)")
    }
  }

  func testFieldIdRules() throws {
    for item in try functionCases("slugifyDatasetFieldId") {
      XCTAssertEqual(slugifyDatasetFieldId(item.args[0] as? String ?? ""), item.result as? String, "\(item.args)")
    }
    for item in try functionCases("validateDatasetFieldId") {
      XCTAssertEqual(validateDatasetFieldId(item.args[0] as? String ?? "", taken: strings(item.args[1]) ?? []), text(item.result), "\(item.args)")
    }
    for item in try functionCases("defaultDatasetFieldId") {
      XCTAssertEqual(defaultDatasetFieldId(item.args[0] as? String ?? "", taken: strings(item.args[1]) ?? []), item.result as? String, "\(item.args)")
    }
  }

  func testDatasetDisplayName() throws {
    for item in try functionCases("datasetDisplayName") {
      XCTAssertEqual(datasetDisplayName(item.args[0] as? [String: Any]), item.result as? String, "\(item.args)")
    }
  }

  func testEffectiveDatasetModel() throws {
    for item in try functionCases("effectiveDatasetModel") {
      XCTAssertEqual(effectiveDatasetModel(item.args[0] as? [String: Any] ?? [:]), try decode(DatasetModel.self, item.result), "\(item.args)")
    }
  }

  func testPlanDatasetRecordQuery() throws {
    for item in try functionCases("planDatasetRecordQuery") {
      let model = try decode(DatasetModel.self, item.args[0])
      let clauses = try (item.args[1] as? [Any] ?? []).map { try decode(ListFilterRequest.self, $0) }
      let actual = planDatasetRecordQuery(model, clauses: clauses, searchWords: strings(item.args[2]) ?? [])
      let expected = try XCTUnwrap(item.result as? [String: Any])
      let plan = try decode(ListQueryPlan.self, try XCTUnwrap(expected["plan"]))
      let label = "\(item.args)"
      XCTAssertEqual(actual.plan.filters, plan.filters, "filters \(label)")
      XCTAssertEqual(actual.plan.orderBy, plan.orderBy, "order \(label)")
      XCTAssertEqual(actual.plan.searched, plan.searched, "searched \(label)")
      XCTAssertEqual(actual.plan.notices, plan.notices, "plan notices \(label)")
      XCTAssertEqual(actual.notices, strings(expected["notices"]), "notices \(label)")
      let refused = try (expected["refused"] as? [[String: Any]] ?? []).map { entry -> FilterRefusal in
        let clause = entry["clause"]
        return FilterRefusal(
          clause: clause is [String: Any] ? try decode(ListFilterRequest.self, clause as Any) : nil,
          reason: entry["reason"] as? String ?? "")
      }
      XCTAssertEqual(actual.refused, refused, "refused \(label)")
      let filter = try XCTUnwrap(expected["filter"] as? [String: Any])
      XCTAssertEqual(actual.filter.declaration, try decode(ListQueryDeclaration.self, try XCTUnwrap(filter["declaration"])), "declaration \(label)")
      XCTAssertEqual(actual.filter.headers, filter["headers"] as? [String: String], "headers \(label)")
      XCTAssertEqual(actual.filter.selectFields, strings(filter["selectFields"]), "selectFields \(label)")
      let options = (filter["options"] as? [String: [[String: Any]]] ?? [:]).mapValues {
        $0.map { FilterChoice($0["value"] as? String ?? "", $0["label"] as? String ?? "") }
      }
      XCTAssertEqual(actual.filter.options, options, "options \(label)")
    }
  }

  func testScopeWording() throws {
    for item in try functionCases("describeScope") {
      XCTAssertEqual(
        describeScope(strings(item.args[0]), hostNames: item.args[1] as? [String: String] ?? [:]), item.result as? String, "\(item.args)")
    }
    for item in try functionCases("scopeToStore") {
      let answer = scopeToStore(strings(item.args[0]))
      let expected = item.result as? [String: Any]
      XCTAssertEqual(answer.scope, strings(expected?["scope"]), "\(item.args)")
      XCTAssertEqual(answer.problem, text(expected?["problem"]), "\(item.args)")
    }
    for item in try functionCases("narrowsScope") {
      XCTAssertEqual(narrowsScope(strings(item.args[0]), strings(item.args[1])), (item.result as? NSNumber)?.boolValue, "\(item.args)")
    }
  }

  func testOperatorLabels() throws {
    for item in try functionCases("listFilterOperatorLabel") {
      XCTAssertEqual(listFilterOperatorLabel(item.args[0] as? String ?? ""), item.result as? String, "\(item.args)")
    }
  }
}

/// A transport that answers each route from a table and records what was sent.
private final class DataTransport: HTTPTransport, @unchecked Sendable {
  var answers: [String: (Int, String)] = [:]
  var sent: [(path: String, body: JSONValue?)] = []

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let path = request.url?.path ?? ""
    sent.append((path, request.httpBody.flatMap { JSONValue.decode($0) }))
    let (status, body) = answers[path] ?? (200, "{}")
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

private final class RecordingWriter: FirestoreWriter, @unchecked Sendable {
  var updates: [(path: [String], data: [String: Any])] = []
  func merge(_ path: [String], _ data: [String: Any]) async throws {}
  func update(_ path: [String], _ data: [String: Any]) async throws { updates.append((path, data)) }
}

@MainActor
final class DataTests: XCTestCase {
  private let menu = FirestoreDocument(
    id: "ds-menu",
    data: [
      "displayName": "Menu items",
      "names": ["singular": "Menu item", "plural": "Menu items"],
      "visibleTo": ["org"],
      "model": [
        "order": ["name", "price", "category", "supplier"],
        "fields": [
          "name": ["name": "Name", "type": "text", "required": true, "slugFrom": "x"],
          "price": ["name": "Price", "type": "float", "validation": ["min": 0]],
          "category": ["name": "Category", "type": "text", "validation": ["options": ["Bread", "Cake"]]],
          "supplier": ["name": "Supplier", "type": "reference", "reference": ["datasetId": "ds-suppliers", "onDelete": "restrict"]],
        ],
      ],
    ])

  func testRegistersTheDeclaredIDsAndOpensTheConsolePagesNatively() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [
        NativePluginManifestEntry(
          id: "data",
          contributes: [
            "screens": ["data.datasets", "data.records", "data.schema"], "quickActions": ["data.open"], "deepLinks": ["data.page"],
          ], register: registerDataNative)
      ], into: registry)
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(registry.screen("data.datasets")?.requiresSite, false)
    XCTAssertEqual(registry.quickActions(for: .aglyn).map(\.id), ["data.open"])
    XCTAssertEqual(registry.resolve("https://app.aglyn.com/acme/data"), .screen("data.datasets", ["orgSlug": "acme"]))
  }

  func testReadsADatasetAndItsModel() {
    let row = DatasetRow(menu)
    XCTAssertEqual(row.name, "Menu items")
    XCTAssertEqual(row.model.order, ["name", "price", "category", "supplier"])
    XCTAssertEqual(row.model.fields?["price"]?.type, .float)
    XCTAssertEqual(row.visibleTo, ["org"])
    XCTAssertEqual(row.singular, "Menu item")
    let suppliers = DatasetRow(FirestoreDocument(id: "ds-suppliers", data: ["fields": ["company"]]))
    XCTAssertEqual(suppliers.referencedBy([row]).map { [$0.dataset.id, $0.fieldID] }, [["ds-menu", "supplier"]].map { _ in ["ds-menu", "supplier"] })
    // A v1 dataset: the flat columns as text fields.
    XCTAssertEqual(suppliers.model.fields?["company"]?.name, "Company")
  }

  func testListsWhatTheMemberMayList() {
    XCTAssertTrue(datasetsQuery("o", scopeTokens: nil).filters.isEmpty)
    let scoped = datasetsQuery("o", scopeTokens: ["org", "host:h"])
    XCTAssertEqual(scoped.filters.map(\.path), ["visibleTo"])
    XCTAssertEqual(scoped.filters.first?.op, .arrayContainsAny)
    XCTAssertEqual(scoped.path, "orgs/o/datasets")
  }

  func testPagesRecordsByDocumentNameWithTheFiltersOnTheQuery() {
    let model = DatasetRow(menu).model
    let all = recordsQuery("o", "ds-menu", model: model, clauses: [], search: "", limit: 26)
    XCTAssertEqual(all.path, "orgs/o/datasets/ds-menu/records")
    XCTAssertEqual(all.order.map(\.field), ["__name__"])
    let filtered = recordsQuery(
      "o", "ds-menu", model: model, clauses: [ListFilterRequest(field: "values.category", op: "equals", value: "Bread")],
      search: "sour dough", limit: 26)
    XCTAssertTrue(filtered.filters.contains { $0.path == "filterValues.category" && $0.op == .equal })
    XCTAssertTrue(filtered.filters.contains { $0.path == "filterKeys" && $0.op == .arrayContains })
  }

  func testASchemaSaveKeepsTheKeysItDoesNotEdit() {
    let row = DatasetRow(menu)
    var fields = row.model.fields ?? [:]
    var name = fields["name"]!
    name.name = "Title"
    name.required = nil
    fields["name"] = name
    let model = DatasetModel(fields: fields, order: row.model.order)
    let written = (schemaModelJSON(model, rawFields: row.rawFields)["fields"] as? [String: [String: Any]])?["name"]
    XCTAssertEqual(written?["name"] as? String, "Title")
    XCTAssertEqual(written?["slugFrom"] as? String, "x")
    XCTAssertNil(written?["required"])
  }

  func testRecordInputsRoundTripTheEditorsText() {
    let model = DatasetRow(menu).model
    let inputs = recordInputs(model, ["name": "Rye", "price": 7, "category": "Bread"])
    XCTAssertEqual(inputs, ["name": "Rye", "price": "7", "category": "Bread", "supplier": ""])
    let timestamped = DatasetModel(fields: ["at": DatasetFieldDefinition(name: "At", type: .timestamp)], order: ["at"])
    XCTAssertEqual(inputsForWrite(timestamped, ["at": "2026-01-01T09:30"])["at"], "2026-01-01T09:30Z")
    XCTAssertEqual(parseUtcMinute("2026-01-01T09:30"), 1_767_259_800_000)
    XCTAssertEqual(utcMinute(1_767_259_800_000), "2026-01-01T09:30")
    XCTAssertEqual(utcMinute(-1), "1969-12-31T23:59")
  }

  func testARecordReadsByItsFirstValue() {
    let model = DatasetRow(menu).model
    let record = RecordRow(FirestoreDocument(id: "r", data: ["values": ["name": "Rye", "price": 7.5, "category": "Bread"]]))
    XCTAssertEqual(record.title(model), "Rye")
    XCTAssertEqual(record.supporting(model), "Price: 7.5 · Category: Bread")
    XCTAssertEqual(recordValueText(model.fields!["supplier"]!, "x1", choices: []), "x1 (not found)")
  }

  func testWritesGoThroughTheDatasetsRouteAndTheFieldErrorsComeBack() async throws {
    let transport = DataTransport()
    let writer = RecordingWriter()
    let api = DataAPI(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport), writer: writer, orgID: "o")
    transport.answers["/api/orgs/datasets"] = (200, #"{"id":"rec1"}"#)
    let id = try await api.createRecord(datasetID: "ds", values: ["name": "Rye"])
    XCTAssertEqual(id, "rec1")
    XCTAssertEqual(transport.sent.last?.body?["action"]?.stringValue, "create-record")
    XCTAssertEqual(transport.sent.last?.body?["orgId"]?.stringValue, "o")
    XCTAssertEqual(transport.sent.last?.body?["values"]?["name"]?.stringValue, "Rye")
    try await api.deleteRecord(datasetID: "ds", recordID: "rec1")
    XCTAssertEqual(transport.sent.last?.body?["action"]?.stringValue, "delete-record")
    transport.answers["/api/orgs/datasets"] = (400, #"{"error":"Fix the fields.","errors":{"price":"Must be at least 0"}}"#)
    do {
      try await api.updateRecord(datasetID: "ds", recordID: "rec1", values: ["price": "-1"])
      XCTFail("a refused record throws")
    } catch let invalid as RecordInvalid {
      XCTAssertEqual(invalid.errors, ["price": "Must be at least 0"])
    }
    try await api.deleteDataset("ds", hostID: nil)
    XCTAssertEqual(transport.sent.last?.path, "/api/resources/erase")
    XCTAssertEqual(transport.sent.last?.body?["kind"]?.stringValue, "datasets")
    let row = DatasetRow(menu)
    try await api.saveSchema(row, model: row.model, singular: "Menu item", plural: "Menu items", visibleTo: nil)
    XCTAssertEqual(writer.updates.first?.path, ["orgs", "o", "datasets", "ds-menu"])
    XCTAssertEqual(writer.updates.first?.data["displayName"] as? String, "Menu items")
    XCTAssertNil(writer.updates.first?.data["visibleTo"])
  }
}
