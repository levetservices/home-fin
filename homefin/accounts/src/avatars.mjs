// Preset profile avatars: an emoji on a gradient tile. Keys are what profiles store.
export const AVATARS = [
    { key: 'fox', emoji: '🦊', from: '#ff9a3c', to: '#d1451b' },
    { key: 'panda', emoji: '🐼', from: '#9be15d', to: '#00b37a' },
    { key: 'tiger', emoji: '🐯', from: '#ffd54f', to: '#f57c00' },
    { key: 'lion', emoji: '🦁', from: '#f6d365', to: '#c88a1b' },
    { key: 'frog', emoji: '🐸', from: '#a8e063', to: '#3a9b2c' },
    { key: 'octopus', emoji: '🐙', from: '#f093fb', to: '#c2185b' },
    { key: 'unicorn', emoji: '🦄', from: '#c471f5', to: '#7b2ff7' },
    { key: 'penguin', emoji: '🐧', from: '#89f7fe', to: '#3a7bd5' },
    { key: 'koala', emoji: '🐨', from: '#cfd9df', to: '#6b7a8f' },
    { key: 'monkey', emoji: '🐵', from: '#e6b980', to: '#9c6b30' },
    { key: 'owl', emoji: '🦉', from: '#a18cd1', to: '#5b3f9e' },
    { key: 'dolphin', emoji: '🐬', from: '#4facfe', to: '#0061c2' },
    { key: 'polarbear', emoji: '🐻‍❄️', from: '#d4fc79', to: '#43c6ac' },
    { key: 'rhino', emoji: '🦏', from: '#fddb92', to: '#b8860b' },
    { key: 'parrot', emoji: '🦜', from: '#30cfd0', to: '#1e6f5c' },
    { key: 'alien', emoji: '👾', from: '#ff6b9d', to: '#7a1fa2' }
];

export const AVATAR_KEYS = new Set(AVATARS.map(a => a.key));

export function defaultAvatar(index = 0) {
    return AVATARS[index % AVATARS.length].key;
}
