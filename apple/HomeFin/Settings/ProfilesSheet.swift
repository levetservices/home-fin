import HomeFinKit
import SwiftUI

/// Netflix's Profiles sheet: who's watching, the other profiles, Manage Profiles, then App
/// Settings, Account, Sign in a TV and Sign Out.
struct ProfilesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showSettings = false
    @State private var showTV = false
    @State private var confirmSignOut = false
    @State private var locked: HomeFinProfile?
    @State private var switching: Int?

    private var others: [HomeFinProfile] {
        (model.me?.profiles ?? []).filter { $0.id != model.currentProfile?.id }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                ZStack {
                    Text("Profiles").font(.system(size: 18, weight: .bold))
                    HStack {
                        Spacer()
                        GlassCircleButton(systemImage: "xmark", size: 40, label: "Close") { dismiss() }
                    }
                }
                current
                if !others.isEmpty { otherProfiles }
                if model.accountsEnabled {
                    Button("Manage Profiles") { openWeb("homefin/profiles/manage") }
                        .buttonStyle(GlassPillButtonStyle(height: 44))
                }
                VStack(spacing: 8) {
                    settingsRow("gearshape", "App Settings") { showSettings = true }
                    if model.accountsEnabled {
                        settingsRow("person", "Account") { openWeb("homefin/account") }
                    }
                    settingsRow("tv", "Sign In a TV") { showTV = true }
                    settingsRow("rectangle.portrait.and.arrow.right", "Sign Out") { confirmSignOut = true }
                }
                Text("Version: \(Self.version)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondary)
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .foregroundStyle(.white)
        .sheet(isPresented: $showSettings) {
            AppSettingsView()
                .environment(model)
                .presentationBackground(Color(hex: "#1c1c1c"))
                .presentationCornerRadius(28)
        }
        .sheet(isPresented: $showTV) {
            SignInTVView()
                .environment(model)
                .presentationDetents([.medium])
                .presentationBackground(Color(hex: "#1c1c1c"))
        }
        .sheet(item: $locked) { profile in
            PinPadView(profile: profile, avatar: model.avatar(for: profile)) { pin in
                try await model.choose(profile, pin: pin)
            }
        }
        .confirmationDialog("Sign out of Home Fin on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) { Task { await model.signOut() } }
        } message: {
            Text("Downloads stay on this device until you delete them.")
        }
        .task { await model.reloadProfiles() }
    }

    private var current: some View {
        VStack(spacing: 10) {
            AvatarView(preset: model.avatar(for: model.currentProfile), name: model.viewerName, size: 118)
            Text(model.viewerName).font(.system(size: 28, weight: .bold))
            if let email = model.me?.account.email {
                Label(email, systemImage: "envelope").font(.system(size: 14)).foregroundStyle(Theme.secondary)
            } else {
                Text(model.serverName).font(.system(size: 14)).foregroundStyle(Theme.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .glass(in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(alignment: .topTrailing) {
            if model.accountsEnabled {
                Button { openWeb("homefin/profiles/manage") } label: {
                    Image(systemName: "pencil").font(.system(size: 20, weight: .semibold)).padding(18)
                }
                .buttonStyle(PressScaleStyle())
                .accessibilityLabel("Edit profile")
            }
        }
    }

    private var otherProfiles: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 18) {
                ForEach(others) { profile in
                    Button { switchTo(profile) } label: {
                        VStack(spacing: 8) {
                            AvatarView(preset: model.avatar(for: profile), name: profile.name, size: 72)
                                .overlay(alignment: .bottomTrailing) {
                                    if profile.isKids {
                                        Text("kids").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.brand)
                                            .padding(.horizontal, 3).background(.white, in: RoundedRectangle(cornerRadius: 2)).padding(4)
                                    }
                                }
                                .opacity(switching == nil || switching == profile.id ? 1 : 0.4)
                            Text(profile.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                        }
                        .frame(width: 82)
                    }
                    .buttonStyle(CardButtonStyle())
                }
            }
            .padding(.horizontal, 4)
        }
        .scrollIndicators(.hidden)
    }

    private func settingsRow(_ symbol: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: symbol).font(.system(size: 22)).frame(width: 30)
                Text(title).font(.system(size: 18, weight: .medium))
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 16, weight: .semibold))
            }
            .padding(.horizontal, 18)
            .frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color(hex: "#2b2b2b")))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
    }

    private func switchTo(_ profile: HomeFinProfile) {
        if profile.locked {
            locked = profile
            return
        }
        withAnimation(Theme.spring) { switching = profile.id }
        Task {
            try? await model.choose(profile)
            switching = nil
            dismiss()
        }
    }

    private func openWeb(_ page: String) {
        guard let jellyfin = model.jellyfin ?? model.publicJellyfin else { return }
        openURL(jellyfin.webURL(page: page))
    }

    static var version: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(short) (\(build))"
    }
}

/// Sign in a TV: approve the Quick Connect code a TV or another app shows.
struct SignInTVView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var message: String?
    @State private var done = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Sign In a TV").font(.system(size: 22, weight: .bold))
                Spacer()
                GlassCircleButton(systemImage: "xmark", size: 40, label: "Close") { dismiss() }
            }
            Text("On the TV (or any Jellyfin app), choose Quick Connect, then type the code it shows.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.secondary)
            FieldBox {
                TextField("", text: $code, prompt: Text("6-digit code").foregroundStyle(Theme.secondary))
                    .font(.system(size: 24, weight: .semibold).monospacedDigit())
                    .focused($focused)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                    .onSubmit(authorize)
            }
            Button(action: authorize) {
                Label(done ? "Done" : "Sign In", systemImage: done ? "checkmark" : "tv")
            }
            .buttonStyle(BrandButtonStyle())
            .disabled(code.count < 6 || done)
            if let message {
                Text(message).font(.system(size: 15)).foregroundStyle(done ? Color(hex: "#4ade80") : Color(hex: "#e87c03"))
                    .transition(.opacity)
            }
            Spacer()
        }
        .padding(22)
        .foregroundStyle(.white)
        .onAppear { focused = true }
    }

    private func authorize() {
        let entered = code
        Task {
            do {
                try await model.jellyfin?.authorizeQuickConnect(code: entered)
                withAnimation {
                    done = true
                    message = "The TV is signing in as \(model.viewerName)."
                }
            } catch {
                withAnimation { message = "That code didn't work. Codes expire after a few minutes; try a new one." }
            }
        }
    }
}
