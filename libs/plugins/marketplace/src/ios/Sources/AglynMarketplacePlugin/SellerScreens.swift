// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynSite
import AglynUI
import SwiftUI

private enum SellSection: String, CaseIterable, Identifiable {
  case profile, listings, payouts, sales
  var id: String { rawValue }
  var title: String {
    switch self {
    case .profile: "Profile"
    case .listings: "Listings"
    case .payouts: "Payouts"
    case .sales: "Sales"
    }
  }
}

/// The profile fields a publisher edits, in the order the console's form lists them, with the route's key and the label shown.
private let profileFields: [(key: String, label: String)] = [
  ("displayName", "Display name"), ("bio", "Bio"), ("avatarUrl", "Logo"), ("website", "Website (https)"),
  ("supportEmail", "Support email"), ("supportUrl", "Support address (https)"), ("githubUrl", "GitHub (https)"), ("xUrl", "X (https)"),
  ("linkedinUrl", "LinkedIn (https)"),
]

/// Selling on the marketplace, the console's seller tabs in one screen: the public profile and the Publisher Agreement, the
/// listings with what can be done to each (their words, preview image, screenshots and logo from the media library), payouts
/// through Stripe, and the sales ledger.
struct SellScreen: View {
  let context: NativePluginContext
  var initialSection: String?
  @State private var section = SellSection.profile
  @State private var profile = LiveDocument()

  // `publishToMarketplace` is the admin tier's and the editor's (a per-person override is the server's to enforce).
  private var canManage: Bool { installRoles.contains(context.orgRole ?? "") }

