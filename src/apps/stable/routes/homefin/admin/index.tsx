import React, { type ChangeEvent, type FC, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AccountsError, accountsApi, type Account, type AvatarPreset, type Invite, type JellyfinUserSummary, type Profile, type RequestPolicy } from 'homefin/accounts/api';
import { Avatar, findAvatar } from 'homefin/accounts/avatar';
import { ErrorBanner, Field, Screen, errorMessage, fireAndForget, useAvatars, useInputSetter } from 'homefin/accounts/components';
import { POLICY_OPTIONS } from 'homefin/settings/AdminSections';

type AccountWithProfiles = Account & { profiles: Profile[] };
type Run = (action: () => Promise<unknown>) => void;

function inviteBaseUrl() {
    return window.location.href.split('#')[0];
}

/** What to send people who still sign in with a Jellyfin username. */
function moveMessage() {
    return 'We\'re moving to Home Fin. Open ' + inviteBaseUrl() + '#/homefin/move, sign in with your usual '
        + 'Jellyfin username and password, and add your email. Your watch history and My List come with you.';
}

/** Copy to the clipboard where allowed (secure pages); otherwise the caller selects the text. */
function copyText(text: string, onCopied: () => void, onFallback: () => void) {
    // eslint-disable-next-line compat/compat -- guarded: falls back to selecting the text
    const clipboard = window.isSecureContext ? navigator.clipboard : undefined;
    if (!clipboard) {
        onFallback();
        return;
    }
    clipboard.writeText(text).then(onCopied, onFallback);
}

function formatDate(value?: string | null) {
    if (!value) return '';
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function inviteStatus(invite: Invite) {
    if (invite.usedAt) return `Used by ${invite.usedBy || 'someone'}`;
    if (new Date(invite.expiresAt) < new Date()) return 'Expired';
    return `Expires ${formatDate(invite.expiresAt)}`;
}

// ── rows ──────────────────────────────────────────────────────────────────

const InviteRow: FC<{ invite: Invite, run: Run }> = ({ invite, run }) => {
    const revoke = useCallback(() => run(() => accountsApi.admin.deleteInvite(invite.id)), [invite.id, run]);
    return (
        <tr>
            <td>{invite.note || invite.email || '—'}</td>
            <td>{formatDate(invite.createdAt)}</td>
            <td>{inviteStatus(invite)}</td>
            <td>{!invite.usedAt && <button type='button' className='hfLinkButton' onClick={revoke}>Revoke</button>}</td>
        </tr>
    );
};

const AccountRow: FC<{ account: AccountWithProfiles, avatars: AvatarPreset[], isSelf: boolean, run: Run }> = ({ account, avatars, isSelf, run }) => {
    const resetPassword = useCallback(() => {
        const password = window.prompt(`New password for ${account.email} (8+ characters)`);
        if (password) run(() => accountsApi.admin.updateAccount(account.id, { password }));
    }, [account, run]);
    const setPolicy = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
        const requestPolicy = e.target.value as RequestPolicy;
        run(() => accountsApi.admin.updateAccount(account.id, { requestPolicy }));
    }, [account, run]);
    const toggleDisabled = useCallback(() => run(() => accountsApi.admin.updateAccount(account.id, { disabled: !account.disabled })), [account, run]);
    const remove = useCallback(() => {
        if (window.confirm(`Delete ${account.email} and all of its profiles? Their watch history goes too.`)) {
            run(() => accountsApi.admin.deleteAccount(account.id));
        }
    }, [account, run]);

    return (
        <li className={account.disabled ? 'is-disabled' : ''}>
            <div className='hfAccounts-who'>
                <strong>{account.name}</strong>
                <span>{account.email}</span>
                {account.isAdmin && <span className='hfTag'>Admin</span>}
                {account.disabled && <span className='hfTag hfTag-muted'>Disabled</span>}
            </div>
            <div className='hfAccounts-profiles'>
                {account.profiles.map(profile => (
                    <span key={profile.id} className='hfChip'>
                        <Avatar avatar={findAvatar(avatars, profile.avatar)} className='hfChip-avatar' />
                        {profile.name}
                    </span>
                ))}
                {!account.profiles.length && <span className='hfPanel-note'>No profiles yet</span>}
            </div>
            <label className='hfAccounts-policy'>
                <span>Requests</span>
                {account.isAdmin ? (
                    <span className='hfPanel-note'>Go straight through (admin)</span>
                ) : (
                    <select value={account.requestPolicy} onChange={setPolicy}>
                        {POLICY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                )}
            </label>
            {!isSelf && (
                <div className='hfAccounts-actions'>
                    <button type='button' className='hfLinkButton' onClick={resetPassword}>Reset password</button>
                    <button type='button' className='hfLinkButton' onClick={toggleDisabled}>{account.disabled ? 'Enable' : 'Disable'}</button>
                    <button type='button' className='hfLinkButton hfLinkButton-danger' onClick={remove}>Delete</button>
                </div>
            )}
        </li>
    );
};

