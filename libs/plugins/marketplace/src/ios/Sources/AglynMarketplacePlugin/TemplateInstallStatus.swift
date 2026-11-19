// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * "Update available" on a template this plugin installed (the console's `TemplateInstallStatus`, AGL-671, the
 * `templateInstallStatus` zone on a row of a site's Templates library, AGL-3080). The listing records `latestVersion` and
 * the installed template the version it came from; the comparison is the copy path of `resolveUpdateState`. Updating
 * re-installs through `marketplace/install-template`, so a copy the site edited since installing it loses those edits,
 * which is asked first; pages already created from the template are never touched. The Kotlin plugin's
 * TemplateInstallStatus.kt draws the same.
 */

/// The source type this plugin stamps on the templates it installs (`TEMPLATE_SOURCE_TYPE`).
let marketplaceTemplateSource = "marketplace"

/// The route an update re-installs through: the same `marketplace/install-template` an install uses.
let templateReinstallRoute = "/api/marketplace/install-template"

/// The confirmation before an edited copy is replaced, as the console asks it.
func templateReplaceQuestion(_ name: String) -> (title: String, message: String) {
  (
    "Replace your edited copy?",
    "You have edited \"\(name)\" since installing it. Updating replaces it with the publisher’s latest version, and your "
      + "changes to this template are lost. Pages you already created from it are unaffected."
  )
}

/// What a finished template update says.
func templateUpdatedMessage(version: String) -> String { "Updated to v\(version) — pages you already created are unchanged." }

struct TemplateInstallStatusChip: View {
  let context: NativePluginContext
  @Environment(\.slotProps) private var props
  @State private var listing = ObservedDocument()
  @State private var runner = PluginActionRunner()
  @State private var confirming = false
  @State private var said: String?

  private var listingID: String? { props["sourceType"] == marketplaceTemplateSource ? props["listingId"] : nil }
  private var name: String { props["displayName"] ?? "" }

  /// The template's version against the listing's; nil while the listing is unread, gone or unpublished.
  private var status: (state: String, installed: String?)? {
    guard let doc = listing.document, doc.data["deletedAt"] == nil || doc.data["deletedAt"] is NSNull else { return nil }
    let latest = doc.string("latestVersion") ?? doc.double("latestVersion").map(jsNumberString)
    var source: [String: Any] = ["type": marketplaceTemplateSource]
    if let listingID { source["listingId"] = listingID }
    if let version = props["version"] { source["version"] = version }
    return copyUpdateState(installed: ["source": source], latestVersion: latest, artifactType: "template")
  }

  var body: some View {
    // A stack with a zero-size view in it, never nothing: SwiftUI does not start the task of a view that draws nothing,
    // and the listing is read from that task.
    ZStack {
      Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
      if let status, status.state == "update-available" {
        Button(runner.busy ? "Updating…" : "Update available", systemImage: "arrow.down.circle") {
          if props["edited"] == "true" { confirming = true } else { update() }
        }
        .buttonStyle(.borderless)
        .font(AglynFont.caption)
        .disabled(runner.busy)
        .help("You have v\(status.installed ?? "") · v\(listing.document?.string("latestVersion") ?? "") available")
        .accessibilityLabel("Update \(name)")
        .accessibilityIdentifier("template-update-\(props["templateId"] ?? "")")
      }
    }
    .task(id: listingID) {
      if let listingID { listing.start(context.firestore, [listingsCollection, listingID]) }
    }
    .onDisappear { listing.stop() }
    .alert(templateReplaceQuestion(name).title, isPresented: $confirming) {
      Button("Replace", role: .destructive) { update() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(templateReplaceQuestion(name).message)
    }
    .alert(said ?? runner.error ?? "", isPresented: Binding(get: { said != nil || runner.error != nil }, set: { if !$0 { said = nil; runner.error = nil } })) {
      Button("OK", role: .cancel) {}
    }
  }

  private func update() {
    guard let listingID, let hostID = props["hostId"] else { return }
    runner.run {
      let answer = try await context.api.request(
        templateReinstallRoute, method: .post, body: JSONValue.from(["listingId": listingID, "hostId": hostID]))
      said = templateUpdatedMessage(version: answer?["version"].flatMap { $0.stringValue ?? $0.numberValue.map(jsNumberString) } ?? "")
    }
  }
}
