// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Setup → Business profile's Business details card (`hostBusinessDetails`, AGL-4136): the one place a site's name, slogan,
/// phone, email, postal address and social links are entered, and every reader (the pages' variables, the email footer, the
/// documents, the structured data) takes them from there. The save is the console's: the canonical `seo.entity.*` paths, the
/// email and the formatted address kept in step in the older `business` copies, a cleared field deleted with its copy
/// (`businessDetailsPayload`). The Kotlin site lib's BusinessDetailsCard.kt.
struct BusinessDetailsCard: View {
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool
  /// The site's draft, where the SEO zone's proposals for the name, email and phone wait for this card.
  let draft: FormDraft
  @State private var fields: [String: String] = [:]
  @State private var links: [SocialLink] = []
  @State private var seeded: (fields: [String: String], links: [SocialLink])?
  @State private var runner = ActionRunner()
  private let contracts = ContractValues.shared

  private var storedFields: [String: String] { businessDetailsForm(host) }
  private var storedLinks: [SocialLink] { socialLinks(of: host) }

  private func field(_ path: String) -> Binding<String> { Binding(get: { fields[path] ?? "" }, set: { fields[path] = $0 }) }

  var body: some View {
    let emailError = businessDetailsEmailError(fields["seo.entity.email"] ?? "")
    let siteName = textAt(host, "displayName").trimmed
    let legacyAddress = businessDetailsLegacyAddress(fields, host: host)
    AglynFormCard(
      "Business details",
      message:
        "Your business’s name and how to reach it. Your pages, emails, documents and search listings all use what you enter here. The business type, opening hours and areas served are under SEO → Local business.",
      dirty: fields != storedFields || links != storedLinks, canSave: canEdit && emailError == nil, busy: runner.busy,
      error: runner.error, notice: runner.notice,
      onDiscard: reset,
      onSave: {
        let payload = businessDetailsPayload(fields, links: links, stored: host)
        runner.run("Saved.") { try await api.save(payload) }
      }
    ) {
      AglynCountedField(
        "Business name", text: field("seo.entity.name"), max: 200,
        supporting: siteName.isEmpty
          ? "As customers know it. Leave it empty to use the site’s name"
          : "As customers know it. Leave it empty to use the site’s name, \(siteName)",
        placeholder: siteName.isEmpty ? nil : siteName, enabled: canEdit)
      AglynCountedField(
        "Slogan", text: field("seo.entity.slogan"), max: contracts.siteSloganMaxLength,
        supporting: "A short line about your business, shown wherever a page uses it", enabled: canEdit)
      AglynCountedField(
        "Phone", text: field("seo.entity.telephone"), max: 64,
        supporting: "As customers should dial it, e.g. +1 512-555-0100. A Call button links it with the Phone link variable",
        keyboard: .phone, enabled: canEdit)
      AglynCountedField(
        "Email", text: field("seo.entity.email"), error: emailError, supporting: "Where customers write to you", keyboard: .email,
        enabled: canEdit)
      AglynCountedField(
        "Street", text: field("seo.entity.address.streetAddress"),
        supporting: legacyAddress.map { "Your site shows “\($0)” now. Enter the address here to replace it" }, enabled: canEdit)
      AglynCountedField("City", text: field("seo.entity.address.addressLocality"), enabled: canEdit)
      AglynCountedField("State or region", text: field("seo.entity.address.addressRegion"), enabled: canEdit)
      AglynCountedField("Postal code", text: field("seo.entity.address.postalCode"), enabled: canEdit)
      AglynCountedField(
        "Country", text: field("seo.entity.address.addressCountry"), supporting: "A country name, or its two-letter code",
        enabled: canEdit)
      Text("Social links").font(AglynFont.strongSubheadline)
      ForEach($links) { $link in
        SocialLinkRow(link: $link, enabled: canEdit) { links.removeAll { $0.id == link.id } }
      }
      Button {
        links.append(SocialLink(label: "", url: ""))
      } label: {
        Label("Add a link", systemImage: "plus")
      }
      .buttonStyle(.borderless)
      .disabled(!canEdit || links.count >= socialLinksMax)
      .accessibilityIdentifier("add-social-link")
      Text("Your pages can link each profile with the Facebook, Instagram, X, LinkedIn, YouTube and TikTok link variables, matched by its address.")
        .font(AglynFont.caption).foregroundStyle(.secondary)
    }
    .accessibilityIdentifier("business-details")
    .onChange(of: storedFields, initial: true) { _, _ in rebase() }
    .onChange(of: storedLinks) { _, _ in rebase() }
    // What the SEO zone proposed for a field this card owns lands here as an unsaved edit, once.
    .onChange(of: draft.version, initial: true) { _, _ in
      if seeded == nil { reset() }
      for (path, value) in draft.take(businessDetailsTextPaths) { fields[path] = value }
    }
  }

  /// A newer copy of the site keeps what was typed and moves every other field to it (AGL-4047).
  private func rebase() {
    guard let seeded else { return reset() }
    fields = rebased(fields, previous: seeded.fields, next: storedFields)
    links = rebased(links, previous: seeded.links, next: storedLinks)
    self.seeded = (storedFields, storedLinks)
  }

  private func reset() {
    fields = storedFields
    links = storedLinks
    seeded = (storedFields, storedLinks)
    runner.clear()
  }
}

/// One social link: its label, its address and a button that removes it.
struct SocialLinkRow: View {
  @Binding var link: SocialLink
  let enabled: Bool
  let remove: () -> Void

  var body: some View {
    HStack(spacing: AglynSpace.one) {
      TextField("Label", text: $link.label).frame(maxWidth: 140)
      urlField
      Button(role: .destructive, action: remove) {
        Image(systemName: "trash")
      }
      .buttonStyle(.borderless)
      .accessibilityLabel("Remove \(link.label.isEmpty ? "this link" : link.label)")
    }
    .disabled(!enabled)
  }

  private var urlField: some View {
    TextField("URL", text: $link.url)
      .autocorrectionDisabled()
      #if os(iOS)
        .textInputAutocapitalization(.never)
        .keyboardType(.URL)
      #endif
  }
}