const JellyfinUserRow: FC<{ user: JellyfinUserSummary, accounts: AccountWithProfiles[], run: Run }> = ({ user, accounts, run }) => {
    const [target, setTarget] = useState('');
    const onTargetChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => setTarget(e.target.value), []);
    const adopt = useCallback(() => run(() => accountsApi.admin.adopt({ accountId: Number(target), jellyfinUserId: user.id })), [target, user.id, run]);

    return (
        <li>
            <div className='hfAccounts-who'>
                <strong>{user.name}</strong>
                {user.isAdmin && <span className='hfTag hfTag-muted'>Administrator</span>}
            </div>
            {!user.isAdmin && (
                <div className='hfAccounts-actions'>
                    <select className='hfSelect' value={target} onChange={onTargetChange} aria-label={`Account for ${user.name}`}>
                        <option value=''>Choose an account…</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
                    </select>
                    <button type='button' className='hfButton hfButton-outline' disabled={!target} onClick={adopt}>Make profile</button>
                </div>
            )}
        </li>
    );
};

// ── page ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = { name: '', email: '', password: '' };

/** Server owner tools: invite links, accounts, existing Jellyfin users. */
export default function HomefinAdmin() {
    const navigate = useNavigate();
    // A Home Fin admin account, or a Jellyfin administrator on their own Jellyfin login.
    const [admin, setAdmin] = useState<{ name: string, accountId: number | null } | null | 'denied'>(null);
    const avatars = useAvatars();
    const [accounts, setAccounts] = useState<AccountWithProfiles[]>([]);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [users, setUsers] = useState<JellyfinUserSummary[]>([]);
    const [error, setError] = useState('');
    const [newInvite, setNewInvite] = useState<Invite | null>(null);
    const [inviteNote, setInviteNote] = useState('');
    const [copied, setCopied] = useState(false);
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const inviteInput = useRef<HTMLInputElement>(null);
    const moveInput = useRef<HTMLTextAreaElement>(null);
    const [moveCopied, setMoveCopied] = useState(false);
    const onInviteNoteChange = useInputSetter(setInviteNote);

    const load = useCallback(async () => {
        const [a, i, u] = await Promise.all([accountsApi.admin.accounts(), accountsApi.admin.invites(), accountsApi.admin.jellyfinUsers()]);
        setAccounts(a.accounts);
        setInvites(i.invites);
        setUsers(u.users);
    }, []);

    useEffect(() => {
        fireAndForget(accountsApi.admin.me()
            .then(async who => {
                setAdmin(who);
                await load();
            })
            .catch(err => {
                if (err instanceof AccountsError && err.status === 401) navigate('/homefin/login');
                else if (err instanceof AccountsError && err.status === 404) setAdmin('denied');
                else setError(errorMessage(err));
            }));
    }, [load, navigate]);

    const run = useCallback<Run>(action => {
        setError('');
        action().then(load).catch(err => setError(errorMessage(err)));
    }, [load]);

    const createInvite = useCallback((e: FormEvent) => {
        e.preventDefault();
        run(async () => {
            const { invite } = await accountsApi.admin.createInvite({ note: inviteNote || undefined, baseUrl: inviteBaseUrl() });
            setNewInvite(invite);
            setInviteNote('');
            setCopied(false);
        });
    }, [inviteNote, run]);

    const selectInvite = useCallback(() => inviteInput.current?.select(), []);
    const copyInvite = useCallback(() => {
        if (newInvite?.url) copyText(newInvite.url, () => setCopied(true), selectInvite);
    }, [newInvite, selectInvite]);
    const selectMove = useCallback(() => moveInput.current?.select(), []);
    const copyMove = useCallback(() => copyText(moveMessage(), () => setMoveCopied(true), selectMove), [selectMove]);
    const waiting = users.filter(user => !user.isAdmin).length;

    const toggleAdding = useCallback(() => setAdding(value => !value), []);
    const onFormChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setForm(current => ({ ...current, [name]: value }));
    }, []);
    const createAccount = useCallback((e: FormEvent) => {
        e.preventDefault();
        run(async () => {
            await accountsApi.admin.createAccount(form);
            setForm(EMPTY_FORM);
            setAdding(false);
        });
    }, [form, run]);

    useEffect(() => {
        if (newInvite) selectInvite();
    }, [newInvite, selectInvite]);

    if (admin === 'denied') {
        return <Screen id='homefinAdminPage' title='Admin'><section className='hfAccount'><h1>Not available</h1></section></Screen>;
    }

    return (
        <Screen
            id='homefinAdminPage'
            title='Admin'
            variant='plain'
            headerRight={admin?.accountId ?
                <a className='hfScreen-back' href='#/homefin/account'>Back to account</a> :
                <a className='hfScreen-back' href='#/homefin/settings?section=server'>Back to settings</a>}
        >
            <section className='hfAccount hfAdmin'>
                <h1>People</h1>
                <ErrorBanner message={error} />

                <div className='hfPanel'>
                    <h2>Invite someone</h2>
                    <p className='hfPanel-note'>Make a link, send it however you like. It works once and lasts 7 days; they choose their own email and password.</p>
                    <form className='hfInline' onSubmit={createInvite}>
                        <Field id='hfInviteNote' label='Who is it for? (optional)' value={inviteNote} onChange={onInviteNoteChange} maxLength={100} />
                        <button type='submit' className='hfButton hfButton-red'>Create invite link</button>
                    </form>
                    {newInvite?.url && (
                        <div className='hfInviteLink'>
                            <input ref={inviteInput} readOnly value={newInvite.url} aria-label='Invite link' onFocus={selectInvite} />
                            <button type='button' className='hfButton hfButton-primary' onClick={copyInvite}>{copied ? 'Copied' : 'Copy'}</button>
                        </div>
                    )}
                    {invites.length > 0 && (
                        <table className='hfTable'>
                            <thead><tr><th>For</th><th>Created</th><th>Status</th><th aria-label='Actions' /></tr></thead>
                            <tbody>
                                {invites.map(invite => <InviteRow key={invite.id} invite={invite} run={run} />)}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className='hfPanel'>
                    <div className='hfPanel-head'>
                        <h2>Accounts</h2>
                        <button type='button' className='hfButton hfButton-outline' onClick={toggleAdding}>{adding ? 'Cancel' : 'Add account'}</button>
                    </div>
                    {adding && (
                        <form className='hfStack' onSubmit={createAccount}>
                            <Field id='hfNewName' name='name' label='Name' value={form.name} onChange={onFormChange} required maxLength={30} />
                            <Field id='hfNewEmail' name='email' label='Email' type='email' value={form.email} onChange={onFormChange} required />
                            <Field id='hfNewPw' name='password' label='Temporary password (8+)' type='password' autoComplete='new-password' minLength={8} value={form.password} onChange={onFormChange} required />
                            <button type='submit' className='hfButton hfButton-primary'>Create account</button>
                        </form>
                    )}
                    <ul className='hfAccounts'>
                        {accounts.map(account => (
                            <AccountRow key={account.id} account={account} avatars={avatars} isSelf={account.id === admin?.accountId} run={run} />
                        ))}
                    </ul>
                </div>

                <div className='hfPanel'>
                    <h2>Existing Jellyfin users</h2>
                    {waiting > 0 && (
                        <>
                            <p className='hfPanel-note'>
                                {waiting === 1 ? '1 person still signs' : `${waiting} people still sign`} in with a Jellyfin username.
                                Send them this: they move themselves over in a minute, with their history.
                            </p>
                            <div className='hfInviteLink'>
                                <textarea ref={moveInput} readOnly rows={3} value={moveMessage()} aria-label='Message for people to move over' onFocus={selectMove} />
                                <button type='button' className='hfButton hfButton-primary' onClick={copyMove}>{moveCopied ? 'Copied' : 'Copy'}</button>
                            </div>
                        </>
                    )}
                    <p className='hfPanel-note'>Or move someone yourself: turn their Jellyfin user into a profile of an account. Administrator users stay as normal Jellyfin logins.</p>
                    {users.length === 0 && <p className='hfPanel-note'>Every Jellyfin user is already a profile.</p>}
                    <ul className='hfAccounts'>
                        {users.map(user => <JellyfinUserRow key={user.id} user={user} accounts={accounts} run={run} />)}
                    </ul>
                </div>
            </section>
        </Screen>
    );
}
