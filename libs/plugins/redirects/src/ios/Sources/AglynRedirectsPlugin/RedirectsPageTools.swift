// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * THE REDIRECTS PAGE'S OTHER TOOLS, as the console's page has them
 * (`redirects-console-page.tsx`): Import and Export in its head (Import for
 * "Manage data", Export for whoever reads the rules), the plan's cap as a
 * standing readout under the list (`3/25 redirects on your plan`) with Add
 * redirect refused at it in the page's words, and "Test a path", answered by
 * the console's own matcher (`redirects/test`), whose pattern half is the
 * server's engine. The Kotlin kit's `RedirectsPageTools.kt` is the same contract.
 */

let redirectTestRoute = "/api/redirects/test"

/// The data transfer hub's import screen (core), which the page's Import opens.
let coreDataImportScreen = "core.settings.data.import"

/// The transfer resource the page's Import and Export name (`REDIRECTS_TRANSFER_KEY`).
let redirectsTransferResource = "redirects"

/// The import screen's parameters for this site's rules, as the hub's Redirects row names its target.
func redirectsImportParams(hostID: String?) -> NativeParams {
  var params: NativeParams = ["resource": redirectsTransferResource]
  if let hostID { params["hostId"] = hostID }
  return params
}

/// The page's Export: every rule of the site (`openExport(target)` names no filter), under the dialog's own title.
func redirectsExportRequest(hostID: String?) -> TransferExportRequest {
  TransferExportRequest(
    resource: redirectsTransferResource, title: "Export Redirects", hostID: hostID, scope: ["kind": "all"],
    fileStem: redirectsTransferResource)
}

/// Who sees Import: "Manage data" on the site (or staff), as the console offers it only to whom the transfer route takes it from.
@MainActor
func canImportRedirects(_ context: NativePluginContext) -> Bool {
  context.hostID != nil && (context.can("data.manage") || context.staff != nil)
}

/// Add redirect's refusal at the cap, in the page's words, once the plan is known; nil lets the add through (the route
/// counts again). An unread count counts as none, as the page's does.
func redirectLimitRefusal(planReady: Bool, used: Int?, limit: Double?) -> String? {
  guard planReady, let limit, limit.isFinite, Double(used ?? 0) >= limit else { return nil }
  return "Redirect limit reached (\(Int(limit))) — upgrade in Billing"
}

/// The tester's request: the site and the path as typed.
func redirectTestBody(hostID: String, path: String) -> JSONValue {
  ["hostId": .string(hostID), "path": .string(path)]
}

/// The tester's line from the route's answer: `→ /new-page (301)` or `No rule matches`.
func redirectTestText(_ answer: JSONValue?) -> String? {
  answer?["text"]?.stringValue
}

/// The site's live rule count against the plan's `redirectsPerHost`: the count the create route counts (every rule
/// less the deleted ones, AGL-3918), and the cap `/api/orgs/entitlements` answers (null is unlimited).
@MainActor
@Observable
final class RedirectQuotaModel {
  private(set) var used: Int?
  private(set) var limit: Double?
  private(set) var planReady = false
  @ObservationIgnored private var key: String?

  func load(_ context: NativePluginContext) async {
    guard let hostID = context.hostID, key != hostID else { return }
    key = hostID
    planReady = false
    async let counted = try? await context.firestore.liveCount(["hosts", hostID, "redirects"])
    async let plan = context.api.request("/api/orgs/entitlements", query: [("hostId", hostID)])
    used = (await counted ?? nil) ?? used
    do {
      let answer = try await plan
      if case .object(let quotas)? = answer?["quotas"], case .number(let cap)? = quotas["redirectsPerHost"] {
        limit = cap
      } else {
        limit = nil
      }
      planReady = true
    } catch {
      key = nil
    }
  }

  /// Reads the count again once the list moved: an add spends a slot and a delete frees one.
  func recount(_ context: NativePluginContext) async {
    guard let hostID = context.hostID, key == hostID else { return }
    if let counted = try? await context.firestore.liveCount(["hosts", hostID, "redirects"]) { used = counted }
  }

  /// The readout is the page's once both the plan and the count are in.
  var ready: Bool { planReady && used != nil }
  var refusal: String? { redirectLimitRefusal(planReady: planReady, used: used, limit: limit) }
}

/// Under the list, as on the page: the plan's readout, then "Test a path".
struct RedirectsPageFooter: View {
  let context: NativePluginContext
  let quota: RedirectQuotaModel

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      AglynQuotaReadout(ready: quota.ready, used: quota.used ?? 0, limit: quota.limit, noun: "redirect")
        .accessibilityIdentifier("redirects-quota")
      RedirectPathTester(context: context)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .aglynContentEdges()
    .padding(.vertical, AglynSpace.two)
  }
}

/// "Test a path": what the site's rules do with a path as it is typed, by the serve path's own matcher.
struct RedirectPathTester: View {
  let context: NativePluginContext
  @State private var path = ""
  @State private var answer: String?

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      TextField("Test a path", text: $path, prompt: Text("/old-page"))
        .textFieldStyle(.aglyn)
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
          .keyboardType(.URL)
        #endif
        .accessibilityLabel("Test a path")
        .accessibilityIdentifier("redirects-test-path")
      if !path.trimmingCharacters(in: .whitespaces).isEmpty, let answer {
        Text(answer)
          .font(AglynFont.caption)
          .foregroundStyle(.secondary)
          .accessibilityIdentifier("redirects-test-answer")
      }
    }
    .task(id: path) {
      let typed = path
      guard let hostID = context.hostID, !typed.trimmingCharacters(in: .whitespaces).isEmpty else {
        answer = nil
        return
      }
      // Asked once typing pauses; a newer keystroke cancels this one.
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled else { return }
      do {
        let reply = try await context.api.request(
          redirectTestRoute, method: .post, body: redirectTestBody(hostID: hostID, path: typed))
        guard !Task.isCancelled else { return }
        answer = redirectTestText(reply) ?? "The path could not be tested"
      } catch let failure as ConsoleAPIError where failure.status != 0 {
        if !Task.isCancelled { answer = failure.message }
      } catch {
        if !Task.isCancelled { answer = "The path could not be tested" }
      }
    }
  }
}
