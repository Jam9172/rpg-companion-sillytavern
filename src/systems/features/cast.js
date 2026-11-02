/**
 * Cast: character persistence for the whole story.
 *
 * A ledger of every character met in the chat (saved in the chat's metadata). After each reply a
 * background model updates the characters involved; before each reply the characters in the scene or
 * recently mentioned are fed to the main model, with a one-line roster of everyone else.
 *
 * Memory is kept short in three levels:
 *   steps  - what a character is doing right now ("gets in the car", "shopping in the aisles")
 *   events - finished activities, each folded into one outcome ("went to the store and got 10 eggs")
 *   bio    - the oldest events folded into two or three sentences of who they are now
 *
 * Every update remembers the message that caused it, so deleting or swiping that message undoes it.
 */

import {
    chat,
    chat_metadata,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    saveChatDebounced,
    setExtensionPrompt,
} from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings, isGenerating } from '../../core/state.js';
import { generateWithExternalAPI } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

const PROMPT_KEY = 'rpg-companion-cast';
const METADATA_KEY = 'rpg_cast';

// Limits that keep each character short
const MAX_STEPS = 6;          // more than this and the activity is folded into an event
const MAX_EVENTS = 10;        // more than this and the oldest are folded into the bio
const EVENTS_TO_FOLD = 6;     // how many of the oldest events go into the bio at once
const EVENTS_IN_PROMPT = 3;   // recent events shown to the main model per character
const MAX_JOURNAL = 200;      // undo entries kept (older ones can no longer be rolled back)

const listeners = [];
let updateQueue = Promise.resolve();

/* ---------- Ledger ---------- */

/**
 * The current chat's cast ledger, created on first use.
 * @returns {{version: number, characters: Object<string, Object>, journal: Array}}
 */
export function getCast() {
    if (!chat_metadata[METADATA_KEY] || typeof chat_metadata[METADATA_KEY] !== 'object') {
        chat_metadata[METADATA_KEY] = { version: 1, characters: {}, journal: [] };
    }
    const cast = chat_metadata[METADATA_KEY];
    cast.characters ??= {};
    cast.journal ??= [];
    return cast;
}

/** @returns {string} A stable key for a character name */
export function castKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function newCharacter(name) {
    return {
        name: String(name).trim(),
        aliases: [],
        role: '',
        appearance: '',
        personality: '',
        relationship: '',
        location: '',
        status: 'present',
        bio: '',
        events: [],
        steps: [],
        locked: false,
        firstSeen: chat.length - 1,
        lastSeen: chat.length - 1,
    };
}

/** Finds a character by name or alias. */
export function findCharacter(cast, name) {
    const key = castKey(name);
    if (!key) return null;
    if (cast.characters[key]) return cast.characters[key];
    const characters = Object.values(cast.characters);
    const byAlias = characters.find((c) => (c.aliases || []).some((a) => castKey(a) === key));
    if (byAlias) return byAlias;
    // A shorter or longer form of a known name ("Mira" for "Mira Ashdown", or the other way round),
    // when it fits exactly one character
    const words = key.split(' ');
    const partial = characters.filter((c) => {
        const known = castKey(c.name).split(' ');
        const [shorter, longer] = words.length <= known.length ? [words, known] : [known, words];
        return shorter.every((w) => longer.includes(w));
    });
    return partial.length === 1 ? partial[0] : null;
}

