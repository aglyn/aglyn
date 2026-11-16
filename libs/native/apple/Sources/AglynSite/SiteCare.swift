// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/*
 * Site Care's "Request a change" on a site's Home (the console's SiteCareRequestButton, AGL-3959): a workspace with Site
 * Care tells the team what to change in its own words and is told when it will be done; one without it sees the button
 * off with the reason, beside Add Site Care. Routes: /api/site-care/requests (`view=status`, and the POST). The Kotlin
 * site lib's SiteCare.kt.
 */

/// Why Request a change is off on a workspace without Site Care (`SITE_CARE_MISSING_REASON`).
public let siteCareMissingReason = "Site Care is not on this workspace. With it, our team makes your site changes for you."

/// The longest subject and details the console's fields take.
public let siteCareSubjectMax = 150
public let siteCareDetailsMax = 5000

/// What the sheet says once the request is in, with the date the route answered (the console's words).
public func siteCareSentText(_ dueAt: String) -> String {
  "We have your request and will have it done by \(dueAt.isEmpty ? "two business days from now" : dueAt). We will email you when it is done."
}

/// The Site Care requests route for one workspace.
public struct SiteCareAPI: Sendable {
  let api: ConsoleAPIClient
  let orgID: String

  public init(api: ConsoleAPIClient, orgID: String) {
    self.api = api
    self.orgID = orgID
  }

  /// Whether the workspace has Site Care; nil when the route could not say.
  public func hasSiteCare() async -> Bool? {
    guard let answer = try? await api.request("/api/site-care/requests", query: [("orgId", orgID), ("view", "status")]) else { return nil }
    return answer["siteCare"]?.boolValue == true
  }

  /// Sends the request and answers the date it will be done by (empty when the route did not say).
  public func request(hostID: String?, subject: String, body: String) async throws -> String {
    let answer = try await api.request(
      "/api/site-care/requests", method: .post,
      body: jsonBody(["orgId": orgID, "hostId": hostID, "subject": subject, "body": body]))
    return answer?["dueAt"]?.stringValue ?? ""
  }
}

/// Request a change, with the sheet it opens. Draws nothing until the route has said whether the workspace has Site Care.
public struct SiteCareRequestButton: View {
  let api: ConsoleAPIClient
  let orgID: String
  let hostID: String?
  /// Opens the workspace's add-ons (the console's "Add Site Care" link to Billing).
  let onAddSiteCare: () -> Void
  @State private var siteCare: Bool?
  @State private var open = false

  public init(api: ConsoleAPIClient, orgID: String, hostID: String?, onAddSiteCare: @escaping () -> Void) {
    self.api = api
    self.orgID = orgID
    self.hostID = hostID
    self.onAddSiteCare = onAddSiteCare
  }

  public var body: some View {
    Group {
      if let siteCare {
        HStack(spacing: AglynSpace.one) {
          Button("Request a change") { open = true }
            .buttonStyle(.aglynSecondary)
            .disabled(!siteCare)
            .help(siteCare ? "" : siteCareMissingReason)
            .accessibilityHint(siteCare ? "" : siteCareMissingReason)
            .accessibilityIdentifier("site-care-request")
          if !siteCare {
            Button("Add Site Care", action: onAddSiteCare)
              .buttonStyle(.borderless)
              .accessibilityIdentifier("site-care-add")
          }
        }
      }
    }
    .task(id: orgID) { siteCare = await SiteCareAPI(api: api, orgID: orgID).hasSiteCare() }
    .sheet(isPresented: $open) {
      SiteCareRequestSheet(api: SiteCareAPI(api: api, orgID: orgID), hostID: hostID) { open = false }
    }
  }
}

/// The request: what should change, and the details, sent to the team; then when it will be done.
struct SiteCareRequestSheet: View {
  let api: SiteCareAPI
  let hostID: String?
  let close: () -> Void
  @State private var subject = ""
  @State private var details = ""
  @State private var busy = false
  @State private var error: String?
  @State private var sent: String?

  var body: some View {
    if let sent {
      AglynActionSheet(
        "Request a change", confirmLabel: "Done", busy: false, error: nil, onCancel: close, onConfirm: close
      ) {
        AglynNotice(siteCareSentText(sent), tone: .success).accessibilityIdentifier("site-care-sent")
      }
    } else {
      AglynActionSheet(
        "Request a change",
        message: "Tell us what to change, in your own words. Small changes to what your site already has are part of Site Care.",
        confirmLabel: "Send request", confirmEnabled: !subject.trimmed.isEmpty && !details.trimmed.isEmpty, busy: busy, error: error,
        onCancel: close, onConfirm: send
      ) {
        AglynCountedField(
          "What should change?", text: $subject, max: siteCareSubjectMax, required: true, placeholder: "Update our holiday hours")
        AglynCountedField(
          "Details", text: $details, max: siteCareDetailsMax, required: true, multiline: true,
          placeholder: "Saturday becomes 9 to 2 for December, and add a note that we are closed on the 25th.")
      }
    }
  }

  private func send() {
    busy = true
    error = nil
    let (subject, details) = (subject, details)
    Task {
      defer { busy = false }
      do {
        sent = try await api.request(hostID: hostID, subject: subject, body: details)
      } catch let refusal as ConsoleAPIError {
        error = refusal.message.isEmpty ? "The request could not be sent" : refusal.message
      } catch {
        self.error = "An error has occurred"
      }
    }
  }
}
