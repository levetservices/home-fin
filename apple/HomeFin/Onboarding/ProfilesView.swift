import HomeFinKit
import SwiftUI

/// Who's watching? Big avatars; locked profiles ask for their PIN.
struct ProfilesView: View {
    @Environment(AppModel.self) private var model
    @State private var opening: Int?
    @State private var locked: HomeFinProfile?
    @State private var error: String?
    @State private var appeared = false

    private let columns = [GridItem(.adaptive(minimum: 120, maximum: 170), spacing: 24)]

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 34) {
                Wordmark(size: 30)
                Text("Who's watching?")
                    .font(.system(size: 34, weight: .medium))
                ErrorNote(message: error).frame(maxWidth: 420)
                LazyVGrid(columns: columns, spacing: 28) {
                    ForEach(Array((model.me?.profiles ?? []).enumerated()), id: \.element.id) { index, profile in
                        Button { choose(profile) } label: {
                            VStack(spacing: 10) {
                                ZStack(alignment: .bottomTrailing) {
                                    AvatarView(preset: model.avatar(for: profile), name: profile.name, size: 120)
                                        .opacity(opening == nil || opening == profile.id ? 1 : 0.4)
                                        .scaleEffect(opening == profile.id ? 1.08 : 1)
                                    if profile.locked {
                                        Image(systemName: "lock.fill")
                                            .font(.system(size: 13, weight: .bold))
                                            .padding(6)
                                            .background(Circle().fill(.black.opacity(0.6)))
                                            .padding(6)
                                    }
                                }
                                Text(profile.name)
                                    .font(.system(size: 16))
                                    .foregroundStyle(Theme.secondary)
                            }
                        }
                        .buttonStyle(CardButtonStyle())
                        .disabled(opening != nil)
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 16)
                        .animation(Theme.spring.delay(Double(index) * 0.05), value: appeared)
                    }
                }
                .frame(maxWidth: 760)
                Button("Sign out") { Task { await model.signOut() } }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.secondary)
            }
            .padding(30)
        }
        .foregroundStyle(.white)
        .onAppear { appeared = true }
        .task { await model.reloadProfiles() }
        .sheet(item: $locked) { profile in
            PinPadView(profile: profile, avatar: model.avatar(for: profile)) { pin in
                try await model.choose(profile, pin: pin)
            }
        }
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

/// Four dots and a keypad. Typing works too on the Mac.
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
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(76), spacing: 14), count: 3), spacing: 14) {
                ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"], id: \.self) { key in
                    if key.isEmpty {
                        Color.clear.frame(height: 60)
                    } else {
                        Button { press(key) } label: {
                            Text(key)
                                .font(.system(size: 26, weight: .medium))
                                .frame(width: 76, height: 60)
                                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.raised))
                        }
                        .buttonStyle(CardButtonStyle())
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
            Button("Cancel") { dismiss() }.buttonStyle(.plain).foregroundStyle(Theme.secondary)
        }
        .padding(30)
        .frame(minWidth: 340)
        .foregroundStyle(.white)
        .homeFinBackground()
        .presentationBackground(Theme.background)
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