/** All characters, the most recently seen first. */
export function listCharacters() {
    return Object.values(getCast().characters).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

function saveCast() {
    saveChatDebounced();
    listeners.forEach((fn) => {
        try { fn(); } catch (e) { console.error('[RPG Companion] Cast listener failed:', e); }
    });
}

/** Calls fn whenever the cast changes (used by the Cast tab). */
export function onCastChanged(fn) {
    listeners.push(fn);
}

/* ---------- Editing from the Cast tab ---------- */

/**
 * Changes a character's fields by hand. Hand edits are not tied to a message, so they are never rolled back.
 * @param {string} name - The character
 * @param {Object} fields - Fields to set
 */
export function editCharacter(name, fields) {
    const cast = getCast();
    const character = findCharacter(cast, name);
    if (!character) return;
    Object.assign(character, fields);
    saveCast();
}

/** Removes a character from the cast by hand. */
export function deleteCharacter(name) {
    const cast = getCast();
    const character = findCharacter(cast, name);
    if (!character) return;
    delete cast.characters[castKey(character.name)];
    saveCast();
}

/* ---------- Message identity (for rollback) ---------- */

function messageSignature(index) {
    const message = chat[index];
    if (!message) return null;
    return `${message.send_date ?? ''}|${message.swipe_id ?? 0}`;
}

/**
 * Undoes updates whose message is gone: deleted, swiped to another reply, or cut off by going back.
 * Newest updates are undone first, so earlier ones stay intact.
 */
export function reconcileCast() {
    if (!chat_metadata?.[METADATA_KEY]) return;
    const cast = getCast();
    let changed = false;
    while (cast.journal.length) {
        const entry = cast.journal[cast.journal.length - 1];
        if (messageSignature(entry.messageIndex) === entry.signature) break;
        // An earlier message was deleted and this one moved up: follow it instead of undoing
        const movedTo = chat.findIndex((_, i) => messageSignature(i) === entry.signature);
        if (movedTo >= 0) {
            cast.journal.forEach((e) => {
                const at = chat.findIndex((_, i) => messageSignature(i) === e.signature);
                if (at >= 0) e.messageIndex = at;
            });
            changed = true;
            break;
        }
        for (const [key, before] of Object.entries(entry.before)) {
            if (before === null) delete cast.characters[key];
            else cast.characters[key] = before;
        }
        cast.journal.pop();
        changed = true;
    }
    if (changed) {
        saveCast();
        refreshCastPrompt();
    }
}

/* ---------- Background update ---------- */

function compact(character, full) {
    const out = { name: character.name };
    if (character.role) out.role = character.role;
    if (!full) {
        if (character.location) out.last_seen = character.location;
        return out;
    }
    for (const field of ['aliases', 'appearance', 'personality', 'relationship', 'location', 'status', 'bio']) {
        const value = character[field];
        if (Array.isArray(value) ? value.length : value) out[field] = value;
    }
    if (character.events?.length) out.events = character.events;
    if (character.steps?.length) out.steps = character.steps;
    return out;
}

function messageText(message) {
    return String(message?.mes ?? '').replace(/<[^>]*>/g, '').trim();
}

/**
 * Builds the background model's request: the characters it may need, the latest messages, and the
 * rules for steps, events and the bio.
 */
function buildUpdatePrompt(messageIndex) {
    const cast = getCast();
    const context = getContext();
    const userName = context.name1 || 'User';
    const depth = Math.max(2, Number(extensionSettings.castUpdateDepth) || 4);
    const recent = chat.slice(Math.max(0, messageIndex - depth + 1), messageIndex + 1).filter((m) => !m.is_system);
    const recentText = recent.map((m) => messageText(m)).join('\n');

    const characters = Object.values(cast.characters);
    const mentioned = characters.filter((c) => c.status === 'present' || isMentioned(c, recentText));
    const others = characters.filter((c) => !mentioned.includes(c));
    const needsBio = mentioned.filter((c) => (c.events?.length || 0) > MAX_EVENTS).map((c) => c.name);

    const system = `You keep the cast ledger for an ongoing roleplay story: a short, lasting memory of every character other than ${userName}. You never write story text, only the requested JSON.

Rules:
- Only include characters who appear, act or are meaningfully mentioned in the NEW messages. Leave everyone else out.
- Use the exact name already in the ledger when a character is known (match nicknames and titles to them). Add a new character only when they are a real person in the story, not a passing crowd.
- Never record ${userName} as a character.
- "set": only fields that changed or are new: role (a few words, like "innkeeper"), appearance, personality, relationship (how they feel about ${userName}), location (where they are now), status ("present" if in the current scene, otherwise "away"; "dead" if they died). Keep each to one short phrase. Appearance and personality are lasting traits, not momentary states.
- "step": a few words for a NEW development in what the character is doing right now ("gets in the car", "shopping in the aisles"). Do not repeat a step that is still true; ten turns of shopping is still one step.
- "finish": when an activity is over (they left, the scene moved on, or it reached its result), one short past-tense sentence of the outcome that matters ("went to the store and got 10 eggs"). This replaces their current steps. If a character has ${MAX_STEPS} or more steps, finish it now.
- Keep everything brief. A side character needs only a few words per field.
${needsBio.length ? `- "bio": for ${needsBio.join(', ')}, write two or three sentences of who they are now and what still matters, merging their current bio with their ${EVENTS_TO_FOLD} oldest events. Drop details that no longer matter.\n` : ''}
Reply with JSON only:
{"characters": [{"name": "Name", "set": {"location": "..."}, "step": "...", "finish": "...", "bio": "..."}]}
Use {"characters": []} if nothing changed.`;

    const ledger = {
        relevant: mentioned.map((c) => compact(c, true)),
        others: others.map((c) => compact(c, false)),
    };

    const history = recent.map((m) => `${m.is_user ? userName : (m.name || 'Narrator')}: ${messageText(m)}`).join('\n\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: `Current ledger:\n${JSON.stringify(ledger)}\n\nNEW messages (the last one is the newest):\n<messages>\n${history}\n</messages>\n\nUpdate the ledger. JSON only.` },
    ];
}

function parseUpdate(text) {
    if (typeof text !== 'string') return null;
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const data = JSON.parse(cleaned.slice(start, end + 1));
        return Array.isArray(data?.characters) ? data.characters : null;
    } catch {
        return null;
    }
}

