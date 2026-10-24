import Foundation
import HomeFinKit
import Observation
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Everything the app knows about where it is and who's watching.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        /// Ask for the server address.
        case server
        /// Email + password (Home Fin accounts) or Jellyfin username + password.
        case signIn
        /// Who's watching?
        case profiles
        case main
    }

    var phase: Phase = .launching
    var server: URL?
    var serverName = "Home Fin"
    /// The server runs the Home Fin accounts service (email sign-in and profiles).
    var accountsEnabled = false
    /// Signed in to a Home Fin account (by its cookie).
    var me: HomeFinMe?
    var avatars: [String: AvatarPreset] = [:]
    private(set) var session: SavedSession?
    /// What the player shows; set to play something from anywhere.
    var nowPlaying: Item?
    /// Bumped when something changes what Home shows (thumbs, My List, a finished episode).
    var homeRevision = 0

    let device: DeviceIdentity
    private let store: SessionStore
    private let defaults = UserDefaults.standard

    init() {
        device = DeviceIdentity(id: DeviceIdentity.persistentID(), name: Self.deviceName(),
                                version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0")
        #if canImport(Security)
        store = SessionStore(secrets: KeychainSecretStore())
        #else
        store = SessionStore(secrets: MemorySecretStore())
        #endif
    }

    private static func deviceName() -> String {
        #if os(iOS)
        return UIDevice.current.model
        #else
        return Host.current().localizedName ?? "Mac"
        #endif
    }

    // MARK: clients

    var jellyfin: JellyfinClient? {
        guard let session else { return nil }
        return JellyfinClient(server: session.server, device: device, token: session.token, userId: session.userId)
    }

    /// The accounts service, as the current viewer (their Jellyfin token rides along).
    var accounts: AccountsClient? {
        guard let server, accountsEnabled else { return nil }
        return AccountsClient(server: server, jellyfinToken: session?.token)
    }

    var viewerName: String { session?.viewerName ?? "" }
    var isAdmin: Bool { session?.isAdministrator == true || me?.account.isAdmin == true }
    var currentProfile: HomeFinProfile? { session?.profile }

    /// Streaming quality from Settings: nil is "Auto".
    var maxBitrate: Int? {
        get { defaults.object(forKey: "homefin.maxBitrate") as? Int }
        set { defaults.set(newValue, forKey: "homefin.maxBitrate") }
    }

    // MARK: start-up

    func start() async {
        if let saved = store.load() {
            session = saved
            server = saved.server
            await loadServerDetails(saved.server)
            // Still valid? (A revoked token or disabled account means sign in again.)
            if (try? await jellyfin?.currentUser()) != nil {
                if accountsEnabled { me = try? await AccountsClient(server: saved.server).me() }
                withAnimation(Theme.spring) { phase = .main }
                return
            }
            session = nil
            store.clear()
        }
        if let text = defaults.string(forKey: "homefin.server"), let url = URL(string: text) {
            server = url
            await loadServerDetails(url)
            if accountsEnabled, let me = try? await AccountsClient(server: url).me() {
                self.me = me
                withAnimation(Theme.spring) { phase = .profiles }
                return
            }
            withAnimation(Theme.spring) { phase = .signIn }
            return
        }
        withAnimation(Theme.spring) { phase = .server }
    }

    private func loadServerDetails(_ url: URL) async {
        let probe = JellyfinClient(server: url, device: device)
        if let info = try? await probe.publicInfo() { serverName = info.serverName ?? "Home Fin" }
        let config = try? await AccountsClient(server: url).config()
        accountsEnabled = config?.enabled == true
        if let name = config?.serverName { serverName = name }
        if accountsEnabled, avatars.isEmpty, let presets = try? await AccountsClient(server: url).avatars() {
            avatars = Dictionary(uniqueKeysWithValues: presets.map { ($0.key, $0) })
        }
    }

    // MARK: server

    func connect(to text: String) async throws {
        guard let url = normaliseServerAddress(text) else {
            throw HomeFinError(message: "That doesn't look like a server address. Try something like tv.example.com")
        }
        let info = try await JellyfinClient(server: url, device: device).publicInfo()
        server = url
        serverName = info.serverName ?? "Home Fin"
        defaults.set(url.absoluteString, forKey: "homefin.server")
        await loadServerDetails(url)
        withAnimation(Theme.spring) { phase = .signIn }
    }

    func changeServer() {
        Task { await signOut() }
        defaults.removeObject(forKey: "homefin.server")
        server = nil
        withAnimation(Theme.spring) { phase = .server }
    }

    // MARK: sign-in

    func signIn(email: String, password: String) async throws {
        guard let server else { return }
        me = try await AccountsClient(server: server).login(email: email, password: password)
        withAnimation(Theme.spring) { phase = .profiles }
    }

    func signIn(username: String, password: String) async throws {
        guard let server else { return }
        let auth = try await JellyfinClient(server: server, device: device).authenticate(username: username, password: password)
        adopt(auth, profile: nil)
    }

    /// Who's watching? → this profile (with its PIN if locked).
    func choose(_ profile: HomeFinProfile, pin: String? = nil) async throws {
        guard let server else { return }
        if let old = jellyfin { await old.logout() }
        let auth = try await AccountsClient(server: server).profileSession(profileId: profile.id, device: device, pin: pin)
        adopt(auth, profile: profile)
    }

    private func adopt(_ auth: AuthenticationResult, profile: HomeFinProfile?) {
        guard let server else { return }
        let saved = SavedSession(server: server, userId: auth.user.id, token: auth.accessToken, userName: auth.user.name,
                                 isAdministrator: auth.user.isAdministrator, profile: profile)
        store.save(saved)
        session = saved
        homeRevision += 1
        withAnimation(Theme.spring) { phase = .main }
    }

    func reloadProfiles() async {
        guard let server, accountsEnabled else { return }
        if let fresh = try? await AccountsClient(server: server).me() { me = fresh }
    }

    func switchProfiles() {
        Task { await reloadProfiles() }
        withAnimation(Theme.spring) { phase = me == nil ? .signIn : .profiles }
    }

    func signOut() async {
        await jellyfin?.logout()
        if let server, accountsEnabled { await AccountsClient(server: server).logout() }
        store.clear()
        session = nil
        me = nil
        nowPlaying = nil
        withAnimation(Theme.spring) { phase = server == nil ? .server : .signIn }
    }

    /// A 401 from Jellyfin mid-session: the token was revoked (password changed, account disabled).
    func handle(_ error: Error) {
        if let error = error as? HomeFinError, error.isUnauthorized, phase == .main {
            store.clear()
            session = nil
            withAnimation(Theme.spring) { phase = me == nil ? .signIn : .profiles }
        }
    }

    func avatar(for profile: HomeFinProfile?) -> AvatarPreset? {
        profile.flatMap { avatars[$0.avatar] }
    }

    func play(_ item: Item) {
        nowPlaying = item
    }
}
