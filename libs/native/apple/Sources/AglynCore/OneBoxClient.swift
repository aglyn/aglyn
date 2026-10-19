// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/// The one box's server half (AGL-3943, `GET /api/search`): pages, orders, contacts, emails, components, layouts,
/// templates and every plugin's records that match, grouped by kind, for where the person stands. The workspaces,
/// sites and the app's own screens are matched on the device and merged beside these.
public struct OneBoxClient: Sendable {
  public let api: ConsoleAPIClient

  public init(api: ConsoleAPIClient) { self.api = api }

  /// One query's groups; `group` and `cursor` page one group further ("Show more").
  public func search(
    _ text: String, orgID: String?, hostID: String?, limit: Int? = nil, group: String? = nil, cursor: Int? = nil
  ) async throws -> OneBoxResponse {
    guard let query = oneBoxQuery(text) else { return OneBoxResponse(groups: [], query: text) }
    var parameters: [(String, String?)] = [("q", query), ("orgId", orgID), ("hostId", hostID)]
    if let limit { parameters.append(("limit", String(limit))) }
    if let group { parameters.append(("group", group)) }
    if let cursor { parameters.append(("cursor", String(cursor))) }
    return try await api.request(OneBoxResponse.self, ContractValues.shared.oneBoxSearchPath, query: parameters)
  }
}