const SETTABLE = ['role', 'appearance', 'personality', 'relationship', 'location', 'status'];

/**
 * Applies the background model's changes, recording each touched character's previous state so the
 * update can be undone with its message.
 * @returns {number} How many characters changed
 */
export function applyCastUpdate(updates, messageIndex) {
    const cast = getCast();
    const userKey = castKey(getContext().name1);
    const before = {};
    let changed = 0;

    for (const update of updates) {
        const name = String(update?.name || '').trim();
        if (!name || castKey(name) === userKey) continue;

        let character = findCharacter(cast, name);
        if (character?.locked) continue;
        if (character && castKey(character.name) !== castKey(name) && !(character.aliases || []).some((a) => castKey(a) === castKey(name))) {
            if (!(castKey(character.name) in before)) before[castKey(character.name)] = structuredClone(character);
            character.aliases = [...(character.aliases || []), name];
        }
        const key = character ? castKey(character.name) : castKey(name);
        if (!(key in before)) before[key] = character ? structuredClone(character) : null;
        if (!character) {
            character = newCharacter(name);
            cast.characters[key] = character;
        }

        const set = update.set && typeof update.set === 'object' ? update.set : {};
        for (const field of SETTABLE) {
            const value = set[field];
            if (typeof value === 'string' && value.trim()) character[field] = value.trim();
        }
        if (Array.isArray(set.aliases)) {
            character.aliases = [...new Set([...(character.aliases || []), ...set.aliases.map(String).filter(Boolean)])];
        }

        if (typeof update.finish === 'string' && update.finish.trim()) {
            character.events.push(update.finish.trim());
            character.steps = [];
        }
        if (typeof update.step === 'string' && update.step.trim() && character.steps.at(-1) !== update.step.trim()) {
            character.steps.push(update.step.trim());
        }
        // The model forgot to finish a long activity: keep only the latest steps
        if (character.steps.length > MAX_STEPS) character.steps = character.steps.slice(-MAX_STEPS);

        if (typeof update.bio === 'string' && update.bio.trim() && character.events.length > MAX_EVENTS) {
            character.bio = update.bio.trim();
            character.events = character.events.slice(EVENTS_TO_FOLD);
        }

        character.lastSeen = messageIndex;
        changed++;
    }

    // When the model names who is in the scene, everyone else who was present has stepped out of it
    const touched = new Set(Object.keys(before));
    const sceneReported = updates.some((u) => u?.set?.status === 'present');
    for (const [key, character] of Object.entries(cast.characters)) {
        if (!sceneReported || touched.has(key) || character.locked || character.status !== 'present') continue;
        before[key] = structuredClone(character);
        character.status = 'away';
    }

    if (Object.keys(before).length) {
        cast.journal.push({ messageIndex, signature: messageSignature(messageIndex), before });
        if (cast.journal.length > MAX_JOURNAL) cast.journal.splice(0, cast.journal.length - MAX_JOURNAL);
        saveCast();
    }
    return changed;
}

async function requestUpdate(messages) {
    if (extensionSettings.generationMode === 'external') {
        return await generateWithExternalAPI(messages);
    }
    return await safeGenerateRaw({ prompt: messages, quietToLoud: false });
}

async function waitForTrackers(maxMs = 120000) {
    // Give RPG Companion's own tracker update a moment to start, then wait for it to finish
    await new Promise((r) => setTimeout(r, 1000));
    const started = Date.now();
    while (isGenerating && Date.now() - started < maxMs) {
        await new Promise((r) => setTimeout(r, 500));
    }
}

/**
 * Updates the cast from the reply at messageIndex. Runs one at a time, after RPG Companion's own
 * tracker update so the two requests never overlap.
 */
