/**
 * Lorebook context for RPG Companion's own model requests (Cast, and the tracker request in Separate and
 * External modes). Those requests are built by the extension, so SillyTavern's World Info never reaches
 * them; with a blank-slate card and the characters kept in lorebooks they knew nothing about anyone.
 *
 * The chat lorebook (the one bound to the chat with the lock button in the chat's menu) comes first:
 *  1. its always-on (constant) entries;
 *  2. entries about the characters named (a key or the entry's title is their name or first name);
 *  3. entries whose keys come up in the story being read (so new characters and places are recognised).
 * Within 2 and 3, the chat lorebook's entries go before other lorebooks' entries. Disabled entries and regex
 * keys are skipped, and the whole is capped. Empty when there is nothing to read or SillyTavern can't list it.
 */
import { chat_metadata } from '../../../../../../script.js';

const LORE_LIMIT = 6000;        // characters of lorebook text per request
const LORE_ENTRY_LIMIT = 2000;  // and at most this much of any one entry

/** The name of the lorebook bound to the current chat, or null. */
export function chatLorebookName() {
    const name = chat_metadata?.world_info;
    return typeof name === 'string' && name.trim() ? name : null;
}

async function loadEntries(chatOnly) {
    const worldInfo = await import('../../../../../world-info.js');
    const chatWorld = chatLorebookName();
    if (chatOnly) {
        if (!chatWorld) return [];
        const data = await worldInfo.loadWorldInfo(chatWorld);
        return data?.entries ? Object.values(data.entries).map((entry) => ({ ...entry, world: chatWorld })) : [];
    }
    // Every active lorebook: global, the character's, the chat's and the persona's
    const entries = await worldInfo.getSortedEntries();
    return Array.isArray(entries) ? entries : [];
}

/**
 * @param {object} options
 * @param {string[]} [options.names] - characters the request is about
 * @param {string} [options.storyText] - the messages the request reads
 * @param {boolean} [options.chatOnly] - only the chat lorebook (otherwise every active lorebook)
 * @param {number} [options.limit] - most characters of lorebook text
 * @returns {Promise<string>} the entries, "[Title]\ncontent" each, or ''
 */
export async function lorebookContext({ names = [], storyText = '', chatOnly = false, limit = LORE_LIMIT } = {}) {
    let entries;
    try {
        entries = await loadEntries(chatOnly);
    } catch {
        return '';
    }
    if (!entries.length) return '';

    const chatWorld = chatLorebookName();
    const fromChat = (entry) => !!chatWorld && entry.world === chatWorld;
    const lower = (s) => String(s || '').trim().toLowerCase();
    const plainKeys = (entry) => [...(entry.key || []), ...(entry.keysecondary || [])]
        .map(lower).filter((k) => k && !k.startsWith('/'));
    const tokens = new Set();
    for (const name of [...names].sort()) {
        const full = lower(name);
        if (!full) continue;
        tokens.add(full);
        const firstName = full.split(/\s+/)[0];
        if (firstName.length >= 3) tokens.add(firstName);
    }
    const story = lower(storyText);
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inStory = (key) => key.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(key)}($|[^\\p{L}\\p{N}])`, 'u').test(story);
    const chatFirst = (list) => [...list.filter(fromChat), ...list.filter((e) => !fromChat(e))];

    const usable = entries.filter((e) => e && !e.disable && String(e.content || '').trim());
    const always = usable.filter((e) => fromChat(e) && e.constant);
    const aboutNamed = chatFirst(usable.filter((e) => !always.includes(e)
        && (plainKeys(e).some((k) => tokens.has(k)) || [...tokens].some((t) => t.includes(' ') && lower(e.comment).includes(t)))));
    const mentioned = story ? chatFirst(usable.filter((e) => !always.includes(e) && !aboutNamed.includes(e) && plainKeys(e).some(inStory))) : [];

    const seen = new Set();
    const parts = [];
    let used = 0;
    for (const entry of [...always, ...aboutNamed, ...mentioned]) {
        const id = `${entry.world}:${entry.uid}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const title = String(entry.comment || entry.key?.[0] || '').trim();
        const text = `${title ? `[${title}]\n` : ''}${String(entry.content).trim().slice(0, LORE_ENTRY_LIMIT)}`;
        if (used + text.length > limit) break;
        parts.push(text);
        used += text.length;
    }
    return parts.join('\n\n');
}
