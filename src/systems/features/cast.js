/**
 * Cast: character persistence for the whole story.
 *
 * A ledger of the story's major characters, saved in the chat's metadata so it lasts the whole story.
 * It keeps only each character's own memory, written in first person:
 *   Doing now     - what I am doing right now; it never stops for characters who are away
 *   What happened - each finished activity in a few sentences; the oldest fold into one summary
 * Looks, personality and relationships are not tracked: they come from the character cards and the story.
 *
 * After each reply a background model updates the characters involved and moves the ones who are away
 * along off-screen. Before each reply the characters in the scene or recently mentioned are fed to the
 * main model, with a list of everyone else's names. Every update remembers the message that caused it, so
 * deleting or swiping that message undoes it.
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
import { extensionSettings, isGenerating, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { generateWithExternalAPI } from '../generation/apiClient.js';
import { getCharacterCardsInfo } from '../generation/promptBuilder.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

const PROMPT_KEY = 'rpg-companion-cast';
const METADATA_KEY = 'rpg_cast';

// Limits that keep each character short
const MAX_STEPS = 6;          // more than this and the activity is folded into an event
const MAX_EVENTS = 10;        // more than this and the oldest are folded into one summary
const EVENTS_TO_FOLD = 6;     // how many of the oldest events go into that summary at once
const EVENTS_IN_PROMPT = 3;   // recent events shown to the main model per character
const CARDS_LIMIT = 6000;     // characters of card descriptions sent to the background model
const MAX_JOURNAL = 200;      // undo entries kept (older ones can no longer be rolled back)

const listeners = [];
let updateQueue = Promise.resolve();

// The background update's state, shown in the Cast tab
const castStatus = { running: false, lastOk: null, lastError: null };

/** @returns {{running: boolean, lastOk: number|null, lastError: string|null}} */
export function getCastStatus() {
    return { ...castStatus };
}

function notify() {
    listeners.forEach((fn) => {
        try { fn(); } catch (e) { console.error('[RPG Companion] Cast listener failed:', e); }
    });
}

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
    cast.forgotten ??= [];
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
        status: 'present',
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

/** Whether a name (or a shorter or longer form of it) belongs to a character the user forgot. */
function isForgotten(cast, name) {
    const words = castKey(name).split(' ').filter(Boolean);
    if (!words.length) return false;
    return (cast.forgotten || []).some((forgotten) => {
        const known = castKey(forgotten).split(' ');
        const [shorter, longer] = words.length <= known.length ? [words, known] : [known, words];
        return shorter.every((w) => longer.includes(w));
    });
}

