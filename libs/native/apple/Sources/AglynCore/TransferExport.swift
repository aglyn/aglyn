// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The platform's export, as every console export dialog makes it (the Kotlin
 * kit's `TransferApi`): the resource's fields (`POST /api/transfer/fields`),
 * then the file (`POST /api/transfer/export`) with the fields the person
 * picked, the records it covers, and the format.
 */

public struct TransferFieldInfo: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String
  public let group: String?
  public let description: String?

  public init(id: String, label: String, group: String? = nil, description: String? = nil) {
    self.id = id
    self.label = label
    self.group = group
    self.description = description
  }
}

public struct TransferFieldGroupInfo: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String

  public init(id: String, label: String) {
    self.id = id
    self.label = label
  }
}

public struct TransferFields: Hashable, Sendable {
  public let groups: [TransferFieldGroupInfo]
  public let fields: [TransferFieldInfo]

  public init(groups: [TransferFieldGroupInfo], fields: [TransferFieldInfo]) {
    self.groups = groups
    self.fields = fields
  }

  /// The route's answer, keeping the entries that carry an id.
  public static func decode(_ answer: JSONValue?) -> TransferFields {
    func text(_ value: JSONValue?, _ key: String) -> String? { value?[key]?.stringValue }
    func list(_ key: String) -> [JSONValue] {
      if case .array(let values)? = answer?[key] { return values }
      return []
    }
    return TransferFields(
      groups: list("groups").compactMap { entry in
        text(entry, "id").map { TransferFieldGroupInfo(id: $0, label: text(entry, "label") ?? $0) }
      },
      fields: list("fields").compactMap { entry in
        text(entry, "id").map {
          TransferFieldInfo(
            id: $0, label: text(entry, "label") ?? $0, group: text(entry, "group"),
            description: text(entry, "description"))
        }
      })
  }
}

/// The export file formats (`TransferFormat`).
public enum TransferFormat: String, CaseIterable, Identifiable, Sendable {
  case csv, json, ndjson

  public var id: String { rawValue }
  public var wire: String { rawValue }

  public var label: String {
    switch self {
    case .csv: "CSV, for spreadsheets"
    case .json: "JSON"
    case .ndjson: "NDJSON, one record per line"
    }
  }

  public var mimeType: String {
    switch self {
    case .csv: "text/csv"
    case .json: "application/json"
    case .ndjson: "application/x-ndjson"
    }
  }
}

public struct TransferAPI: Sendable {
  let api: ConsoleAPIClient
  let orgID: String?

  public init(api: ConsoleAPIClient, orgID: String?) {
    self.api = api
    self.orgID = orgID
  }

  public func fieldsBody(resource: String, hostID: String?, filter: JSONValue?) -> JSONValue {
    .object([
      "orgId": orgID.map(JSONValue.string) ?? .null, "resource": .string(resource),
      "hostId": hostID.map(JSONValue.string) ?? .null, "filter": filter ?? .null,
    ])
  }

  /// The body the export route takes: `fieldIDs` in column order, over
  /// `scope` (`{kind: 'all'}`, `{kind: 'filter', filter}` or `{kind: 'selection', ids}`).
  public func exportBody(
    resource: String, hostID: String?, fieldIDs: [String], scope: JSONValue, format: TransferFormat
  ) -> JSONValue {
    .object([
      "orgId": orgID.map(JSONValue.string) ?? .null, "hostId": hostID.map(JSONValue.string) ?? .null,
      "resource": .string(resource), "fieldIds": .array(fieldIDs.map(JSONValue.string)), "scope": scope,
      "format": .string(format.wire), "bom": .bool(format == .csv),
    ])
  }

  public func fields(resource: String, hostID: String?, filter: JSONValue? = nil) async throws -> TransferFields {
    TransferFields.decode(
      try await api.request(
        "/api/transfer/fields", method: .post, body: fieldsBody(resource: resource, hostID: hostID, filter: filter)))
  }

  public func export(
    resource: String, hostID: String?, fieldIDs: [String], scope: JSONValue, format: TransferFormat
  ) async throws -> DownloadedFile {
    try await api.download(
      "/api/transfer/export",
      body: exportBody(resource: resource, hostID: hostID, fieldIDs: fieldIDs, scope: scope, format: format))
  }
}
