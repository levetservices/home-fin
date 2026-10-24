import HomeFinKit
import SwiftUI

/// Netflix's profile picker: today's No. 1 full-bleed behind, profiles on a curved panel below.
struct ProfilesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var opening: Int?
    @State private var locked: HomeFinProfile?
    @State private var error: String?
    @State private var appeared = false
    @State private var hero: (id: String, reason: String)?

    private static let columns = [GridItem(.adaptive(minimum: 96, maximum: 120), spacing: 22)]

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                heroArt
                    .frame(width: proxy.size.width, height: proxy.size.height)
                VStack(spacing: 0) {
                    heroTitle
                    Text("Choose your profile")
                        .font(.system(size: 17))
                        .foregroundStyle(.white.opacity(0.8))
                        .padding(.bottom, 14)
                    panel
                }
            }
        }
        .ignoresSafeArea(edges: .top)
        .foregroundStyle(.white)
        .onAppear { appeared = true }
        .task {
            await model.reloadProfiles()
            await loadHero()
        }
        .sheet(item: $locked) { profile in
            PinPadView(profile: profile, avatar: model.avatar(for: profile)) { pin in
                try await model.choose(profile, pin: pin)
            }
        }
    }

    // MARK: pieces

    @ViewBuilder private var heroArt: some View {
        ZStack {
            if let hero, let jellyfin = model.publicJellyfin {
                Artwork(url: jellyfin.untaggedImageURL(hero.id, .primary, maxWidth: 1200))
                    .transition(.opacity)
            } else {
                RadialGradient(colors: [Color(hex: "#3a0d10"), .black], center: .top, startRadius: 0, endRadius: 700)
            }
            LinearGradient(stops: [
                .init(color: .clear, location: 0.35),
                .init(color: .black.opacity(0.7), location: 0.62),
                .init(color: .black, location: 0.8)
            ], startPoint: .top, endPoint: .bottom)
        }
        .clipped()
        .animation(.easeOut(duration: 0.6), value: hero?.id)
    }

    @ViewBuilder private var heroTitle: some View {
        if let hero, let jellyfin = model.publicJellyfin {
            VStack(spacing: 14) {
                Artwork(url: jellyfin.untaggedImageURL(hero.id, .logo, maxWidth: 700), contentMode: .fit)
                    .frame(maxWidth: 280, maxHeight: 90)
                HStack(spacing: 8) {
                    Top10Badge()
                    Text(hero.reason).font(.system(size: 17, weight: .semibold))
                }
            }
            .padding(.bottom, 30)
            .transition(.opacity)
        } else {
            Wordmark(size: 36).padding(.bottom, 40)
        }
    }

    private var panel: some View {
        VStack(spacing: 18) {
            ErrorNote(message: error).frame(maxWidth: 420)
            LazyVGrid(columns: Self.columns, spacing: 22) {
                ForEach(Array((model.me?.profiles ?? []).enumerated()), id: \.element.id) { index, profile in
                    profileButton(profile)
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 16)
                        .animation(Theme.spring.delay(Double(index) * 0.05), value: appeared)
                }
                editTile
            }
            .frame(maxWidth: 520)
        }
        .padding(.horizontal, 24)
        .padding(.top, 34)
        .padding(.bottom, 30)
        .frame(maxWidth: .infinity)
        .background {
            CurvedTop()
                .fill(Color(hex: "#2b2b2b").opacity(0.94))
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private func profileButton(_ profile: HomeFinProfile) -> some View {
        Button { choose(profile) } label: {
            VStack(spacing: 8) {
                AvatarView(preset: model.avatar(for: profile), name: profile.name, size: 96)
                    .overlay(alignment: .bottomTrailing) {
                        if profile.isKids {
                            Text("kids")
                                .font(.system(size: 11, weight: .heavy))
                                .foregroundStyle(Theme.brand)
                                .padding(.horizontal, 4)
                                .background(.white, in: RoundedRectangle(cornerRadius: 3))
                                .padding(5)
                        } else if profile.locked {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 11, weight: .bold))
                                .padding(5)
                                .background(Circle().fill(.black.opacity(0.6)))
                                .padding(5)
                        }
                    }
                    .opacity(opening == nil || opening == profile.id ? 1 : 0.4)
                    .scaleEffect(opening == profile.id ? 1.08 : 1)
                Text(profile.name)
                    .font(.system(size: 16, weight: .semibold))
                    .lineLimit(1)
            }
        }
        .buttonStyle(CardButtonStyle())
        .disabled(opening != nil)
    }

    private var editTile: some View {
        Button {
            if let server = model.server {
                openURL(JellyfinClient(server: server, device: model.device).webURL(page: "homefin/profiles/manage"))
            }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: "pencil")
                    .font(.system(size: 30, weight: .medium))
                    .frame(width: 96, height: 96)
                    .glass(in: RoundedRectangle(cornerRadius: 15, style: .continuous), interactive: true)
                Text("Edit").font(.system(size: 16)).foregroundStyle(Theme.secondary)
            }
        }
        .buttonStyle(CardButtonStyle())
        .opacity(appeared ? 1 : 0)
        .animation(Theme.spring.delay(0.25), value: appeared)
    }

    // MARK: actions

    private func loadHero() async {
        guard let server = model.server, let trending = try? await AccountsClient(server: server).trending() else { return }
        let pick: (id: String, reason: String)? = trending.series.first.map { ($0.id, "No. 1 in Series Today") }
            ?? trending.movies.first.map { ($0.id, "No. 1 in Films Today") }
        withAnimation { hero = pick }
    }

    private func choose(_ profile: HomeFinProfile) {
        if profile.locked {
            locked = profile
            return
        }
        withAnimation(Theme.spring) { opening = profile.id }
        Task {
            do {
                try await model.choose(profile)
            } catch {
                withAnimation {
                    self.error = error.localizedDescription
                    opening = nil
                }
            }
        }
    }
}