  var body: some View {
    Group {
      if let orgID = context.orgID {
        VStack(spacing: 0) {
          Picker("Section", selection: $section) {
            ForEach(SellSection.allCases) { Text($0.title).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .aglynContentEdges()
          .padding(.vertical, AglynSpace.one)
          .accessibilityIdentifier("sell-sections")
          Form {
            if !canManage {
              Section { AglynNotice("Selling is for a workspace owner, admin or editor. You can see how it stands.", tone: .info) }
            }
            switch section {
            case .profile: ProfileSection(context: context, orgID: orgID, profile: profile, canManage: canManage)
            case .listings: ListingsSection(context: context, orgID: orgID, canManage: canManage)
            case .payouts: PayoutsSection(context: context, orgID: orgID, profile: profile, canManage: canManage) { profile.start(context.firestore, publisherProfilePath(orgID: orgID)) }
            case .sales: SalesSection(context: context, orgID: orgID, profile: profile)
            }
          }
          .formStyle(.aglynGrouped)
          .accessibilityIdentifier("sell-\(section.rawValue)")
        }
        .background(AglynGround())
        .task(id: orgID) { await profile.bind(context.firestore, publisherProfilePath(orgID: orgID)) }
        .onAppear { if let initialSection, let start = SellSection(rawValue: initialSection) { section = start } }
      } else {
        AglynEmptyState("Pick a workspace to sell from", systemImage: "storefront")
      }
    }
    .navigationTitle("Selling")
    .aglynScreenTitle("Selling")
  }
}

private struct ProfileSection: View {
  let context: NativePluginContext
  let orgID: String
  let profile: LiveDocument
  let canManage: Bool
  @State private var fields: [String: String] = [:]
  @State private var seeded: [String: String] = [:]
  @State private var runner = ActionRunner(roleHint: "an owner, admin or editor")
  /// The publisher agreement, agreed to on this save (AGL-4105): unticked again after each one.
  @State private var agreed = false

  private var stored: [String: Any]? { profile.state.value??.data }
  private var loaded: Bool { profile.state.value != nil }
  private func initial() -> [String: String] {
    Dictionary(uniqueKeysWithValues: (["handle"] + profileFields.map(\.key)).map { ($0, stored?[$0] as? String ?? "") })
  }
  private var valid: Bool { isPublisherHandle(fields["handle"] ?? "") && !(fields["displayName"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }

  var body: some View {
    Section {
      VStack(alignment: .leading, spacing: 2) {
        TextField("Handle", text: Binding(get: { fields["handle"] ?? "" }, set: { fields["handle"] = $0.lowercased() }))
          .autocorrectionDisabled()
          .disabled(!canManage || !loaded)
          .accessibilityIdentifier("seller-handle")
        Text("3 to 30 lowercase letters, digits and hyphens. It is claimed on the server, so two workspaces cannot both have it.")
          .font(AglynFont.caption).foregroundStyle(!(fields["handle"] ?? "").isEmpty && !isPublisherHandle(fields["handle"] ?? "") ? AglynColor.error : .secondary)
      }
      ForEach(profileFields.filter { $0.key != "avatarUrl" }, id: \.key) { field in
        TextField(field.label, text: Binding(get: { fields[field.key] ?? "" }, set: { fields[field.key] = $0 }), axis: field.key == "bio" ? .vertical : .horizontal)
          .lineLimit(field.key == "bio" ? 3...6 : 1...1)
          .disabled(!canManage || !loaded)
          .accessibilityIdentifier("seller-\(field.key)")
      }
      // The logo is picked from the media library, as the console's profile picks it; never typed.
      MediaPickField(
        context: context, label: "Logo", value: fields["avatarUrl"] ?? "", enabled: canManage && loaded, workspaceOnly: true,
        onPick: { fields["avatarUrl"] = listingMediaValue($0) }, onClear: { fields["avatarUrl"] = "" }
      )
      .accessibilityIdentifier("seller-avatarUrl")
      if let error = runner.error { AglynNotice(error, tone: .warning) }
      if let notice = runner.notice { AglynNotice(notice, tone: .success) }
      // Directly above Save profile, which waits for it (AGL-4105).
      PublisherAgreementCheckbox(isOn: $agreed, enabled: canManage && loaded && !runner.busy)
      Button("Save profile") {
        // Trimmed as the console sends them: an empty field explicitly clears what is stored.
        let body = fields.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let api = SellerAPI(api: context.api, orgID: orgID)
        runner.run("Profile saved", onDone: { agreed = false }) { try await api.saveProfile(body, agreement: .current) }
      }
      .buttonStyle(.aglynProminent)
      .disabled(!canManage || !loaded || !valid || fields == seeded || !agreed || runner.busy)
      .accessibilityIdentifier("seller-save")
    } header: {
      Text("Public profile")
    } footer: {
      Text("How your workspace shows to people browsing the marketplace.")
    }
    .onChange(of: stored.map { _ in initial() } ?? initial(), initial: true) { _, next in
      if fields == seeded || fields.isEmpty { fields = next }
      seeded = next
    }
    Section {
      let accepted = (stored?["publisherAgreement"] as? [String: Any])?["version"] as? String
      Text(publisherAgreementEverySave)
      if let accepted { Text("Last agreed to: version \(accepted).").foregroundStyle(.secondary) }
      Button("Review the agreement") { context.navigate("marketplace.publisherAgreement") }.accessibilityIdentifier("seller-agreement")
    } header: {
      Text("Marketplace Publisher Agreement")
    }
  }
}

private struct ListingsSection: View {
  let context: NativePluginContext
  let orgID: String
  let canManage: Bool
  @State private var live = LiveQuery()
  @State private var runner = ActionRunner(roleHint: "an owner, admin or editor")
  @State private var editing: SellerListing?
  /// Making a plugin private or public, or unpublishing or republishing a listing: asked first, with the agreement (AGL-4105).
  @State private var change: SellerListingChange?

  var body: some View {
    let listings = live.state.value.map { $0.map(SellerListing.init).sorted { $0.displayName.lowercased() < $1.displayName.lowercased() } }
    let api = SellerAPI(api: context.api, orgID: orgID)
    Group {
      if let notice = runner.notice { Section { AglynNotice(notice, tone: .success) } }
      if editing == nil, change == nil, let error = runner.error { Section { AglynNotice(error, tone: .error) } }
      if case .failed = live.state {
        Section { Text("Could not load your listings. Check the connection and try again.").foregroundStyle(.secondary) }
      } else if let listings {
        if listings.isEmpty {
          Section { Text("Publish a reusable component from a site’s Setup page to list it here.").foregroundStyle(.secondary) }
        } else {
          Section {
            ForEach(listings) { listing in
              Button { context.navigate(marketplaceListingScreen, ["listing": listing.id]) } label: {
                AglynRow(listing.displayName, subtitle: listing.subtitle, systemImage: "storefront") {
                  HStack {
                    if listing.isPrivate { StatusChip("Private") }
                    Menu {
                      Button { context.navigate(marketplaceListingScreen, ["listing": listing.id]) } label: { Label("View", systemImage: "info.circle") }
                      Button {
                        runner.clear()
                        editing = listing
                      } label: { Label("Edit listing", systemImage: "pencil") }
                      .disabled(!canManage)
                      if listing.isPlugin {
                        Button {
                          context.navigate("marketplace.publishPlugin", ["listing": listing.id])
                        } label: { Label("Publish new version", systemImage: "square.and.arrow.up") }
                        .disabled(!canManage)
                        Button {
                          runner.clear()
                          change = SellerListingChange(listing: listing, kind: .visibility)
                        } label: { Label(listing.isPrivate ? "Make public…" : "Make private…", systemImage: "lock") }
                        .disabled(!canManage)
                      }
                      Button(role: listing.unpublished ? nil : .destructive) {
                        runner.clear()
                        change = SellerListingChange(listing: listing, kind: .published)
                      } label: { Label(listing.unpublished ? "Republish…" : "Unpublish…", systemImage: listing.unpublished ? "arrow.clockwise" : "trash") }
                      .disabled(!canManage)
                    } label: {
                      Image(systemName: "ellipsis.circle").accessibilityLabel("More for \(listing.displayName)")
                    }
                  }
                }
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("seller-listing-\(listing.id)")
            }
          } header: {
            Text("Your listings")
          } footer: {
            // Private plugins never show in Browse, so this is the only door to them.
            if listings.contains(where: \.isPrivate) {
              Text("Private plugins never appear in the marketplace — open one with View to install it on your sites.")
            }
          }
        }
      } else {
        Section { ProgressView() }
      }
    }
    .task(id: orgID) { await live.bind(context.firestore, sellerListingsQuery(orgID: orgID)) }
    .sheet(item: $editing) { listing in
      EditListingSheet(context: context, listing: listing, runner: runner, api: api) { editing = nil }
    }
    .sheet(item: $change) { change in
      ListingChangeSheet(change: change, runner: runner, api: api) { self.change = nil }
    }
  }
}

/// A one-click change to a listing, asked first now that every publisher save agrees to the Publisher Agreement (AGL-4105).
struct SellerListingChange: Identifiable {
  enum Kind { case visibility, published }
  let listing: SellerListing
  let kind: Kind
  var id: String { "\(listing.id)-\(kind)" }

  /// The console's dialog: its title, sentence, button, and whether it takes the listing off the marketplace.
  var copy: (title: String, message: String, confirm: String, destructive: Bool) {
    let name = listing.displayName.isEmpty ? "this listing" : listing.displayName
    switch kind {
    case .visibility:
      return listing.isPrivate
        ? ("Make public?", "\(name) is offered in the marketplace, not only to your organization’s sites.", "Make public", false)
        : ("Make private?", "Only your organization’s sites can install \(name). Private plugins never appear in the marketplace.", "Make private", false)
    case .published:
      return listing.unpublished
        ? ("Republish?", "\(name) goes back on the marketplace.", "Republish", false)
        : ("Unpublish?", "\(name) comes off the marketplace. You can republish it later.", "Unpublish", true)
    }
  }

  /// What the change says once it is made, as the console's snackbar does.
  var success: String {
    switch kind {
    case .visibility: listing.isPrivate ? "Published to the marketplace" : "Now private — only your sites can install it"
    case .published: listing.unpublished ? "Republished" : "Unpublished"
    }
  }
}

/// The confirmation for a ``SellerListingChange``, with the agreement box as its last field (the console's
/// `PublisherAgreementConfirmDialog`).
struct ListingChangeSheet: View {
  let change: SellerListingChange
  let runner: ActionRunner
  let api: SellerAPI
  let close: () -> Void
  @State private var agreed = false

  var body: some View {
    let copy = change.copy
    AglynActionSheet(
      copy.title, message: copy.message, confirmLabel: copy.confirm, confirmEnabled: agreed, destructive: copy.destructive,
      busy: runner.busy, error: runner.error,
      onCancel: {
        runner.clear()
        close()
      },
      onConfirm: {
        let listing = change.listing
        runner.run(change.success, onDone: close) {
          switch change.kind {
          case .visibility: try await api.setVisibility(listing.id, listing.isPrivate ? "public" : "private", agreement: .current)
          case .published: try await api.setPublished(listing.id, published: listing.unpublished, agreement: .current)
          }
        }
      }
    ) {
      PublisherAgreementCheckbox(isOn: $agreed, enabled: !runner.busy)
    }
  }
}

/// The console's listing editor: the words and links, the preview image (its own route), the screenshots and the logo, each
/// picture chosen from the workspace's media library (or uploaded there from this device), never typed.
struct EditListingSheet: View {
  let context: NativePluginContext
  let listing: SellerListing
  let runner: ActionRunner
  let api: SellerAPI
  let close: () -> Void
  @State private var values: [String: String] = [:]
  @State private var preview = ""
  @State private var screenshots: [String] = []
  @State private var choosingScreenshot = false
  /// The publisher agreement, agreed to on this save (AGL-4105).
  @State private var agreed = false

  private let texts: [(key: String, label: String)] = [("displayName", "Listing name"), ("description", "Description"), ("readme", "About")]
  private let links: [(key: String, label: String)] = [("homepageUrl", "Homepage (https)"), ("repositoryUrl", "Repository (https)"), ("license", "License")]

  private func binding(_ key: String) -> Binding<String> { Binding(get: { values[key] ?? "" }, set: { values[key] = $0 }) }

  var body: some View {
    AglynActionSheet(
      "Edit listing", message: "Everything here shows on the public listing page.", confirmLabel: "Save listing",
      confirmEnabled: !(values["displayName"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty && agreed,
      busy: runner.busy, error: runner.error, onCancel: {
        runner.clear()
        close()
      },
      onConfirm: save
    ) {
      ForEach(texts, id: \.key) { field in
        TextField(field.label, text: binding(field.key), axis: .vertical)
          .lineLimit(field.key == "readme" ? 4...10 : (field.key == "description" ? 2...4 : 1...1))
          .accessibilityIdentifier("listing-\(field.key)")
      }
      MediaPickField(
        context: context, label: "Preview image", value: preview, workspaceOnly: true, supporting: "Shown on cards and at the top of the listing.",
        onPick: { preview = listingMediaValue($0) }, onClear: { preview = "" }
      )
      .accessibilityIdentifier("listing-preview")
      screenshotGallery
      MediaPickField(
        context: context, label: "Logo", value: values["logoUrl"] ?? "", workspaceOnly: true, supporting: listingLogoHint,
        onPick: { values["logoUrl"] = listingMediaValue($0) }, onClear: { values["logoUrl"] = "" },
        onLink: { values["logoUrl"] = $0 }
      )
      .accessibilityIdentifier("listing-logoUrl")
      ForEach(links, id: \.key) { field in
        TextField(field.label, text: binding(field.key))
          .autocorrectionDisabled(field.key != "license")
          .accessibilityIdentifier("listing-\(field.key)")
      }
      Picker("Category", selection: binding("category")) {
        Text("None").tag("")
        ForEach(ContractValues.shared.listingCategories, id: \.self) { Text($0).tag($0) }
        // A category the list no longer offers stays chosen rather than silently changing.
        let stored = values["category"] ?? ""
        if !stored.isEmpty && !ContractValues.shared.listingCategories.contains(stored) { Text(stored).tag(stored) }
      }
      .accessibilityIdentifier("listing-category")
      // The last field, nearest Save listing, which waits for it (AGL-4105).
      PublisherAgreementCheckbox(isOn: $agreed, enabled: !runner.busy)
    }
    .sheet(isPresented: $choosingScreenshot) {
      MediaChooserSheet(context: context, workspaceOnly: true) { chosen in
        screenshots = addingScreenshot(listingMediaValue(chosen), to: screenshots)
      }
    }
    .onAppear {
      values = [
        "displayName": listing.displayName, "description": listing.text("description"), "readme": listing.text("readme"),
        "logoUrl": listing.text("logoUrl"), "homepageUrl": listing.text("homepageUrl"), "repositoryUrl": listing.text("repositoryUrl"),
        "license": listing.text("license"), "category": listing.category,
      ]
      preview = listing.text("previewImageUrl")
      screenshots = listing.screenshots
    }
  }

  private var screenshotGallery: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Screenshots (\(screenshots.count)/\(maxListingScreenshots))").font(AglynFont.caption).foregroundStyle(.secondary)
      if !screenshots.isEmpty {
        ScrollView(.horizontal) {
          HStack(spacing: AglynSpace.one) {
            ForEach(Array(screenshots.enumerated()), id: \.element) { index, url in
              VStack(spacing: AglynSpace.half) {
                AglynRemoteImage(mediaPreviewURL(url, origin: context.api.origin, hostID: nil), systemImage: "photo")
                  .frame(width: 96, height: 72)
                  .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
                  .accessibilityLabel("Screenshot \(index + 1)")
                Button("Remove", role: .destructive) { screenshots.removeAll { $0 == url } }
                  .buttonStyle(.borderless)
                  .font(AglynFont.caption)
                  .accessibilityIdentifier("listing-screenshot-remove-\(index)")
              }
            }
          }
        }
      }
      if screenshots.count < maxListingScreenshots {
        Button("Add from media") { choosingScreenshot = true }
          .buttonStyle(.aglynSecondary)
          .accessibilityIdentifier("listing-screenshot-add")
      }
    }
  }

  private func save() {
    let sent = values.filter { $0.key != "category" }
    let category = values["category"] ?? ""
    let previewChanged = preview != listing.text("previewImageUrl")
    let preview = preview
    let screenshots = screenshots
    runner.run("Listing updated", onDone: close) {
      // The preview is not a content field, so it has its own route, touched only when it changed. Both carry this save's
      // one agreement (AGL-4105).
      if previewChanged { try await api.setPreviewImage(listing.id, url: preview, agreement: .current) }
      try await api.updateListing(listing.id, fields: sent, category: category, screenshots: screenshots, agreement: .current)
    }
  }
}

private struct PayoutsSection: View {
  let context: NativePluginContext
  let orgID: String
  let profile: LiveDocument
  let canManage: Bool
  let retry: () -> Void
  @Environment(\.openURL) private var openURL
  @State private var runner = ActionRunner(roleHint: "an owner, admin or editor")
  @State private var dashboard: String?

  private var readiness: PayoutReadiness {
    let state: String
    switch profile.state {
    case .ready: state = "loaded"
    case .failed: state = "error"
    case .loading: state = "pending"
    }
    let data = profile.state.value??.data
    return payoutReadiness(
      state: state, chargesEnabled: data?["stripeChargesEnabled"], payoutsEnabled: data?["stripePayoutsEnabled"],
      accountLivemode: data?["stripeAccountLivemode"])
  }

  var body: some View {
    let readiness = readiness
    let chargesEnabled = [PayoutReadiness.ready, .blocked, .unknown, .unverified].contains(readiness)
    Section {
      if let error = runner.error { AglynNotice(error, tone: .error) }
      if let notice = runner.notice { AglynNotice(notice, tone: .success) }
      switch readiness {
      case .error:
        AglynNotice(
          "We couldn’t load your payout setup. This says nothing about whether payouts are on — nothing has changed.", tone: .error,
          actionTitle: "Retry", action: retry)
      case .pending:
        Text("Checking your payout setup…").foregroundStyle(.secondary)
      default:
        if readiness == .blocked {
          AglynNotice(
            "Your Stripe account can take payments, but payouts are not enabled yet — sales would stay in Stripe rather than reaching your bank. Finish verification in Stripe to release them.",
            tone: .warning)
        }
        if readiness == .unverified {
          AglynNotice(
            "This Stripe account has not been verified for payments here, so sales will be refused. Reconnect it to confirm — if it was set up against Stripe test mode, you will need to connect a live account.",
            tone: .error)
        }
        Text(payoutsSentence(readiness)).foregroundStyle(.secondary)
        if chargesEnabled {
          Button(runner.busy ? "Opening Stripe…" : payoutsButton(readiness)) { connect() }
            .buttonStyle(.aglynSecondary)
            .disabled(!canManage || runner.busy)
            .accessibilityIdentifier("seller-payouts")
        } else {
          Button(runner.busy ? "Opening Stripe…" : payoutsButton(readiness)) { connect() }
            .buttonStyle(.aglynProminent)
            .disabled(!canManage || runner.busy)
            .accessibilityIdentifier("seller-payouts")
        }
        if let dashboard, let url = URL(string: dashboard) { Button("View payouts in Stripe") { openURL(url) } }
      }
    } header: {
      Text("Payouts")
    }
  }

  private func connect() {
    let api = SellerAPI(api: context.api, orgID: orgID)
    let open: (String) -> Void = { link in if let url = URL(string: link) { openURL(url) } }
    runner.run {
      do {
        let answer = try await api.connect()
        if answer.chargesEnabled {
          // A link Stripe minted is the only way into an Express account that cannot release payouts yet.
          if answer.payoutsEnabled == false, let url = answer.url {
            open(url)
            return
          }
          if answer.payoutsEnabled != false { dashboard = answer.dashboardURL }
          runner.notice = answer.payoutsEnabled == false ? "Connected — payouts are not released yet" : "Payouts are enabled"
        } else if let url = answer.url {
          open(url)
        }
      } catch let error as ConsoleAPIError where error.status == 501 {
        runner.notice = "Payouts are not configured on this deployment"
      }
    }
  }
}

private struct SalesSection: View {
  let context: NativePluginContext
  let orgID: String
  let profile: LiveDocument
  @State private var live = LiveQuery()

  var body: some View {
    let sales = live.state.value
    Section {
      if case .failed = live.state {
        Text("Sales could not be loaded. Check the connection and try again.").foregroundStyle(.secondary)
      } else if let sales {
        if sales.isEmpty {
          Text("No sales yet. Paid listings appear here with what buyers paid and what was paid out to you.").foregroundStyle(.secondary)
        } else {
          let totals = summarizeSellerLedger(sales.map(\.data))
          Text("\(totals.paidCount) sale\(totals.paidCount == 1 ? "" : "s")" + (totals.refundedCount > 0 ? " · \(totals.refundedCount) refunded or charged back" : ""))
          // The payout first, named for what it is: the instruction given at charge time, not an arrival at the bank.
          Text("Sent to your Stripe account \(dollars(totals.sentToStripeCents))").accessibilityIdentifier("seller-sent")
          if let data = profile.state.value??.data, let failedAt = (data["lastPayoutFailureAtMs"] as? NSNumber)?.doubleValue, failedAt != 0 {
            let cents = (data["lastPayoutFailureCents"] as? NSNumber)?.doubleValue ?? 0
            let day = Date(timeIntervalSince1970: failedAt / 1000).formatted(date: .numeric, time: .omitted)
            AglynNotice(
              "A payout of \(dollars(cents)) did not reach your bank on \(day) — \(data["lastPayoutFailureReason"] as? String ?? "Stripe did not say why") The money is still in your Stripe account. Open Stripe to fix your payout details.",
              tone: .warning)
          }
          Text("Buyers paid \(dollars(totals.buyersPaidCents)) · sales tax \(dollars(totals.salesTaxCents)) · platform fee \(dollars(totals.platformFeeCents))")
            .font(AglynFont.caption).foregroundStyle(.secondary)
          if totals.refundedCount > 0 {
            Text("\(dollars(totals.returnedCents)) returned on refunded and charged-back sales, and excluded above").font(AglynFont.caption).foregroundStyle(.secondary)
          }
          Text(
            "Sent to your Stripe account is the pre-tax price less the platform fee. Sales tax is collected and remitted by \(platformLegalName) under its marketplace-provider registration and was never part of your share. Reaching your Stripe balance is not the same as reaching your bank — a failed payout is called out above."
          )
          .font(AglynFont.caption).foregroundStyle(.secondary)
        }
      } else {
        ProgressView()
      }
    } header: {
      Text("Sales")
    }
    .task(id: orgID) { await live.bind(context.firestore, sellerSalesQuery(orgID: orgID)) }
  }
}

/// What the agreement card says, as the console's seller panel does (AGL-4105).
let publisherAgreementEverySave =
  "Every save in the marketplace — this profile, a listing, its price or visibility, a new version, a component, template or layout — asks you to tick “\(ContractValues.shared.publisherAgreementConsentLabel)” first. We record who agreed, to which version, and when."

/// "I agree to the Marketplace Publisher Agreement" (AGL-4105): the box every publisher save carries, right above its button,
/// as the console's `PublisherAgreementCheckbox` does — unticked until ticked, and the agreement's title the link to it. A
/// sign-up consent row's shape (the box its own control, so the link in the sentence stays tappable). The Kotlin plugin's
/// `PublisherAgreementCheckbox`.
struct PublisherAgreementCheckbox: View {
  @Binding var isOn: Bool
  var enabled = true

  var body: some View {
    let contracts = ContractValues.shared
    HStack(alignment: .firstTextBaseline, spacing: AglynSpace.one) {
      Button {
        isOn.toggle()
      } label: {
        Image(systemName: isOn ? "checkmark.square.fill" : "square")
          .font(AglynFont.title3)
          .foregroundStyle(isOn ? AglynColor.primary : AglynColor.secondaryText)
      }
      .buttonStyle(.plain)
      .disabled(!enabled)
      .accessibilityLabel("Agree to the \(contracts.publisherAgreementTitle)")
      .accessibilityValue(isOn ? "Checked" : "Not checked")
      .accessibilityAddTraits(isOn ? .isSelected : [])
      .accessibilityIdentifier("publisher-agreement")
      Text(LocalizedStringKey("I agree to the [\(contracts.publisherAgreementTitle)](\(contracts.publisherAgreementUrl))"))
        .font(AglynFont.subheadline)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
