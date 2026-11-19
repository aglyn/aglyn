// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

// The "N/M pages on your plan" readout opposite the Pages heading (AGL-2113): the plan's `screensPerHost` from
// `/api/orgs/entitlements`, the count from `/api/hosts/usage`, which counts with `countBillableScreens`, the same rule
// the create route refuses at. The Kotlin kit's PagesQuota.kt.

/// The plan's page cap from the entitlements body; nil for an unlimited plan (`null`) or a body that does not name it.
public func pagesQuotaLimit(_ body: JSONValue?) -> Double? {
  guard case .object(let quotas)? = body?["quotas"], case .number(let cap)? = quotas["screensPerHost"], cap.isFinite else {
    return nil
  }
  return cap
}

/// The site's billable pages from the usage body.
public func pagesUsageCount(_ body: JSONValue?) -> Int? {
  guard case .number(let count)? = body?["screens"], count.isFinite else { return nil }
  return Int(count)
}

@MainActor
@Observable
public final class PagesQuotaModel {
  public private(set) var ready = false
  public private(set) var limit: Double?
  public private(set) var count: Int?
  @ObservationIgnored private var planHost: String?

  public init() {}

  /// The plan, once per site, then the count; the count is asked again whenever the list changes. The site counts as
  /// read only once its plan has answered: a load the list's next change cancels mid-request must not leave a later
  /// load thinking the plan is already in hand (on a phone the cached rows give way to the server's at once).
  public func load(api: ConsoleAPIClient, hostID: String) async {
    if planHost != hostID {
      if planHost != nil {
        ready = false
        limit = nil
        planHost = nil
      }
      if let body = try? await api.request("/api/orgs/entitlements", query: [("hostId", hostID)]), !Task.isCancelled {
        limit = pagesQuotaLimit(body)
        ready = true
        planHost = hostID
      }
    }
    if let body = try? await api.request("/api/hosts/usage", query: [("hostId", hostID)]), !Task.isCancelled {
      count = pagesUsageCount(body) ?? count
    }
  }
}