/// The panel's gently domed top edge.
struct CurvedTop: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let rise: CGFloat = min(26, rect.height * 0.1)
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + rise))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + rise), control: CGPoint(x: rect.midX, y: rect.minY - rise))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// Profile Lock: four dots and a glass keypad. Typing works too on the Mac.
struct PinPadView: View {
    var profile: HomeFinProfile
    var avatar: AvatarPreset?
    var submit: (String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pin = ""
    @State private var error: String?
    @State private var shake = 0
    @FocusState private var typing: Bool

    var body: some View {
        VStack(spacing: 22) {
            HStack {
                Spacer()
                GlassCircleButton(systemImage: "xmark", size: 40, label: "Cancel") { dismiss() }
            }
            AvatarView(preset: avatar, name: profile.name, size: 72)
            Text("Profile Lock is on").font(.system(size: 22, weight: .bold))
            Text("Enter your PIN to watch as \(profile.name).").foregroundStyle(Theme.secondary)
            HStack(spacing: 14) {
                ForEach(0..<4, id: \.self) { index in
                    Circle()
                        .strokeBorder(.white, lineWidth: 2)
                        .background(Circle().fill(index < pin.count ? Color.white : .clear))
                        .frame(width: 18, height: 18)
                        .scaleEffect(index < pin.count ? 1.1 : 1)
                        .animation(Theme.spring, value: pin.count)
                }
            }
            .modifier(Shake(amount: CGFloat(shake)))
            if let error { Text(error).foregroundStyle(Color(hex: "#e87c03")).font(.callout) }
            GlassGroup(spacing: 14) {
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(76), spacing: 14), count: 3), spacing: 14) {
                    ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"], id: \.self) { key in
                        if key.isEmpty {
                            Color.clear.frame(height: 60)
                        } else {
                            Button { press(key) } label: {
                                Text(key)
                                    .font(.system(size: 26, weight: .medium))
                                    .frame(width: 76, height: 60)
                                    .glass(in: RoundedRectangle(cornerRadius: 16, style: .continuous), interactive: true)
                            }
                            .buttonStyle(PressScaleStyle())
                        }
                    }
                }
            }
            // Hidden field so a hardware keyboard can type the PIN.
            TextField("", text: $pin)
                .focused($typing)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .onChange(of: pin) { _, value in
                    let digits = String(value.filter(\.isNumber).prefix(4))
                    if digits != value { pin = digits }
                    if digits.count == 4 { send() }
                }
        }
        .padding(24)
        .frame(minWidth: 340)
        .foregroundStyle(.white)
        .presentationBackground(Color(hex: "#141414"))
        .presentationDetents([.large])
        .onAppear { typing = true }
    }

    private func press(_ key: String) {
        error = nil
        if key == "⌫" {
            if !pin.isEmpty { pin.removeLast() }
        } else if pin.count < 4 {
            pin.append(key)
        }
    }

    private func send() {
        let attempt = pin
        Task {
            do {
                try await submit(attempt)
                dismiss()
            } catch {
                withAnimation(.default) { shake += 1 }
                self.error = (error as? HomeFinError)?.status == 403 ? "Incorrect PIN. Try again." : error.localizedDescription
                pin = ""
            }
        }
    }
}

/// A short side-to-side shake for a wrong PIN.
struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 10 * sin(amount * .pi * 4), y: 0))
    }
}
