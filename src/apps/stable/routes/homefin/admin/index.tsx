import React, { type FormEvent, useCallback, useEffect, useState } from 'react';

import { accountsApi, type Account, type Invite, type JellyfinUserSummary, type Profile } from 'homefin/accounts/api';
import { Avatar, findAvatar } from 'homefin/accounts/avatar';
import { ErrorBanner, Field, Screen, errorMessage, useAvatars, useMe } from 'homefin/accounts/components';

type AccountWithProfiles = Account & { profiles: Profile[] };

function inviteBaseUrl() {
    return window.location.href.split('#')[0];
}

function formatDate(value?: string | null) {
    if (!value) return '';
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Server owner tools: invite links, accounts, existing Jellyfin users. */
export default function HomefinAdmin() {
    const { me } = useMe();
    const avatars = useAvatars();
    const [accounts, setAccounts] = useState<AccountWithProfiles[]>([]);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [users, setUsers] = useState<JellyfinUserSummary[]>([]);
    const [error, setError] = useState('');
    const [newInvite, setNewInvite] = useState<Invite | null>(null);
    const [inviteNote, setInviteNote] = useState('');
    const [copied, setCopied] = useState(false);
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [adoptTarget, setAdoptTarget] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        try {
            const [a, i, u] = await Promise.all([accountsApi.admin.accounts(), accountsApi.admin.invites(), accountsApi.admin.jellyfinUsers()]);
            setAccounts(a.accounts);
            setInvites(i.invites);
            setUsers(u.users);
        } catch (err) {
            setError(errorMessage(err));
        }
    }, []);

    useEffect(() => {
        if (me?.account.isAdmin) void load();
    }, [me, load]);

    const run = async (action: () => Promise<unknown>) => {
        setError('');
        try {
            await action();
            await load();
        } catch (err) {
            setError(errorMessage(err));
        }
    };

    const createInvite = (e: FormEvent) => {
        e.preventDefault();
        void run(async () => {
            const { invite } = await accountsApi.admin.createInvite({ note: inviteNote || undefined, baseUrl: inviteBaseUrl() });
            setNewInvite(invite);
            setInviteNote('');
            setCopied(false);
        });
    };

    const copyInvite = async () => {
        if (!newInvite?.url) return;
        try {
            await navigator.clipboard.writeText(newInvite.url);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    };

    const createAccount = (e: FormEvent) => {
        e.preventDefault();
        void run(async () => {
            await accountsApi.admin.createAccount(form);
            setForm({ name: '', email: '', password: '' });
            setAdding(false);
        });
    };

    if (me && !me.account.isAdmin) {
        return <Screen id='homefinAdminPage' title='Admin'><section className='hfAccount'><h1>Not available</h1></section></Screen>;
    }

    return (
        <Screen id='homefinAdminPage' title='Admin' variant='plain' headerRight={<a className='hfScreen-back' href='#/homefin/account'>Back to account</a>}>
            <section className='hfAccount hfAdmin'>
                <h1>People</h1>
                <ErrorBanner message={error} />

                <div className='hfPanel'>
                    <h2>Invite someone</h2>
                    <p className='hfPanel-note'>Make a link, send it however you like. It works once and lasts 7 days; they choose their own email and password.</p>
                    <form className='hfInline' onSubmit={createInvite}>
                        <Field id='hfInviteNote' label='Who is it for? (optional)' value={inviteNote} onChange={e => setInviteNote(e.target.value)} maxLength={100} />
                        <button type='submit' className='hfButton hfButton-red'>Create invite link</button>
                    </form>
                    {newInvite?.url && (
                        <div className='hfInviteLink'>
                            <input readOnly value={newInvite.url} aria-label='Invite link' onFocus={e => e.target.select()} />
                            <button type='button' className='hfButton hfButton-primary' onClick={copyInvite}>{copied ? 'Copied' : 'Copy'}</button>
                        </div>
                    )}
                    {invites.length > 0 && (
                        <table className='hfTable'>
                            <thead><tr><th>For</th><th>Created</th><th>Status</th><th /></tr></thead>
                            <tbody>
                                {invites.map(invite => {
                                    const expired = !invite.used_at && invite.expires_at && invite.expires_at < new Date().toISOString();
                                    let status = `Expires ${formatDate(invite.expires_at)}`;
                                    if (invite.used_at) status = `Used by ${invite.used_by || 'someone'}`;
                                    else if (expired) status = 'Expired';
                                    return (
                                        <tr key={invite.id}>
                                            <td>{invite.note || invite.email || '—'}</td>
                                            <td>{formatDate(invite.created_at)}</td>
                                            <td>{status}</td>
                                            <td>
                                                {!invite.used_at && (
                                                    <button type='button' className='hfLinkButton' onClick={() => void run(() => accountsApi.admin.deleteInvite(invite.id))}>Revoke</button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className='hfPanel'>
                    <div className='hfPanel-head'>
                        <h2>Accounts</h2>
                        <button type='button' className='hfButton hfButton-outline' onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add account'}</button>
                    </div>
                    {adding && (
                        <form className='hfStack' onSubmit={createAccount}>
                            <Field id='hfNewName' label='Name' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={30} />
                            <Field id='hfNewEmail' label='Email' type='email' value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
                            <Field id='hfNewPw' label='Temporary password (8+)' type='password' autoComplete='new-password' minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
                            <button type='submit' className='hfButton hfButton-primary'>Create account</button>
                        </form>
                    )}
                    <ul className='hfAccounts'>
                        {accounts.map(account => (
                            <li key={account.id} className={account.disabled ? 'is-disabled' : ''}>
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
                                {account.id !== me?.account.id && (
                                    <div className='hfAccounts-actions'>
                                        <button type='button' className='hfLinkButton' onClick={() => {
                                            const password = window.prompt(`New password for ${account.email} (8+ characters)`);
                                            if (password) void run(() => accountsApi.admin.updateAccount(account.id, { password }));
                                        }}>Reset password</button>
                                        <button type='button' className='hfLinkButton' onClick={() => void run(() => accountsApi.admin.updateAccount(account.id, { disabled: !account.disabled }))}>
                                            {account.disabled ? 'Enable' : 'Disable'}
                                        </button>
                                        <button type='button' className='hfLinkButton hfLinkButton-danger' onClick={() => {
                                            if (window.confirm(`Delete ${account.email} and all of its profiles? Their watch history goes too.`)) {
                                                void run(() => accountsApi.admin.deleteAccount(account.id));
                                            }
                                        }}>Delete</button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className='hfPanel'>
                    <h2>Existing Jellyfin users</h2>
                    <p className='hfPanel-note'>Turn a Jellyfin user into a profile of an account and keep their watch history. Administrator users stay as normal Jellyfin logins.</p>
                    {users.length === 0 && <p className='hfPanel-note'>Every Jellyfin user is already a profile.</p>}
                    <ul className='hfAccounts'>
                        {users.map(user => (
                            <li key={user.id}>
                                <div className='hfAccounts-who'>
                                    <strong>{user.name}</strong>
                                    {user.isAdmin && <span className='hfTag hfTag-muted'>Administrator</span>}
                                </div>
                                {!user.isAdmin && (
                                    <div className='hfAccounts-actions'>
                                        <select
                                            className='hfSelect'
                                            value={adoptTarget[user.id] ?? ''}
                                            onChange={e => setAdoptTarget({ ...adoptTarget, [user.id]: e.target.value })}
                                            aria-label={`Account for ${user.name}`}
                                        >
                                            <option value=''>Choose an account…</option>
                                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
                                        </select>
                                        <button
                                            type='button'
                                            className='hfButton hfButton-outline'
                                            disabled={!adoptTarget[user.id]}
                                            onClick={() => void run(() => accountsApi.admin.adopt({ accountId: Number(adoptTarget[user.id]), jellyfinUserId: user.id }))}
                                        >Make profile</button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </section>
        </Screen>
    );
}
