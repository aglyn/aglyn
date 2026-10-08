// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Roles the rules let change the host document's settings (admin, editor, author).
private let settingsRoles: Set<String> = ["admin", "editor", "author"]
/// The theme library's actions are an admin's or an editor's (`/api/hosts/theme`).
private let themeLibraryRoles: Set<String> = ["admin", "editor"]

/// The site's setup as the console's Setup pages show it, the section beside
/// the list in a wide window: basic details, SEO, tracking, the theme and the
/// site's emails, every field saved the way the console saves it.
struct SetupScreen: View {
  let context: NativePluginContext
  var initialSection: String?
  @State private var selection: SetupSection?
  @State private var pushed: SetupSection?
  @State private var opened = false

  var body: some View {
    WideLayoutReader { wide in
      if context.hostID == nil {
        AglynEmptyState("Pick a site first", systemImage: SiteSymbols.site)
      } else if wide {
        HStack(spacing: 0) {
          List(selection: $selection) {
            ForEach(SetupSection.allCases) { section in
              AglynRow(section.title, subtitle: section.supporting, systemImage: section.systemImage)
                .tag(section)
                .aglynListRow()
                .accessibilityIdentifier("setup-\(section.id)")
            }
          }
          .aglynListBackground()
          .frame(minWidth: 280, idealWidth: 320, maxWidth: 380)
          Divider()
          Group {
            if let selection {
              SetupDetail(context: context, section: selection).id(selection)
            } else {
              AglynEmptyState("Pick a section to set it up", systemImage: "gearshape")
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { if selection == nil { selection = SetupSection.of(initialSection ?? "details") } }
      } else {
        List {
          ForEach(SetupSection.allCases) { section in
            Button {
              pushed = section
            } label: {
              AglynRow(section.title, subtitle: section.supporting, systemImage: section.systemImage) {
                Image(systemName: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
              }
            }
            .buttonStyle(.plain)
            .aglynListRow()
            .accessibilityIdentifier("setup-\(section.id)")
          }
        }
        .aglynListBackground()
        .navigationDestination(item: $pushed) { section in
          SetupDetail(context: context, section: section).navigationTitle(section.title)
        }
        .onAppear { if pushed == nil, !opened, let initialSection { pushed = SetupSection.of(initialSection); opened = true } }
      }
    }
    .navigationTitle("Setup")
  }
}

/// One section of the setup, over the site's live document.
struct SetupDetail: View {
  let context: NativePluginContext
  let section: SetupSection
  @State private var host = LiveDocument()

  var body: some View {
    Group {
      if let hostID = context.hostID {
        switch host.state {
        case .loading:
          List { SkeletonRows(count: 8) }.aglynListBackground()
        case .failed:
          AglynEmptyState("Could not load this site's setup", systemImage: SiteSymbols.error, message: "Check the connection and try again.")
        case .ready(nil):
          AglynEmptyState("This site is gone", systemImage: SiteSymbols.site)
        case .ready(let doc?):
          sectionForm(doc, hostID: hostID)
        }
      }
    }
    .task(id: context.hostID) { if let id = context.hostID { await host.bind(context.firestore, ["hosts", id]) } }
  }

  private func sectionForm(_ doc: FirestoreDocument, hostID: String) -> some View {
    let canEdit = settingsRoles.contains(context.siteRole ?? "")
    let api = HostSettingsAPI(api: context.api, writer: context.writer, hostID: hostID)
    return Form {
      if !canEdit {
        Section { AglynNotice("You can view this site's setup. Changing it needs the author, editor or admin role.", tone: .info) }
      }
      switch section {
      case .details: DetailsSection(context: context, hostID: hostID, host: doc.data, api: api, canEdit: canEdit)
      case .seo: SeoSection(host: doc.data, api: api, canEdit: canEdit)
      case .tracking: TrackingSection(host: doc.data, api: api, canEdit: canEdit)
      case .theme: ThemeSection(context: context, hostID: hostID, doc: doc, api: api, canEdit: canEdit)
      case .emails: EmailsSection(context: context, hostID: hostID, api: api, canEdit: canEdit)
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle(section.title)
    .accessibilityIdentifier("setup-detail-\(section.id)")
  }
}

// MARK: - Shared cards

@MainActor private func newRunner() -> ActionRunner { ActionRunner(roleHint: "an author, editor or admin") }

/// A text card over host fields: each path's text, saved through `settingsPayload`.
private struct HostTextCard<Content: View>: View {
  let title: String
  let host: [String: Any]
  let paths: [String]
  let api: HostSettingsAPI
  let canEdit: Bool
  var message: String?
  var clearable: Set<String> = []
  var validate: ([String: String]) -> Bool = { _ in true }
  var transform: ([String: String]) -> [String: Any] = { $0 }
  @ViewBuilder let content: (_ field: @escaping (String) -> Binding<String>) -> Content
  @State private var fields: [String: String] = [:]
  @State private var runner = newRunner()

  private var stored: [String: String] { Dictionary(uniqueKeysWithValues: paths.map { ($0, textAt(host, $0)) }) }

  var body: some View {
    AglynFormCard(
      title, message: message, dirty: fields != stored, canSave: canEdit && validate(fields), busy: runner.busy,
      error: runner.error, notice: runner.notice,
      onDiscard: { fields = stored; runner.clear() },
      onSave: {
        let values = transform(fields)
        runner.run("Saved.") { try await api.save(settingsPayload(values, stored: host, clearable: clearable)) }
      }
    ) {
      content { path in Binding(get: { fields[path] ?? "" }, set: { fields[path] = $0 }) }
    }
    .onChange(of: stored, initial: true) { _, next in fields = next }
  }
}

/// A card of one switch or choice that saves the moment it changes.
private struct ImmediateCard<Content: View>: View {
  let title: String
  @ViewBuilder let content: (ActionRunner) -> Content
  @State private var runner = newRunner()

  var body: some View {
    Section(title) {
      content(runner)
      if let error = runner.error { AglynNotice(error, tone: .error) }
    }
  }
}

// MARK: - Basic details

private struct DetailsSection: View {
  let context: NativePluginContext
  let hostID: String
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool

  var body: some View {
    HostTextCard(
      title: "Logo", host: host, paths: ["logoUrl", "logoDarkUrl"], api: api, canEdit: canEdit,
      message: "The brand mark your navigation and error pages show. Paste the address of an image from your media library.",
      clearable: ["logoUrl", "logoDarkUrl"]
    ) { field in
      ForEach([("logoUrl", "Light mode logo"), ("logoDarkUrl", "Dark mode logo")], id: \.0) { path, label in
        HStack(spacing: AglynSpace.oneAndHalf) {
          AglynRemoteImage(URL(string: field(path).wrappedValue).flatMap { $0.scheme?.hasPrefix("http") == true ? $0 : nil }, systemImage: "photo")
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
          AglynCountedField(label, text: field(path), placeholder: "https://…", keyboard: .url, enabled: canEdit)
        }
      }
    }
    BusinessDetailsCard(host: host, api: api, canEdit: canEdit)
    BuiltInLayoutCard(context: context, hostID: hostID, host: host, api: api, canEdit: canEdit)
    LanguagesCard(host: host, api: api, canEdit: canEdit)
  }
}

private struct BusinessDetailsCard: View {
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool
  @State private var email = ""
  @State private var address = ""
  @State private var links: [SocialLink] = []
  @State private var runner = newRunner()

  private var storedEmail: String { textAt(host, "business.supportEmail") }
  private var storedAddress: String { textAt(host, "business.address") }
  private var storedLinks: [SocialLink] { socialLinks(of: host) }

  var body: some View {
    AglynFormCard(
      "Business details", message: "The support email, address and social links your pages and footers show.",
      dirty: email != storedEmail || address != storedAddress || links != storedLinks, canSave: canEdit,
      busy: runner.busy, error: runner.error, notice: runner.notice,
      onDiscard: reset,
      onSave: {
        let (email, address, links) = (email, address, links)
        runner.run("Saved.") {
          try await api.save([
            "business": [
              "supportEmail": email.trimmed,
              "address": address.trimmed,
              "socialLinks": links.filter { !$0.url.trimmed.isEmpty }.map { ["label": $0.label.trimmed, "url": $0.url.trimmed] },
            ] as [String: Any]
          ])
        }
      }
    ) {
      AglynCountedField("Support email", text: $email, keyboard: .email, enabled: canEdit)
      AglynCountedField("Postal address", text: $address, multiline: true, enabled: canEdit)
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
    }
    .onChange(of: storedEmail + "\n" + storedAddress + "\n" + storedLinks.map { $0.label + "\t" + $0.url }.joined(separator: "\n"), initial: true) { _, _ in
      reset()
    }
  }

  private func reset() {
    email = storedEmail
    address = storedAddress
    links = storedLinks
    runner.clear()
  }
}

private struct SocialLinkRow: View {
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

private struct BuiltInLayoutCard: View {
  let context: NativePluginContext
  let hostID: String
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool
  @State private var layouts = LiveQuery()

  var body: some View {
    ImmediateCard(title: "Built-in pages") { runner in
      Text("The layout your site's own pages (search, error fallbacks) wear.").font(AglynFont.subheadline).foregroundStyle(.secondary)
        .aglynTask(id: hostID) { await layouts.bind(context.firestore, FirestoreQuery(["hosts", hostID, "layouts"], limit: 50)) }
      let options = (layouts.state.value ?? [])
        .filter { $0.data["deletedAt"] == nil }
        .map { (id: $0.id, name: $0.string("displayName").flatMap { $0.trimmed.isEmpty ? nil : $0 } ?? "Untitled layout") }
        .sorted { $0.name.lowercased() < $1.name.lowercased() }
      Picker(
        "Layout",
        selection: Binding(
          get: { textAt(host, "builtInPageLayoutId") },
          set: { picked in
            runner.run("Saved.") {
              try await api.save(["builtInPageLayoutId": picked.isEmpty ? FirestoreSentinel.delete as Any : picked])
            }
          })
      ) {
        Text("Same as the home page").tag("")
        ForEach(options, id: \.id) { Text($0.name).tag($0.id) }
      }
      .disabled(!canEdit || runner.busy)
    }
  }
}

private struct LanguagesCard: View {
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool
  @State private var text = ""
  @State private var chosen = ""
  @State private var runner = newRunner()

  private var storedLocales: [String] { (host["locales"] as? [Any])?.compactMap { $0 as? String } ?? [] }
  private var storedDefault: String { textAt(host, "defaultLocale") }

  var body: some View {
    let (parsed, error) = parseLocales(text)
    let effective = parsed.contains(chosen) ? chosen : (parsed.first ?? "")
    AglynFormCard(
      "Languages",
      message:
        "The languages your site serves. Each one gets its own addresses (/fr/…); the default answers the plain ones. More than one language needs the Business plan.",
      dirty: parsed != storedLocales || chosen != storedDefault, canSave: canEdit && error == nil, busy: runner.busy,
      error: runner.error, notice: runner.notice,
      onDiscard: reset,
      onSave: {
        runner.run("Saved.") {
          try await api.save([
            "locales": parsed.isEmpty ? FirestoreSentinel.delete as Any : parsed,
            "defaultLocale": effective.isEmpty ? FirestoreSentinel.delete as Any : effective,
          ])
        }
      }
    ) {
      AglynCountedField(
        "Languages", text: $text, error: error, supporting: "Comma separated, like en, fr, pt-BR", placeholder: "en", enabled: canEdit)
      Picker("Default", selection: Binding(get: { effective }, set: { chosen = $0 })) {
        ForEach(parsed, id: \.self) { Text($0).tag($0) }
      }
      .disabled(!canEdit || parsed.isEmpty)
    }
    .onChange(of: storedLocales.joined(separator: ",") + "|" + storedDefault, initial: true) { _, _ in reset() }
  }

  private func reset() {
    text = storedLocales.joined(separator: ", ")
    chosen = storedDefault
    runner.clear()
  }
}

// MARK: - SEO

private struct SeoSection: View {
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool
  private let contracts = ContractValues.shared

  var body: some View {
    HostTextCard(
      title: "Search appearance", host: host, paths: ["seo.title", "seo.description", "seo.separator", "seo.titlePattern"],
      api: api, canEdit: canEdit, message: "How your site reads in search results and link previews.",
      clearable: ["seo.titlePattern"],
      validate: { f in ["seo.title", "seo.description", "seo.separator"].allSatisfy { !(f[$0] ?? "").trimmed.isEmpty } }
    ) { f in
      AglynCountedField("Title", text: f("seo.title"), max: SeoLimits.title, required: true, enabled: canEdit)
      AglynCountedField("Description", text: f("seo.description"), max: SeoLimits.description, required: true, multiline: true, enabled: canEdit)
      AglynCountedField("Separator", text: f("seo.separator"), max: SeoLimits.separator, required: true, enabled: canEdit)
      AglynCountedField(
        "Page title pattern", text: f("seo.titlePattern"), max: SeoLimits.titlePattern,
        supporting: "Empty uses \(contracts.defaultTitlePattern)", placeholder: contracts.defaultTitlePattern, enabled: canEdit)
    }
    HostTextCard(
      title: "Icons and social image", host: host, paths: ["seo.favicon", "seo.appIcon", "seo.image", "seo.imageAlt"], api: api,
      canEdit: canEdit, message: "Paste the address of each image from your media library."
    ) { f in
      ForEach([("seo.favicon", "Favicon"), ("seo.appIcon", "App icon"), ("seo.image", "Social image")], id: \.0) { path, label in
        HStack(spacing: AglynSpace.oneAndHalf) {
          AglynRemoteImage(URL(string: f(path).wrappedValue).flatMap { $0.scheme?.hasPrefix("http") == true ? $0 : nil }, systemImage: "photo")
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
          AglynCountedField(label, text: f(path), placeholder: "https://…", keyboard: .url, enabled: canEdit)
        }
      }
      AglynCountedField(
        "Image description", text: f("seo.imageAlt"), max: SeoLimits.imageAlt,
        supporting: "What the social image shows, for screen readers", enabled: canEdit)
    }
    HostTextCard(
      title: "Business profile", host: host,
      paths: [
        "seo.entity.type", "seo.entity.name", "seo.entity.description", "seo.entity.url", "seo.entity.email",
        "seo.entity.telephone", "seo.entity.contactType", "seo.entity.logo",
      ], api: api, canEdit: canEdit, message: "Who runs the site, as search engines read it."
    ) { f in
      Picker("This site is run by", selection: f("seo.entity.type")) {
        Text("Not set").tag("")
        ForEach(entityTypes, id: \.value) { Text($0.label).tag($0.value) }
      }
      .disabled(!canEdit)
      AglynCountedField("Name", text: f("seo.entity.name"), enabled: canEdit)
      AglynCountedField("Description", text: f("seo.entity.description"), max: SeoLimits.entityDescription, multiline: true, enabled: canEdit)
      AglynCountedField("Website", text: f("seo.entity.url"), keyboard: .url, enabled: canEdit)
      AglynCountedField("Email", text: f("seo.entity.email"), keyboard: .email, enabled: canEdit)
      AglynCountedField("Telephone", text: f("seo.entity.telephone"), keyboard: .phone, enabled: canEdit)
      AglynCountedField("Contact type", text: f("seo.entity.contactType"), placeholder: "customer service", enabled: canEdit)
      AglynCountedField("Logo", text: f("seo.entity.logo"), placeholder: "https://…", keyboard: .url, enabled: canEdit)
    }
    HostTextCard(
      title: "Business address", host: host, paths: Self.addressFields.map { "seo.entity.address.\($0.0)" }, api: api, canEdit: canEdit
    ) { f in
      ForEach(Self.addressFields, id: \.0) { key, label in
        AglynCountedField(label, text: f("seo.entity.address.\(key)"), enabled: canEdit)
      }
    }
    LocalBusinessCard(host: host, api: api, canEdit: canEdit)
    HostTextCard(
      title: "AI agents", host: host, paths: ["seo.agent.whenToUse", "seo.agent.howToUse"], api: api, canEdit: canEdit,
      message: "What AI assistants read about when and how to send people to your site (llms.txt)."
    ) { f in
      AglynCountedField("When to use this site", text: f("seo.agent.whenToUse"), max: SeoLimits.agent, multiline: true, enabled: canEdit)
      AglynCountedField("How to use this site", text: f("seo.agent.howToUse"), max: SeoLimits.agent, multiline: true, enabled: canEdit)
    }
    VerificationCard(host: host, api: api, canEdit: canEdit)
    ImmediateCard(title: "Search indexing") { runner in
      AglynSwitchRow(
        "Discourage search engines from indexing this site", isOn: valueAt(host, "seo.discourageSearchEngines") as? Bool == true,
        supporting: "Search engines may still index it; most respect the request.", enabled: canEdit && !runner.busy
      ) { on in
        runner.run { try await api.save(["seo": ["discourageSearchEngines": on ? true as Any : FirestoreSentinel.delete]]) }
      }
      .accessibilityIdentifier("seo-discourage")
    }
  }

  private static let addressFields = [
    ("streetAddress", "Street"), ("addressLocality", "City"), ("addressRegion", "Region"), ("postalCode", "Postal code"),
    ("addressCountry", "Country"),
  ]
}

private struct LocalBusinessCard: View {
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool
  @State private var fields: [String: String] = [:]
  @State private var runner = newRunner()
  private let contracts = ContractValues.shared

  private var stored: [String: String] {
    let area = (valueAt(host, "seo.entity.areaServed") as? [Any])?.compactMap { $0 as? String } ?? []
    return [
      "seo.entity.businessType": textAt(host, "seo.entity.businessType"),
      "areaServed": area.joined(separator: "\n"),
      "seo.entity.openingHours": textAt(host, "seo.entity.openingHours"),
      "seo.entity.priceRange": textAt(host, "seo.entity.priceRange"),
      "seo.entity.paymentAccepted": textAt(host, "seo.entity.paymentAccepted"),
    ]
  }

  private func binding(_ key: String) -> Binding<String> { Binding(get: { fields[key] ?? "" }, set: { fields[key] = $0 }) }

  var body: some View {
    let area = (fields["areaServed"] ?? "").split(whereSeparator: \.isNewline).map { String($0).trimmed }.filter { !$0.isEmpty }
    AglynFormCard(
      "Local business",
      message: "For a business customers visit or that serves an area: its kind, where it works and when it is open.",
      dirty: fields != stored, canSave: canEdit && area.count <= contracts.areaServedMax, busy: runner.busy,
      error: runner.error, notice: runner.notice,
      onDiscard: { fields = stored; runner.clear() },
      onSave: {
        var values: [String: Any] = fields
        values["areaServed"] = nil
        values["seo.entity.areaServed"] = area
        runner.run("Saved.") { try await api.save(settingsPayload(values, stored: host)) }
      }
    ) {
      Picker("Kind of business", selection: binding("seo.entity.businessType")) {
        Text("Not a local business").tag("")
        ForEach(contracts.localBusinessTypeOptions, id: \.value) { Text($0.label).tag($0.value) }
      }
      .disabled(!canEdit)
      if !(fields["seo.entity.businessType"] ?? "").isEmpty {
        AglynCountedField(
          "Areas served", text: binding("areaServed"), multiline: true,
          error: area.count > contracts.areaServedMax ? "At most \(contracts.areaServedMax) places" : nil,
          supporting: "One place per line, up to \(contracts.areaServedMax)", enabled: canEdit)
        AglynCountedField(
          "Opening hours", text: binding("seo.entity.openingHours"), multiline: true,
          supporting: "One line per day or range, like Mo-Fr 09:00-17:00", enabled: canEdit)
        AglynCountedField(
          "Price range", text: binding("seo.entity.priceRange"), max: contracts.priceRangeMaxLength, placeholder: "$$", enabled: canEdit)
        AglynCountedField(
          "Payment accepted", text: binding("seo.entity.paymentAccepted"), max: contracts.paymentAcceptedMaxLength,
          placeholder: "Cash, Credit Card", enabled: canEdit)
      }
    }
    .onChange(of: stored, initial: true) { _, next in fields = next }
  }
}

private struct VerificationCard: View {
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool
  private let contracts = ContractValues.shared
  private let engines = ["google", "bing"]

  var body: some View {
    let paths = engines.map { "seo.verification.\($0)" }
    HostTextCard(
      title: "Search engine verification", host: host, paths: paths, api: api, canEdit: canEdit,
      message: "Paste the verification code, or the whole meta tag, from each tool.", clearable: Set(paths),
      validate: { f in
        engines.allSatisfy {
          verificationError($0, f["seo.verification.\($0)"], metaNames: contracts.searchEngineVerificationMetaNames, labels: contracts.searchEngineVerificationLabels)
            == nil
        }
      },
      transform: { f in f.mapValues { extractVerificationToken($0) } }
    ) { f in
      ForEach(engines, id: \.self) { engine in
        AglynCountedField(
          contracts.searchEngineVerificationLabels[engine] ?? engine, text: f("seo.verification.\(engine)"),
          error: verificationError(
            engine, f("seo.verification.\(engine)").wrappedValue, metaNames: contracts.searchEngineVerificationMetaNames,
            labels: contracts.searchEngineVerificationLabels), enabled: canEdit)
      }
    }
  }
}

// MARK: - Tracking

private struct TrackingSection: View {
  let host: [String: Any]
  let api: HostSettingsAPI
  let canEdit: Bool

  var body: some View {
    HostTextCard(
      title: "Analytics and ad tags", host: host, paths: trackingFields.map(\.path), api: api, canEdit: canEdit,
      message: "The IDs your pages load analytics and ad tags with, after a visitor allows it.",
      clearable: Set(trackingFields.map(\.path)),
      validate: { f in trackingFields.allSatisfy { trackingError($0, f[$0.path] ?? "") == nil } }
    ) { f in
      ForEach(trackingFields, id: \.path) { field in
        AglynCountedField(
          field.label, text: f(field.path), error: trackingError(field, f(field.path).wrappedValue), placeholder: field.example,
          enabled: canEdit)
      }
    }
    ImmediateCard(title: "Consent banner") { runner in
      let asks = valueAt(host, "consent.disabled") as? Bool != true
      let mode = consentMode(host)
      let hasAnalytics = !textAt(host, "analytics.gaMeasurementId").trimmed.isEmpty
      AglynSwitchRow(
        "Ask visitors for consent before loading analytics", isOn: asks, enabled: canEdit && !runner.busy
      ) { on in
        runner.run { try await api.save(["consent": ["disabled": on ? FirestoreSentinel.delete : true as Any]]) }
      }
      .accessibilityIdentifier("consent-asks")
      if asks {
        Text("Who is asked").font(AglynFont.strongSubheadline)
        ForEach(
          [
            ("geo", "Where the law requires it", "Visitors from regions with consent laws are asked; others are not."),
            ("strict", "Everyone", "Every visitor is asked before anything loads."),
          ], id: \.0
        ) { value, label, supporting in
          Button {
            runner.run { try await api.save(["consent": ["mode": value]]) }
          } label: {
            AglynRow(label, subtitle: supporting) {
              Image(systemName: mode == value ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(mode == value ? AglynColor.tint : Color.secondary)
            }
          }
          .buttonStyle(.plain)
          .disabled(!canEdit || runner.busy)
          .accessibilityAddTraits(mode == value ? .isSelected : [])
          .accessibilityIdentifier("consent-mode-\(value)")
        }
        AglynSwitchRow(
          "Ask about advertising too", isOn: valueAt(host, "consent.advertising") as? Bool == true,
          supporting: hasAnalytics ? "Adds an advertising choice for Google's ad features." : "Set a Google Analytics ID first.",
          enabled: canEdit && hasAnalytics && !runner.busy
        ) { on in
          runner.run { try await api.save(["consent": ["advertising": on ? true as Any : FirestoreSentinel.delete]]) }
        }
      }
    }
  }
}

// MARK: - Theme

private struct NamingTarget: Identifiable {
  let id = UUID()
  let themeID: String?
  var name: String
}

/// What the theme page loads once: the editor's controls, what they show, and the built-in themes.
private struct ThemeLoaded: Equatable {
  var catalog: ThemeCatalog
  var stored: ThemeValues
  var presets: [ThemePreset]
}

private struct ThemeSection: View {
  let context: NativePluginContext
  let hostID: String
  let doc: FirestoreDocument
  let api: HostSettingsAPI
  let canEdit: Bool
  @State private var load: LiveValue<ThemeLoaded> = .loading
  @State private var attempt = 0

  var body: some View {
    ThemeLibraryCard(
      context: context, hostID: hostID, host: doc.data, api: api, presets: load.value?.presets ?? [],
      canManage: themeLibraryRoles.contains(context.siteRole ?? ""), reloadKey: reloadKey, reload: { await reload() })
    ThemeEditorCard(
      api: api, canEdit: canEdit, load: load, retry: { attempt += 1 },
      saved: { values in
        if var loaded = load.value {
          loaded.stored = values
          load = .ready(loaded)
        }
      })
  }

  private func reload() async {
    do {
      let (catalog, stored, presets) = try await api.themeEditor()
      load = .ready(ThemeLoaded(catalog: catalog, stored: stored, presets: presets))
    } catch is CancellationError {
    } catch {
      load = .failed((error as? ConsoleAPIError)?.message ?? "The theme could not be loaded.")
    }
  }

  /// What reloads the editor: the site document changing under it.
  private var reloadKey: String { "\(attempt)-\(doc.date("updatedAt")?.timeIntervalSince1970 ?? 0)-\(hasThemeEdits(doc.data))" }
}

private struct ThemeLibraryCard: View {
  let context: NativePluginContext
  let hostID: String
  let host: [String: Any]
  let api: HostSettingsAPI
  let presets: [ThemePreset]
  let canManage: Bool
  let reloadKey: String
  let reload: () async -> Void
  @State private var saved = LiveQuery()
  @State private var runner = newRunner()
  @State private var naming: NamingTarget?
  @State private var deleting: SavedTheme?

  var body: some View {
    let selection = themeSelection(of: host)
    let edited = hasThemeEdits(host)
    Section("Your theme") {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(selection.name ?? (selection.kind == "default" ? "Default theme" : "Custom theme")).font(AglynFont.headline)
            .aglynTask(id: reloadKey) { await reload() }
          Text(selectionDetail(selection) + (edited ? " · with your edits" : "")).font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        Spacer()
        Menu {
          Button("Save as a custom theme", systemImage: "square.on.square") { naming = NamingTarget(themeID: nil, name: "") }
            .disabled(!canManage)
          Button("Update the saved theme", systemImage: "checkmark") {
            runner.run("The saved theme now has your edits.") { try await api.updateSavedTheme() }
          }
          .disabled(!canManage || !edited || selection.kind != "custom")
          Button("Undo all edits", systemImage: "arrow.uturn.backward") {
            runner.run("Edits undone.") { try await api.restoreTheme() }
          }
          .disabled(!canManage || !edited)
          Button("Use the default theme", systemImage: "arrow.clockwise") {
            runner.run("Switched to the default theme.") { try await api.selectTheme(kind: "default") }
          }
          .disabled(!canManage || selection.kind == "default")
        } label: {
          Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Theme actions")
        .menuStyle(.borderlessButton)
        .fixedSize()
      }
      if let error = runner.error, naming == nil, deleting == nil { AglynNotice(error, tone: .error) }
      if let notice = runner.notice { AglynNotice(notice, tone: .success) { runner.clear() } }
    }
    if !presets.isEmpty {
      Section("Built-in themes") {
        ForEach(presets) { preset in
          let current = selection.kind == "preset" && selection.id == preset.id
          AglynRow(preset.name, subtitle: preset.description) {
            HStack(spacing: AglynSpace.one) {
              ThemeSwatches(colors: preset.swatches)
              if current {
                StatusChip("In use", tone: .success)
              } else {
                Button("Use") {
                  runner.run("Switched to \(preset.name).") { try await api.selectTheme(kind: "preset", id: preset.id) }
                }
                .buttonStyle(.borderless)
                .disabled(!canManage || runner.busy)
              }
            }
          }
          .accessibilityIdentifier("preset-\(preset.id)")
        }
      }
    }
    Section("Saved themes") {
      switch saved.state {
      case .loading: SkeletonRows(count: 2)
      case .failed: Text("Saved themes could not be loaded.").foregroundStyle(.secondary)
      case .ready(let docs):
        let themes = docs.map(SavedTheme.init)
        if themes.isEmpty { Text("None yet. Save your theme to switch back to it later.").foregroundStyle(.secondary) }
        ForEach(themes) { theme in
          let current = selection.kind == "custom" && selection.id == theme.id
          AglynRow(theme.name, systemImage: "paintpalette") {
            HStack(spacing: AglynSpace.one) {
              if current {
                StatusChip("In use", tone: .success)
              } else {
                Button("Use") { runner.run("Switched to \(theme.name).") { try await api.selectTheme(kind: "custom", id: theme.id) } }
                  .buttonStyle(.borderless)
                  .disabled(!canManage || runner.busy)
              }
              Menu {
                Button("Rename", systemImage: "pencil") { naming = NamingTarget(themeID: theme.id, name: theme.name) }
                  .disabled(!canManage)
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = theme }
                  .disabled(!canManage || current)
              } label: {
                Image(systemName: "ellipsis.circle")
              }
              .accessibilityLabel("Actions for \(theme.name)")
              .menuStyle(.borderlessButton)
              .fixedSize()
            }
          }
          .accessibilityIdentifier("saved-theme-\(theme.id)")
        }
      }
    }
    .task(id: hostID) {
      await saved.bind(
        context.firestore,
        FirestoreQuery(["hosts", hostID, "themes"], order: [.init("__name__")], limit: themeLibraryMaxCustom + 1))
    }
    .sheet(item: $naming) { target in
      NameThemeSheet(target: target, runner: runner, api: api) { naming = nil }
    }
    .sheet(item: $deleting) { theme in
      AglynActionSheet(
        "Delete \(theme.name)?", message: "Your site keeps its current look.", confirmLabel: "Delete", destructive: true,
        busy: runner.busy, error: runner.error, onCancel: { deleting = nil },
        onConfirm: { runner.run("Deleted.", onDone: { deleting = nil }) { try await api.deleteTheme(theme.id) } }
      ) { EmptyView() }
    }
  }

  private func selectionDetail(_ selection: ThemeSelection) -> String {
    switch selection.kind {
    case "preset": "A built-in theme"
    case "custom": "One of your saved themes"
    case "installed": "Installed from the marketplace"
    default: "The platform's own theme"
    }
  }
}

/// A preset's colors as small dots.
private struct ThemeSwatches: View {
  let colors: [String]

  var body: some View {
    HStack(spacing: -4) {
      ForEach(Array(colors.enumerated()), id: \.offset) { _, css in
        Circle()
          .fill(Color(aglynCSS: css))
          .overlay(Circle().strokeBorder(AglynColor.divider))
          .frame(width: 16, height: 16)
      }
    }
    .accessibilityHidden(true)
  }
}

private struct NameThemeSheet: View {
  let target: NamingTarget
  let runner: ActionRunner
  let api: HostSettingsAPI
  let close: () -> Void
  @State private var name = ""

  var body: some View {
    AglynActionSheet(
      target.themeID == nil ? "Save as a custom theme" : "Rename theme", confirmLabel: "Save",
      confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy, error: runner.error, onCancel: close,
      onConfirm: {
        let name = name
        runner.run("Saved.", onDone: close) {
          if let id = target.themeID { try await api.renameTheme(id, name: name) } else { try await api.saveThemeAs(name) }
        }
      }
    ) {
      TextField("Name", text: Binding(get: { name }, set: { name = $0.capped(themeNameMax) }))
    }
    .onAppear { name = target.name }
  }
}

private struct ThemeEditorCard: View {
  let api: HostSettingsAPI
  let canEdit: Bool
  let load: LiveValue<ThemeLoaded>
  let retry: () -> Void
  let saved: (ThemeValues) -> Void

  var body: some View {
    switch load {
    case .loading:
      Section("Theme editor") { SkeletonRows(count: 4) }
    case .failed(let message):
      Section("Theme editor") {
        AglynNotice(message, tone: .error)
        Button("Try again", action: retry)
      }
    case .ready(let loaded):
      ThemeEditorForm(api: api, canEdit: canEdit, catalog: loaded.catalog, stored: loaded.stored, saved: saved)
    }
  }
}

private struct ThemeEditorForm: View {
  let api: HostSettingsAPI
  let canEdit: Bool
  let catalog: ThemeCatalog
  let stored: ThemeValues
  let saved: (ThemeValues) -> Void
  @State private var draft: ThemeValues
  @State private var scheme: String
  @State private var browsingFonts = false
  @State private var runner = newRunner()

  init(api: HostSettingsAPI, canEdit: Bool, catalog: ThemeCatalog, stored: ThemeValues, saved: @escaping (ThemeValues) -> Void) {
    self.api = api
    self.canEdit = canEdit
    self.catalog = catalog
    self.stored = stored
    self.saved = saved
    _draft = State(initialValue: stored)
    _scheme = State(initialValue: catalog.schemes.first ?? "light")
  }

  var body: some View {
    let edits = themeEdits(from: stored, to: draft)
    let badColor = draft.colors.values.flatMap { $0.values }.contains { value in
      if let value, !value.trimmed.isEmpty { return !isHexColor(value) }
      return false
    }
    AglynFormCard(
      "Theme editor", message: "Changes apply to every page once saved. Clear a color to use the theme's own.",
      dirty: !edits.isEmpty, canSave: canEdit && !badColor, busy: runner.busy, error: runner.error, notice: runner.notice,
      onDiscard: { draft = stored; runner.clear() },
      onSave: {
        runner.run("Theme saved.") {
          let values = try await api.saveTheme(edits)
          saved(values)
        }
      }
    ) {
      Picker("Scheme", selection: $scheme) {
        ForEach(catalog.schemes, id: \.self) { Text($0.prefix(1).uppercased() + $0.dropFirst()).tag($0) }
      }
      .pickerStyle(.segmented)
      ForEach([("palette", "Colors"), ("surface", "Background and text"), ("tint", "Tints"), ("divider", "Lines")], id: \.0) { group, label in
        let controls = catalog.colors.filter { $0.group == group }
        if !controls.isEmpty {
          Text(label).font(AglynFont.strongSubheadline)
          ForEach(controls, id: \.token) { control in
            AglynColorField(control.label, hex: colorBinding(control.token), enabled: canEdit)
          }
        }
      }
      Picker(catalog.darkSchemeLabel, selection: $draft.darkScheme) {
        ForEach(catalog.darkSchemeOptions, id: \.value) { Text($0.label).tag($0.value) }
      }
      .disabled(!canEdit)
      Button {
        browsingFonts = true
      } label: {
        LabeledContent("Font family") {
          HStack(spacing: 4) {
            Text(draft.fontFamily == catalog.systemFont ? "The theme's own" : draft.fontFamily).foregroundStyle(.secondary)
            Image(systemName: "chevron.right").imageScale(.small).foregroundStyle(.tertiary)
          }
        }
      }
      .buttonStyle(.plain)
      .disabled(!canEdit)
      .accessibilityIdentifier("font-family")
      .sheet(isPresented: $browsingFonts) {
        FontBrowserSheet(catalog: catalog, selection: draft.fontFamily) { draft.fontFamily = $0 }
      }
      ThemeNumberField(range: catalog.borderRadius, value: $draft.borderRadius, enabled: canEdit)
      ThemeNumberField(range: catalog.spacing, value: $draft.spacing, enabled: canEdit)
      ThemeNumberField(range: catalog.navHeightXs, value: $draft.navHeightXs, enabled: canEdit)
      ThemeNumberField(range: catalog.navHeightSm, value: $draft.navHeightSm, enabled: canEdit)
    }
    .onChange(of: stored) { _, next in draft = next }
  }
}

extension ThemeEditorForm {
  fileprivate func colorBinding(_ token: String) -> Binding<String> {
    Binding<String>(
      get: {
        let held: String?? = draft.colors[scheme]?[token]
        return (held ?? nil) ?? ""
      },
      set: { hex in
        var colors = draft.colors[scheme] ?? [:]
        let next: String? = hex.isEmpty ? nil : hex
        colors[token] = .some(next)
        draft.colors[scheme] = colors
      })
  }
}

/// The Google Fonts catalog as a searchable list by category: pick one for the theme, or the theme's own.
private struct FontBrowserSheet: View {
  let catalog: ThemeCatalog
  let selection: String
  let pick: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var search = ""
  @State private var category = "all"

  var body: some View {
    NavigationStack {
      let fonts = filterFonts(catalog.fonts, search: search, category: category == "all" ? nil : category)
      List {
        Section {
          row("The theme's own", detail: nil, family: catalog.systemFont)
        }
        Section("\(fonts.count) \(fonts.count == 1 ? "font" : "fonts")") {
          ForEach(fonts, id: \.family) { font in
            row(font.family, detail: fontCategories.first { $0.value == font.category }?.label ?? font.category, family: font.family)
          }
        }
      }
      .safeAreaInset(edge: .top, spacing: 0) {
        AglynChipRow(
          [AglynChipOption("all", "All")] + fontCategories.map { AglynChipOption($0.value, $0.label) }, selected: category
        ) { category = $0 }
        .background(.bar)
      }
      .searchable(text: $search, prompt: "Search fonts")
      .navigationTitle("Font family")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
    }
    .frame(minWidth: 380, minHeight: 480)
  }

  private func row(_ title: String, detail: String?, family: String) -> some View {
    Button {
      pick(family)
      dismiss()
    } label: {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(title)
          if let detail { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
        }
        Spacer()
        if family == selection { Image(systemName: "checkmark").foregroundStyle(AglynColor.tint) }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(family == selection ? .isSelected : [])
    .accessibilityIdentifier("font-\(family)")
  }
}

private struct ThemeNumberField: View {
  let range: ThemeRange
  @Binding var value: Double?
  let enabled: Bool
  @State private var text = ""

  var body: some View {
    AglynCountedField(
      range.label,
      text: Binding(
        get: { text },
        set: { next in
          text = next
          let parsed = parseThemeNumber(next, in: range)
          if next.trimmed.isEmpty { value = nil } else if let number = parsed.value { value = number }
        }),
      error: parseThemeNumber(text, in: range).error, supporting: "\(range.min)–\(range.max); empty uses the theme's own",
      keyboard: .number, enabled: enabled
    )
    .onChange(of: value, initial: true) { _, next in
      if parseThemeNumber(text, in: range).value != next { text = formatThemeNumber(next) }
    }
  }
}

// MARK: - Emails

private struct EmailsSection: View {
  let context: NativePluginContext
  let hostID: String
  let api: HostSettingsAPI
  let canEdit: Bool
  @State private var templates = LiveQuery()
  @State private var org = LiveDocument()
  @State private var runner = newRunner()
  @State private var resetting: TenantEmailEntry?
  private let contracts = ContractValues.shared

  @ViewBuilder private var rows: some View {
    let enabled = (org.state.value ?? nil).flatMap { $0.data["enabledPlugins"] as? [Any] }?.compactMap { $0 as? String }
    let stored = Dictionary((templates.state.value ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let groups = Self.grouped(contracts.tenantEmails)
    Section {
      Text("The emails your site sends customers. A customized email uses your design; the rest send their default.")
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
        .aglynTask(id: hostID) {
          await templates.bind(context.firestore, FirestoreQuery(["hosts", hostID, contracts.tenantEmailCollection], limit: 100))
        }
        .aglynTask(id: context.orgID) { if let orgID = context.orgID { await org.bind(context.firestore, ["orgs", orgID]) } }
        .background(Color.clear.sheet(item: resetBinding) { item in resetSheet(item.entry) })
      if let error = runner.error, resetting == nil { AglynNotice(error, tone: .error) }
      if let notice = runner.notice { AglynNotice(notice, tone: .success) { runner.clear() } }
    }
    ForEach(groups, id: \.plugin) { group in
      let pluginOn = enabled == nil || (group.rows.first?.pluginId).map { enabled?.contains($0) ?? true } ?? true
      Section(group.plugin) {
        if !pluginOn { Text("Turn on the \(group.plugin) plugin to send these.").font(AglynFont.subheadline).foregroundStyle(.secondary) }
        ForEach(group.rows, id: \.key) { entry in
          emailRow(entry, versionID: stored[entry.key ?? ""]?.string("versionId").flatMap { $0.isEmpty ? nil : $0 }, pluginOn: pluginOn)
        }
      }
    }
  }

  var body: some View {
    rows
  }

  private var resetBinding: Binding<IdentifiedEmail?> {
    Binding(get: { resetting.map { IdentifiedEmail(entry: $0) } }, set: { if $0 == nil { resetting = nil } })
  }

  private func resetSheet(_ entry: TenantEmailEntry) -> some View {
    AglynActionSheet(
      "Reset \(entry.name ?? "this email")?",
      message: "It sends the default design again. Your design stays in its version history.", confirmLabel: "Reset",
      destructive: true, busy: runner.busy, error: runner.error, onCancel: { resetting = nil },
      onConfirm: {
        runner.run("\(entry.name ?? "The email") sends its default again.", onDone: { resetting = nil }) {
          try await api.resetEmail(entry.key ?? "")
        }
      }
    ) { EmptyView() }
  }

  @ViewBuilder
  private func emailRow(_ entry: TenantEmailEntry, versionID: String?, pluginOn: Bool) -> some View {
    AglynRow(entry.name ?? entry.key ?? "", subtitle: entry.description, systemImage: "envelope") {
      HStack(spacing: AglynSpace.one) {
        switch entry.control {
        case .external: StatusChip("Edited in \(entry.authoredIn ?? "its plugin")")
        case .fixed: StatusChip("Not customizable yet")
        default:
          if let versionID {
            StatusChip("Customized", tone: .success)
            Button("Edit") { context.openBesigner("/emails/\(entry.key ?? "")/versions/\(versionID)/besigner") }
              .buttonStyle(.borderless)
              .disabled(!pluginOn)
            Menu {
              Button("Reset to default", systemImage: "arrow.uturn.backward", role: .destructive) { resetting = entry }
                .disabled(!canEdit || !pluginOn)
            } label: {
              Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Actions for \(entry.name ?? "this email")")
            .menuStyle(.borderlessButton)
            .fixedSize()
          } else {
            StatusChip("Default")
          }
        }
      }
    }
    .accessibilityIdentifier("email-\(entry.key ?? "")")
  }

  /// The emails grouped by their plugin, in the catalog's order.
  static func grouped(_ entries: [TenantEmailEntry]) -> [(plugin: String, rows: [TenantEmailEntry])] {
    var order: [String] = []
    var rows: [String: [TenantEmailEntry]] = [:]
    for entry in entries {
      let plugin = entry.plugin ?? "Other"
      if rows[plugin] == nil { order.append(plugin) }
      rows[plugin, default: []].append(entry)
    }
    return order.map { ($0, rows[$0] ?? []) }
  }
}

private struct IdentifiedEmail: Identifiable {
  let entry: TenantEmailEntry
  var id: String { entry.key ?? "" }
}
