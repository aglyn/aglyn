// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// How many recent jobs the card reads to find this site's guided start (`RECENT_JOBS_READ`).
public let aiRecentJobsRead = 20

/// The SEO form's field names the listing fills (`AI_SITE_SEO_FORM_FIELDS`).
public let aiSiteSeoTitleField = "seo.title"
public let aiSiteSeoDescriptionField = "seo.description"

/// The site's own search listing a guided start proposed: the title and description, and where the words came from.
public struct AiSiteSeoProposal: Equatable, Sendable {
  public let title: String
  public let description: String
  public let notes: [String]

  /// The values for the site SEO form, by field name.
  public var values: [String: String] { [aiSiteSeoTitleField: title, aiSiteSeoDescriptionField: description] }
}

/// The site listing a job's outputs carry, or nil when they carry none (`aiSiteSeoProposalOf`). Read defensively: an output
/// is whatever a past release wrote, so a proposal whose values are not two words is no proposal, rather than staged into
/// somebody's live SEO form.
public func aiSiteSeoProposalOf(_ outputs: JSONValue?) -> AiSiteSeoProposal? {
  for output in outputs?.arrayValue ?? [] {
    guard output["resource"]?.stringValue == "seo", let proposal = output["proposal"], proposal["kind"]?.stringValue == "site-listing"
    else { continue }
    guard let title = proposal["values"]?[aiSiteSeoTitleField]?.stringValue,
      let description = proposal["values"]?[aiSiteSeoDescriptionField]?.stringValue,
      !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { continue }
    let notes = (proposal["notes"]?.arrayValue ?? []).compactMap(\.stringValue)
    return AiSiteSeoProposal(title: title, description: description, notes: notes)
  }
  return nil
}

/// The latest guided-start job for `hostID` that reported a listing, among a jobs route's answer (newest first).
public func aiLatestSiteListing(_ jobs: JSONValue?, hostID: String) -> (jobID: String, proposal: AiSiteSeoProposal)? {
  for job in jobs?["jobs"]?.arrayValue ?? [] {
    guard job["kind"]?.stringValue == "site", job["hostId"]?.stringValue == hostID, let proposal = aiSiteSeoProposalOf(job["outputs"]),
      let id = job["id"]?.stringValue
    else { continue }
    return (id, proposal)
  }
  return nil
}

private func storedSeo(_ seo: [String: Any]?, _ field: String) -> String {
  let key = field.hasPrefix("seo.") ? String(field.dropFirst(4)) : field
  return ((seo?[key] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Whether the site's settings already say what the proposal says. Both values have to match: a site whose title was applied
/// and whose description was then rewritten still has something to take (`aiSiteSeoAlreadySaid`).
public func aiSiteSeoAlreadySaid(_ proposal: AiSiteSeoProposal, seo: [String: Any]?) -> Bool {
  proposal.values.allSatisfy { storedSeo(seo, $0.key) == $0.value.trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// The site's own search listing, from the guided start's answers, on the site's SEO page (the console's `hostSeo` widget).
/// The two answers the guided start asks (what kind of site, and who it is for) are the site-wide search title and description
/// every page without its own falls back to. It writes nothing and asks no model anything: "Put in the form" stages the two
/// values in the SEO form below as unsaved edits and the form's Save is the write. Absent unless a guided start ran here and
/// its listing is not already saved.
struct AiSiteSeoStartCard: View {
  let context: NativePluginContext
  @Environment(\.seoZone) private var zone
  @State private var found: (jobID: String, proposal: AiSiteSeoProposal)?
  @State private var staged = false

  var body: some View {
    Group {
      if let zone, let found, staged || !aiSiteSeoAlreadySaid(found.proposal, seo: zone.seo) {
        Section {
          VStack(alignment: .leading, spacing: 2) {
            Text("Title").font(AglynFont.caption).foregroundStyle(.secondary)
            Text(found.proposal.title)
          }
          VStack(alignment: .leading, spacing: 2) {
            Text("Description").font(AglynFont.caption).foregroundStyle(.secondary)
            Text(found.proposal.description)
          }
          ForEach(found.proposal.notes, id: \.self) { Text($0).font(AglynFont.caption).foregroundStyle(.secondary) }
          Button("Put in the form") {
            zone.proposeDraft(found.proposal.values, "\(found.jobID):site-listing")
            staged = true
          }
          .disabled(staged)
          .accessibilityIdentifier("ai-seo-stage")
          if staged { AglynNotice("In the SEO form below as unsaved changes. Read them, then press Save.", tone: .success) }
        } header: {
          Text("The listing your answers describe")
        } footer: {
          Text(
            "What you said this site is, and who it is for, as the title and description every page without its own falls back to. Nothing is saved until you press Save below."
          )
        }
        .accessibilityIdentifier("ai-site-seo-start")
      }
    }
    .task(id: context.hostID) {
      guard let hostID = context.hostID, let orgID = context.orgID else { return }
      let jobs = try? await context.api.request("/api/ai/jobs", query: [("orgId", orgID), ("limit", String(aiRecentJobsRead))])
      found = aiLatestSiteListing(jobs, hostID: hostID)
    }
  }
}