export function updateCastFromMessage(messageIndex) {
    updateQueue = updateQueue.then(async () => {
        if (!extensionSettings.enabled || extensionSettings.castEnabled === false) return;
        const message = chat[messageIndex];
        if (!message || message.is_user || message.is_system) return;

        await waitForTrackers();
        const chatId = getContext().chatId;
        const signature = messageSignature(messageIndex);

        let response;
        try {
            response = await requestUpdate(buildUpdatePrompt(messageIndex));
        } catch (error) {
            console.warn('[RPG Companion] Cast update failed:', error);
            return;
        }
        // The chat or the reply changed while we waited: drop this result
        if (getContext().chatId !== chatId || messageSignature(messageIndex) !== signature) return;

        const updates = parseUpdate(response);
        if (!updates) {
            console.warn('[RPG Companion] Cast update: could not read the reply as JSON');
            return;
        }
        applyCastUpdate(updates, messageIndex);
        refreshCastPrompt();
    }).catch((error) => console.error('[RPG Companion] Cast update error:', error));
    return updateQueue;
}

/* ---------- Feeding the main model ---------- */

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether a character's name, first name or an alias appears in the text. */
export function isMentioned(character, text) {
    if (!text) return false;
    const names = [character.name, ...(character.aliases || [])];
    const first = String(character.name).split(/\s+/)[0];
    if (first && first.length >= 3 && first !== character.name) names.push(first);
    return names.some((n) => n && new RegExp(`(^|[^\\p{L}])${escapeRegex(n)}($|[^\\p{L}])`, 'iu').test(text));
}

function describe(character, userName) {
    const parts = [];
    if (character.appearance) parts.push(`Looks: ${character.appearance}`);
    if (character.personality) parts.push(`Personality: ${character.personality}`);
    if (character.relationship) parts.push(`Toward ${userName}: ${character.relationship}`);
    if (character.bio) parts.push(`Background: ${character.bio}`);
    const events = (character.events || []).slice(-EVENTS_IN_PROMPT);
    if (events.length) parts.push(`Recently: ${events.join('; ')}`);
    if (character.steps?.length) parts.push(`Doing now: ${character.steps.join(' → ')}`);
    if (character.location) parts.push(`${character.status === 'present' ? 'At' : 'Last seen at'}: ${character.location}`);
    if (character.status === 'dead') parts.push('Status: dead');
    const role = character.role ? ` (${character.role})` : '';
    return `- ${character.name}${role}. ${parts.join('. ')}`;
}

/**
 * The cast notes for the main model: full entries for characters in the scene or mentioned in the
 * latest messages, and a roster line for everyone else.
 */
export function buildCastNotes() {
    const characters = Object.values(getCast().characters);
    if (!characters.length) return '';
    const userName = getContext().name1 || 'User';
    const lookback = chat.slice(-2).map(messageText).join('\n');

    const relevant = characters.filter((c) => c.status === 'present' || isMentioned(c, lookback));
    const others = characters.filter((c) => !relevant.includes(c) && c.status !== 'dead');

    let notes = `<cast_notes>\nLasting memory of this story's characters, for consistency. Use it quietly: never quote or list these notes in the reply.\n`;
    if (relevant.length) notes += relevant.map((c) => describe(c, userName)).join('\n') + '\n';
    if (others.length) {
        notes += `Also known: ${others.map((c) => `${c.name}${c.role ? ` (${c.role}${c.location ? `, last seen at ${c.location}` : ''})` : ''}`).join('; ')}\n`;
    }
    notes += '</cast_notes>';
    return notes;
}

/** Puts the current cast notes in the main prompt (or clears them). */
export function refreshCastPrompt() {
    const enabled = extensionSettings.enabled && extensionSettings.castEnabled !== false;
    const notes = enabled ? buildCastNotes() : '';
    const depth = Math.max(0, Number(extensionSettings.castPromptDepth ?? 2));
    setExtensionPrompt(PROMPT_KEY, notes, extension_prompt_types.IN_CHAT, depth, false, extension_prompt_roles.SYSTEM);
}

/* ---------- Events ---------- */

export function initCast() {
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageIndex, type) => {
        if (type === 'impersonate') return;
        updateCastFromMessage(messageIndex);
    });
    // Notes follow the user's newest message (for who is mentioned) and every generation start
    eventSource.on(event_types.MESSAGE_SENT, refreshCastPrompt);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, (_type, _options, dryRun) => {
        if (!dryRun) refreshCastPrompt();
    });
    eventSource.on(event_types.MESSAGE_DELETED, reconcileCast);
    eventSource.on(event_types.MESSAGE_SWIPED, reconcileCast);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        reconcileCast();
        refreshCastPrompt();
        listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    });
}