/** All characters, the most recently seen first. */
export function listCharacters() {
    return Object.values(getCast().characters).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

function saveCast() {
    saveChatDebounced();
    notify();
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

/**
 * Forgets a character for good: their memory is removed, later updates never add them back, and undoing
 * an update (swipe, delete, Refresh) never restores them. rememberCharacter() lets them be tracked again.
 */
export function deleteCharacter(name) {
    const cast = getCast();
    const character = findCharacter(cast, name);
    if (!character) return;
    const key = castKey(character.name);
    delete cast.characters[key];
    if (!cast.forgotten.some((n) => castKey(n) === key)) cast.forgotten.push(character.name);
    for (const entry of cast.journal) delete entry.before[key];
    saveCast();
    refreshCastPrompt();
}

/** The names of forgotten characters. */
export function listForgotten() {
    return [...getCast().forgotten];
}

/** Lets a forgotten character be tracked again (from scratch: their old memory is gone). */
export function rememberCharacter(name) {
    const cast = getCast();
    cast.forgotten = cast.forgotten.filter((n) => castKey(n) !== castKey(name));
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

/** A character's ledger entry as the background model sees it: their own memory only. */
function compact(character) {
    const out = { name: character.name, status: character.status };
    if (character.aliases?.length) out.aliases = character.aliases;
    // Without the off-screen marks: the model writes plain text and the mark is added on our side
    const plain = (lines) => lines.map((line) => line.replace(OFFSCREEN_PREFIX, ''));
    if (character.events?.length) out.what_happened = plain(character.events);
    if (character.steps?.length) out.doing_now = plain(character.steps);
    return out;
}

function messageText(message) {
    return String(message?.mes ?? '').replace(/<[^>]*>/g, '').trim();
}

/**
 * How many messages the background model reads per update: 0 means the whole story.
 * @returns {number}
 */
export function castReadRange() {
    const value = Number(extensionSettings.castUpdateDepth ?? 4);
    if (!Number.isFinite(value) || value < 0) return 4;
    return value === 0 ? 0 : Math.max(2, Math.round(value));
}

/** The in-story date, time and place from RPG Companion's Info Box, if it has one. */
function sceneInfo() {
    const info = lastGeneratedData?.infoBox || committedTrackerData?.infoBox;
    if (!info) return '';
    return String(info).replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * The characters on RPG Companion's Status tab (Present Characters), as short lines: who the tracker
 * says is in the scene now, with their details, relationship and thoughts.
 */
export function statusPanelCharacters() {
    const raw = lastGeneratedData?.characterThoughts || committedTrackerData?.characterThoughts;
    if (!raw) return '';
    try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.characters) ? parsed.characters : null);
        if (list) {
            return list.filter((c) => c?.name).map((c) => {
                const parts = [];
                for (const [key, value] of Object.entries(c.details || {})) {
                    if (value) parts.push(`${key.replace(/_/g, ' ')}: ${value}`);
                }
                const relationship = c.relationship?.status || c.relationship;
                if (relationship && typeof relationship === 'string') parts.push(`relationship: ${relationship}`);
                const thoughts = c.thoughts?.content || (typeof c.thoughts === 'string' ? c.thoughts : '');
                if (thoughts) parts.push(`thinking: ${thoughts}`);
                return `- ${c.name}${parts.length ? `: ${parts.join('; ')}` : ''}`;
            }).join('\n').slice(0, 3000);
        }
    } catch {
        // Older text format: pass it on as it is
    }
    return String(raw).slice(0, 3000);
}

/**
 * A character who is away gets their whole memory (every event and step), so their off-screen story
 * has everything it needs to continue, plus how long it has been since they were last seen.
 */
function awayEntry(character, messageIndex) {
    return {
        ...compact(character),
        replies_since_seen: Math.max(0, messageIndex - (character.lastSeen ?? messageIndex)),
    };
}

/**
 * Builds the background model's request: the character cards (for who everyone is), the ledger, the
 * latest messages, and the rules for major characters, first-person memory and off-screen lives.
 */
async function buildUpdatePrompt(messageIndex) {
    const cast = getCast();
    const context = getContext();
    const userName = context.name1 || 'User';
    // How far back the model reads (0 = the whole story). The last two messages are what to record;
    // anything before them is context only.
    const range = castReadRange();
    const first = range === 0 ? 0 : Math.max(0, messageIndex - range + 1);
    const recent = chat.slice(first, messageIndex + 1).filter((m) => !m.is_system);
    const earlier = recent.slice(0, -2);
    const latest = recent.slice(-2);
    const recentText = latest.map((m) => messageText(m)).join('\n');

    const characters = Object.values(cast.characters);
    const here = characters.filter((c) => c.status === 'present');
    const away = characters.filter((c) => c.status === 'away');
    const dead = characters.filter((c) => c.status === 'dead');
    const needsSummary = characters.filter((c) => (c.events?.length || 0) > MAX_EVENTS).map((c) => c.name);
    // Away characters with nothing in "Doing now" must be given an activity this time
    const idle = away.filter((c) => !c.steps?.length).map((c) => c.name);
    const scene = sceneInfo();
    const statusPanel = statusPanelCharacters();
    let cards = '';
    try {
        cards = String(await getCharacterCardsInfo() || '').trim().slice(0, CARDS_LIMIT);
    } catch {
        // No card info: the story itself is the context
    }

    // The instructions speak to the model as "you"; only the memory it writes is in the characters'
    // first person, so the two never get mixed up.
    const system = `You keep the cast ledger for an ongoing roleplay story: the lasting memory of its major characters, kept for the whole story. You never write story text. You reply with JSON only.

# What the ledger holds
Each character has two lists, both written by the character about themself in FIRST PERSON ("I", "me", "my"):
- What happened: things the character finished doing or went through. Past tense.
- Doing now: what the character is doing at this moment. Present tense. Only kept while the character is AWAY.
Nothing else. Looks, personality and relationships are already in the character cards and the story.

# Here or away: the rule that decides what you write
- HERE: in the same scene as ${userName} at the end of the NEW messages. The story already shows everything they do, so you write NOTHING about them. You only list their name in "here".
- AWAY: anywhere else. The story does not show them, so you write their off-screen life.
Being talked about, remembered or thought of does not make a character here. Only being in the scene with ${userName} does.

# Your reply
{"here": ["Name"], "away": [{"name": "Name", "what_happened": "I ...", "doing_now": "I'm ..."}], "dead": ["Name"]${needsSummary.length ? ', "summaries": [{"name": "Name", "text": "..."}]' : ''}}

"here" (always required): every major character in the scene with ${userName} at the end of the NEW messages, including the ones who were already here and the ones who just came back from away. Write nothing else for any of them, not even when they come back: what they were last doing off-screen is kept as it is. Anyone you leave out is moved to away. Use [] only when no major character is with ${userName}.

"away": one entry per away character whose off-screen life moves on in this update.
- "doing_now" and "what_happened" are each ONE string (not a list), plain text without "(off-screen)".
- "doing_now": what they are doing now, when it is something NEW. One or two sentences: what they are doing, how, and why or how they feel about it. ("I'm hauling crates off the barge at the docks, counting every one twice because the Vey's man is watching.") Leave it out if their current Doing now is still true. Ten turns of shopping is one entry, not ten.
- "what_happened": when their current activity is over (they got what they went for, it fell through, or enough story time passed), close it in two or three sentences: what they did, how it turned out, and what it means to them. ("I went to the store and got ten eggs. The old man at the till tried to short-change me and I let it go; I wasn't in the mood for a fight.") This replaces their Doing now, so ALWAYS give the next "doing_now" in the same entry. If their Doing now already has ${MAX_STEPS} or more lines, close it now.
- A character who LEFT the scene in the NEW messages goes here too, with only a "doing_now": what they went off to do.
${idle.length ? `- These away characters have nothing in Doing now. Each one MUST get an entry with a "doing_now" in this update: ${idle.join(', ')}.\n` : ''}
"dead": characters who died in the NEW messages. Leave it out otherwise.
${needsSummary.length ? `\n"summaries": for ${needsSummary.join(', ')}: retell the ${EVENTS_TO_FOLD} oldest What happened entries as one first-person paragraph (three to five sentences) that keeps what still matters to the character. It replaces them.\n` : ''}
Leave out any list you do not need, except "here".

# Who belongs in the ledger
- Only MAJOR characters: named characters who matter to the story. They interact with ${userName} in a meaningful way, keep coming back, or affect the plot. The main character of the story always counts.
- Leave out minor characters: passing extras, waiters, guards, crowds, one-line strangers. Add one later only if they become important.
- Never list ${userName}, or anyone under "forgotten" in the ledger (the user removed them on purpose).
- Use the exact ledger name for a known character, even when the story uses a nickname or title. A new major character is added by listing them in "here" or "away".

# Writing the memory
- Write as the character would tell it: their voice, their way of speaking, as the cards and the story show it.
- Fleshed out, not bare notes, but never more than the sentences asked for.

# Off-screen lives (away characters)
An away character's life keeps going the whole time ${userName} is elsewhere. They are the lead of their own story, with their own plans, not an extra waiting in the wings for ${userName}.
- Every away character always has a Doing now, from the moment they leave until they are back with ${userName}.
- Be proactive. Each activity pushes the character's own story forward: they chase what they want, make and carry out plans, take risks, seek people out, make deals, pick fights, follow leads, and deal with the consequences of what they did before. When they get what they wanted, or it falls through, they go after something new.
- No idling: never "waiting for ${userName}", "thinking about ${userName}", "resting", "passing time" or "going about my day". Sleep, meals and travel only when the story's time calls for them, and even then something can happen. Thinking about ${userName} only counts when it drives an action (going to look for them, getting something ready for them).
- Their world has other people in it: they can meet, help or clash with other characters from the ledger and with people of their own (a rival, a boss, a lover, a creditor). Keep those people inside the activity, not as new ledger entries, unless they become major.
- Move them along in proportion to the story time that passes in the NEW messages. A few minutes: usually no change, or the next small move. Hours or more: close the activity with "what_happened" and give the next "doing_now".
- Build on their memory in the ledger and on who they are in the cards, one believable piece at a time.
- Big moves are fine when they follow from who the character is and what they want (a new job, a betrayal, a debt paid off, a move to another town). Off limits: deaths, meeting ${userName}, and arriving in ${userName}'s scene. Only the main story decides those.`;

    const ledger = {
        here: here.map((c) => compact(c)),
        away: away.map((c) => awayEntry(c, messageIndex)),
    };
    if (dead.length) ledger.dead = dead.map((c) => c.name);
    if (cast.forgotten.length) ledger.forgotten = [...cast.forgotten];

    const format = (messages) => messages.map((m) => `${m.is_user ? userName : (m.name || 'Narrator')}: ${messageText(m)}`).join('\n\n');
    const story = earlier.length
        ? `${range === 0 ? 'The story so far' : 'Earlier messages'} (context only, already recorded; do not record them again):\n<earlier>\n${format(earlier)}\n</earlier>\n\n`
        : '';

    return [
        { role: 'system', content: system },
        { role: 'user', content: `${cards ? `Character cards (who everyone is):\n<cards>\n${cards}\n</cards>\n\n` : ''}Current ledger (who was here and who was away before the NEW messages):\n${JSON.stringify(ledger)}\n${scene ? `\nCurrent scene info: ${scene}\n` : ''}${statusPanel ? `\nStatus panel (RPG Companion's tracker of who is in the scene now; use it to check "here", but the NEW messages win if they disagree):\n${statusPanel}\n` : ''}\n${story}NEW messages (record these; the last one is the newest):\n<messages>\n${format(latest)}\n</messages>\n\nUpdate the ledger. JSON only.` },
    ];
}

/**
 * Reads the model's reply into per-character updates. The reply lists who is here, the away characters'
 * off-screen moves, who came back and who died; older replies used one "characters" list instead.
 * @returns {{updates: object[], here: string[]|null}|null} here: everyone in the scene, when the reply says
 */
function parseUpdate(text) {
    if (typeof text !== 'string') return null;
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let data;
    try {
        data = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        return null;
    }
    if (Array.isArray(data?.characters)) return { updates: data.characters, here: null };
    if (!data || typeof data !== 'object' || !['here', 'away', 'returned', 'dead'].some((k) => k in data)) return null;

    const list = (value) => (Array.isArray(value) ? value : []);
    const nameOf = (entry) => String(typeof entry === 'string' ? entry : entry?.name || '').trim();
    // One line of memory; models sometimes copy the ledger's shape (a list, or the off-screen mark)
    const line = (value) => {
        const text = Array.isArray(value) ? value.filter((v) => typeof v === 'string').at(-1) : value;
        return typeof text === 'string' ? text.replace(/^\s*\(off-screen\)\s*/i, '').trim() || undefined : undefined;
    };
    // One update per character, however many lists they appear in
    const byName = new Map();
    const add = (name, fields) => {
        if (!name) return;
        const key = castKey(name);
        byName.set(key, { ...byName.get(key), name, ...fields });
    };
    const here = list(data.here).map(nameOf).filter(Boolean);
    for (const name of here) add(name, { status: 'present' });
    for (const entry of list(data.away)) {
        add(nameOf(entry), { status: 'away', step: line(entry?.doing_now), finish: line(entry?.what_happened) });
    }
    // No longer asked for; whoever is in it is back in the scene
    for (const entry of list(data.returned)) add(nameOf(entry), { status: 'present' });
    for (const entry of list(data.dead)) add(nameOf(entry), { status: 'dead' });
    for (const entry of list(data.summaries)) {
        if (nameOf(entry) && typeof entry?.text === 'string') add(nameOf(entry), { summary: entry.text });
    }
    return { updates: [...byName.values()], here: Array.isArray(data.here) ? here : null };
}

const STATUSES = ['present', 'away', 'dead'];
export const OFFSCREEN_PREFIX = '(off-screen) ';

/**
 * Applies the background model's changes, recording each touched character's previous state so the
 * update can be undone with its message.
 * @returns {number} How many characters changed
 */
export function applyCastUpdate(updates, messageIndex, { here = null } = {}) {
    const cast = getCast();
    const userKey = castKey(getContext().name1);
    const before = {};
    let changed = 0;

    for (const update of updates) {
        const name = String(update?.name || '').trim();
        if (!name || castKey(name) === userKey) continue;

        let character = findCharacter(cast, name);
        // Forgotten by the user: never brought back by an update
        if (!character && isForgotten(cast, name)) continue;
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

        // Status may come at the top level or, from older replies, inside "set"
        const status = String(update.status ?? update.set?.status ?? '').trim().toLowerCase();
        if (STATUSES.includes(status)) character.status = status;

        // Characters who are here are not tracked at all: the story shows what they do. Everything that is
        // tracked happens away from the user, so it is always marked off-screen.
        const wasHere = before[key] ? before[key].status === 'present' : true;
        const isHere = character.status === 'present';
        const rejoining = isHere && !wasHere;
        const mark = (text) => OFFSCREEN_PREFIX + text.trim();
        if (!isHere) {
            if (typeof update.finish === 'string' && update.finish.trim()) {
                character.events.push(mark(update.finish));
                character.steps = [];
            }
            if (typeof update.step === 'string' && update.step.trim() && character.steps.at(-1) !== mark(update.step)) {
                character.steps.push(mark(update.step));
            }
        }
        // Back in the scene: what they were last doing off-screen is kept, as it was, in "What happened"
        if (rejoining && character.steps.length) {
            const open = character.steps.map((step) => step.replace(OFFSCREEN_PREFIX, ''));
            character.events.push(OFFSCREEN_PREFIX + open.join(' Then '));
        }
        // Nothing is "Doing now" while they are here
        if (isHere) character.steps = [];
        // The model forgot to finish a long activity: keep only the latest steps
        if (character.steps.length > MAX_STEPS) character.steps = character.steps.slice(-MAX_STEPS);

        // The oldest entries retold as one summary, which takes their place
        const summary = typeof update.summary === 'string' ? update.summary.trim() : '';
        if (summary && character.events.length > MAX_EVENTS) {
            character.events = [summary, ...character.events.slice(EVENTS_TO_FOLD)];
        }

        if (isHere) character.lastSeen = messageIndex;
        changed++;
    }

    // "here" lists everyone in the scene, so anyone else who was present has stepped out of it. Older
    // replies only named characters whose status changed, so nobody else is moved for those.
    const touched = new Set(Object.keys(before));
    const inScene = Array.isArray(here) ? here.map((name) => findCharacter(cast, name)).filter(Boolean) : null;
    for (const [key, character] of Object.entries(cast.characters)) {
        if (!inScene || inScene.includes(character) || touched.has(key) || character.locked || character.status !== 'present') continue;
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
 * Updates the cast from the message at messageIndex. Runs one at a time, after RPG Companion's own
 * tracker update so the two requests never overlap.
 * @param {number} messageIndex - The message to record
 * @param {{force?: boolean}} [options] - force: also run for the user's own message (Refresh)
 */
export function updateCastFromMessage(messageIndex, { force = false } = {}) {
    updateQueue = updateQueue.then(async () => {
        if (!extensionSettings.enabled || extensionSettings.castEnabled === false) return;
        const message = chat[messageIndex];
        if (!message || message.is_system || (message.is_user && !force)) return;

        castStatus.running = true;
        notify();
        try {
            await waitForTrackers();
            const chatId = getContext().chatId;
            const signature = messageSignature(messageIndex);

            let response;
            try {
                response = await requestUpdate(await buildUpdatePrompt(messageIndex));
            } catch (error) {
                console.warn('[RPG Companion] Cast update failed:', error);
                castStatus.lastError = error?.message || String(error);
                return;
            }
            // The chat or the message changed while we waited: drop this result
            if (getContext().chatId !== chatId || messageSignature(messageIndex) !== signature) return;

            const parsed = parseUpdate(response);
            if (!parsed) {
                console.warn('[RPG Companion] Cast update: could not read the reply as JSON');
                castStatus.lastError = 'The model did not reply with the cast in the right format.';
                return;
            }
            applyCastUpdate(parsed.updates, messageIndex, { here: parsed.here });
            castStatus.lastOk = Date.now();
            castStatus.lastError = null;
            refreshCastPrompt();
        } finally {
            castStatus.running = false;
            notify();
        }
    }).catch((error) => console.error('[RPG Companion] Cast update error:', error));
    return updateQueue;
}

/**
 * Refresh (Cast tab): redoes the update for the latest message. Whatever that message already changed is
 * undone first, so the cast goes back to its last update before it and is rebuilt from the latest
 * message.
 */
export function refreshCast() {
    let latest = chat.length - 1;
    while (latest >= 0 && chat[latest]?.is_system) latest--;
    if (latest < 0) return Promise.resolve();

    const cast = getCast();
    const signature = messageSignature(latest);
    let undone = false;
    while (cast.journal.length && cast.journal.at(-1).signature === signature) {
        const entry = cast.journal.pop();
        for (const [key, before] of Object.entries(entry.before)) {
            if (before === null) delete cast.characters[key];
            else cast.characters[key] = before;
        }
        undone = true;
    }
    if (undone) saveCast();
    return updateCastFromMessage(latest, { force: true });
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

function describe(character) {
    const parts = [];
    const events = (character.events || []).slice(-EVENTS_IN_PROMPT);
    if (events.length) parts.push(`What happened: ${events.join(' ')}`);
    if (character.steps?.length) parts.push(`Doing now: ${character.steps.join(' Then: ')}`);
    if (character.status === 'dead') parts.push('(dead)');
    return `- ${character.name}${parts.length ? `: ${parts.join(' | ')}` : ''}`;
}

/**
 * The cast notes for the main model: the full memory (what happened to them and what they are doing now)
 * of characters in the scene or mentioned in the latest messages, what every other away character is
 * doing right now, and the names of the rest.
 */
export function buildCastNotes() {
    const characters = Object.values(getCast().characters);
    if (!characters.length) return '';
    const userName = getContext().name1 || 'User';
    const lookback = chat.slice(-2).map(messageText).join('\n');

    const relevant = characters.filter((c) => c.status === 'present' || isMentioned(c, lookback));
    const others = characters.filter((c) => !relevant.includes(c) && c.status !== 'dead');
    // Away characters nobody mentioned: only what they are doing right now, so the story knows
    const elsewhere = others.filter((c) => c.status === 'away' && c.steps?.length);
    const named = others.filter((c) => !elsewhere.includes(c));

    let notes = `<cast_notes>\nLasting memory of this story's characters, each in their own words (first person), for consistency. Use it quietly: never quote or list these notes in the reply. Lines marked (off-screen) happened where ${userName} could not see: characters may bring them up, but ${userName} does not know them yet.\n`;
    if (relevant.length) notes += relevant.map(describe).join('\n') + '\n';
    if (elsewhere.length) {
        notes += `Elsewhere right now (off-screen, ${userName} does not know):\n`;
        notes += elsewhere.map((c) => `- ${c.name}: ${c.steps.at(-1).replace(OFFSCREEN_PREFIX, '')}`).join('\n') + '\n';
    }
    if (named.length) notes += `Also in the story: ${named.map((c) => c.name).join(', ')}\n`;
    if (elsewhere.length || named.length) {
        notes += `Characters who are away have their own lives and concerns. Bring one into the story only when it fits naturally (word of them reaches ${userName}, a chance meeting, a consequence of what they are doing), never just to involve them. Do not have them come looking for ${userName} or step in on ${userName}'s behalf without a reason of their own, and do not make them fixated on ${userName}.\n`;
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
