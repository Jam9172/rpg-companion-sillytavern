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
import { getCharacterCardsInfo } from '../generation/promptBuilder.js';
import { requestCast } from './castRequest.js';

const PROMPT_KEY = 'rpg-companion-cast';
const METADATA_KEY = 'rpg_cast';

// Limits that keep each character short
const MAX_STEPS = 6;          // more than this and the activity is folded into an event
const MAX_EVENTS = 10;        // more than this and the oldest are folded into one summary
const EVENTS_TO_FOLD = 6;     // how many of the oldest events go into that summary at once
const EVENTS_IN_PROMPT = 3;   // recent events shown to the main model per character
const CARDS_LIMIT = 6000;     // characters of card descriptions sent to the background model
const MAX_JOURNAL = 200;      // undo entries kept (older ones can no longer be rolled back)
const MAX_ARCHIVE = 300;      // archived memories kept per chat (the oldest go first)
const ARCHIVE_IN_NOTES = 3;   // archived memories a mention can bring back into the main model's notes
const ARCHIVE_CHARS = 2000;   // and at most this much text of them

const listeners = [];
let updateQueue = Promise.resolve();

// The background update's state, shown in the Cast tab
// task: what is running ('update' or 'tidy'); errorTask: what lastError came from; lastTidy: {at, count, fixes}
const castStatus = { running: false, task: null, lastOk: null, lastError: null, errorTask: null, lastTidy: null };

/** @returns {{running: boolean, task: string|null, lastOk: number|null, lastError: string|null, errorTask: string|null, lastTidy: Object|null}} */
export function getCastStatus() {
    // A tidy's result belongs to the chat it ran in
    const lastTidy = castStatus.lastTidy?.chatId === getContext().chatId ? castStatus.lastTidy : null;
    return { ...castStatus, lastTidy };
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
    cast.archive ??= [];
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
    cast.archive = cast.archive.filter((a) => a.character !== key);
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

/** Puts back what one update changed: the characters as they were, and none of what it archived. */
function undoEntry(cast, entry) {
    for (const [key, before] of Object.entries(entry.before)) {
        if (before === null) delete cast.characters[key];
        else cast.characters[key] = before;
    }
    if (entry.archived?.length) cast.archive = cast.archive.filter((a) => !entry.archived.includes(a.id));
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
        undoEntry(cast, entry);
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

// Strict JSON shapes for the background model's replies ("" and [] mean nothing to change)
const UPDATE_SCHEMA = {
    name: 'cast_update',
    value: {
        type: 'object',
        additionalProperties: false,
        required: ['here', 'away', 'dead', 'summaries'],
        properties: {
            here: { type: 'array', items: { type: 'string' } },
            away: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'what_happened', 'doing_now'],
                    properties: { name: { type: 'string' }, what_happened: { type: 'string' }, doing_now: { type: 'string' } },
                },
            },
            dead: { type: 'array', items: { type: 'string' } },
            summaries: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'text', 'keywords'],
                    properties: { name: { type: 'string' }, text: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } },
                },
            },
        },
    },
};

const TIDY_SCHEMA = {
    name: 'cast_tidy',
    value: {
        type: 'object',
        additionalProperties: false,
        required: ['characters', 'fixes'],
        properties: {
            characters: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'what_happened', 'doing_now'],
                    properties: { name: { type: 'string' }, what_happened: { type: 'array', items: { type: 'string' } }, doing_now: { type: 'string' } },
                },
            },
            fixes: { type: 'array', items: { type: 'string' } },
        },
    },
};

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
    // first person, so the two never get mixed up. They never change within a chat, and everything that
    // does change comes after the cards and the story, so the model's prompt cache can reuse the start.
    const system = `You keep the cast ledger of an ongoing roleplay story: the lasting memory of its major characters. You never write story text. You reply with one JSON object and nothing else.

<ledger_rules>
Each character's memory is written by the character about themself, in FIRST PERSON ("I", "me", "my"), in their own voice:
- What happened: things they finished doing or went through. Past tense, two or three sentences each.
- Doing now: what they are doing at this moment. Present tense, one or two sentences. Kept only while they are away.
Nothing else is tracked: looks, personality and relationships come from the cards and the story.

HERE: in the same scene as ${userName} at the end of the NEW messages. The story already shows what they do, so you write nothing about them.
AWAY: anywhere else. You write their off-screen life.
Being talked about, remembered or thought of does not make anyone here.

Major characters only: named people who matter to the story (they deal with ${userName} in a meaningful way, keep coming back, or move the plot). The story's main character always counts. Never ${userName}, never passing extras (waiters, guards, crowds), never anyone under "forgotten". Use the exact ledger name for a known character, even when the story uses a nickname or title.
</ledger_rules>

<off_screen_lives>
Away characters are the leads of their own stories, not extras waiting in the wings for ${userName}.
- They always have a Doing now, from the moment they leave until they are back with ${userName}.
- Proactive: each activity pushes their own goals forward. They make and carry out plans, take risks, seek people out, make deals, pick fights, follow leads, and deal with the consequences of what they did before. When they get what they wanted, or it falls through, they go after something new.
- Never idle: no "waiting for ${userName}", "thinking about ${userName}", "resting", "passing time" or "going about my day". Thinking about ${userName} only counts when it drives an action.
- Their world has other people in it (a rival, a boss, a lover, a creditor, other ledger characters). Keep them inside the activity.
- Move them in proportion to the story time that passes in the NEW messages: a few minutes, usually nothing new; hours or more, close the activity and start the next.
- Build on their memory and on who they are in the cards. Big moves are fine when they follow from who they are (a new job, a betrayal, a debt paid off). Off limits: deaths, meeting ${userName}, arriving in ${userName}'s scene.
</off_screen_lives>

<reply_format>
{"here": [...], "away": [...], "dead": [...], "summaries": [...]}
- "here": every major character with ${userName} at the end of the NEW messages, including those already here and those who just came back from away. Anyone you leave out is moved to away. Nothing else is written for them.
- "away": one entry for each away character whose off-screen life moves on, and one for each character who LEFT the scene in the NEW messages (with what they went off to do).
  - "what_happened": "" unless their current activity is over. Then close it in two or three past-tense sentences: what they did, how it turned out, and what it means to them.
  - "doing_now": "" if their current Doing now is still true. Otherwise the new activity in one or two present-tense sentences: what they are doing, how, and why or how they feel about it. When you close an activity, always give the next one.
  - Ten turns of shopping is one activity, not ten. If their Doing now has ${MAX_STEPS} or more lines, close it.
- "dead": characters who died in the NEW messages.
- "summaries": only for the characters named under "This update": retell their ${EVENTS_TO_FOLD} oldest What happened entries as one first-person paragraph (three to five sentences) that keeps what still matters to them. The entries themselves are kept in an archive: "keywords" lists three to eight names of the people, places and things in them (not the character's own name), so a later mention brings them back.
- Use [] for an empty list. Plain text only, without "(off-screen)" marks.
</reply_format>

<example>
Made-up names; only the shape matters.
Ledger: here: Aldo. Away: Brina, Doing now: "I'm bribing the harbor clerk for the shipping lists."
NEW messages: Aldo storms out to fetch the healer, and ${userName} waits alone until nightfall.
Reply:
{"here": [], "away": [{"name": "Aldo", "what_happened": "", "doing_now": "I'm running through the market to drag the healer back, shoving past anyone slow enough to be in my way."}, {"name": "Brina", "what_happened": "I got the shipping lists for two silver and a promise I don't mean to keep. The clerk will want more by the next tide, but now I have the name of the ship.", "doing_now": "I'm rowing out to the Gull's Wake after dark to see what it is really carrying."}], "dead": [], "summaries": []}
</example>`;

    const ledger = {
        here: here.map((c) => compact(c)),
        away: away.map((c) => awayEntry(c, messageIndex)),
    };
    if (dead.length) ledger.dead = dead.map((c) => c.name);
    if (cast.forgotten.length) ledger.forgotten = [...cast.forgotten];

    const format = (messages) => messages.map((m) => `${m.is_user ? userName : (m.name || 'Narrator')}: ${messageText(m)}`).join('\n\n');
    const notes = [];
    if (idle.length) notes.push(`Nothing in Doing now yet; give each one an activity: ${idle.join(', ')}.`);
    if (needsSummary.length) notes.push(`Summaries needed for: ${needsSummary.join(', ')}.`);

    // Cache-friendly order: what stays the same between updates first (cards, then the story, which in
    // "whole story" mode only grows at the end), what changes every time last
    const parts = [];
    if (cards) parts.push(`<cards>\n${cards}\n</cards>`);
    if (earlier.length) parts.push(`<${range === 0 ? 'story_so_far' : 'earlier_messages'}>\nContext only, already recorded.\n\n${format(earlier)}\n</${range === 0 ? 'story_so_far' : 'earlier_messages'}>`);
    parts.push(`<ledger>\nWho was here and who was away before the NEW messages.\n${JSON.stringify(ledger)}\n</ledger>`);
    if (scene) parts.push(`<scene>\n${scene}\n</scene>`);
    if (statusPanel) parts.push(`<status_panel>\nRPG Companion's tracker of who is in the scene now. Use it to check "here"; the NEW messages win if they disagree.\n${statusPanel}\n</status_panel>`);
    parts.push(`<new_messages>\nRecord these. The last one is the newest.\n\n${format(latest)}\n</new_messages>`);
    if (notes.length) parts.push(`<this_update>\n${notes.join('\n')}\n</this_update>`);
    parts.push('Update the ledger. JSON only.');

    return [
        { role: 'system', content: system },
        { role: 'user', content: parts.join('\n\n') },
    ];
}

/**
 * Reads the model's reply into per-character updates. The reply lists who is here, the away characters'
 * off-screen moves, who came back and who died; older replies used one "characters" list instead.
 * @returns {{updates: object[], here: string[]|null}|null} here: everyone in the scene, when the reply says
 */
export function parseUpdate(text) {
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
    // A name has letters and no JSON punctuation; a model can still emit junk like ": [" inside a schema
    const isName = (name) => /\p{L}/u.test(name) && !/[{}\[\]":]/.test(name);
    const nameOf = (entry) => {
        const name = String(typeof entry === 'string' ? entry : entry?.name || '').trim();
        return isName(name) ? name : '';
    };
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
    const rawHere = list(data.here);
    const here = rawHere.map(nameOf).filter(Boolean);
    for (const name of here) add(name, { status: 'present' });
    for (const entry of list(data.away)) {
        add(nameOf(entry), { status: 'away', step: line(entry?.doing_now), finish: line(entry?.what_happened) });
    }
    // No longer asked for; whoever is in it is back in the scene
    for (const entry of list(data.returned)) add(nameOf(entry), { status: 'present' });
    for (const entry of list(data.dead)) add(nameOf(entry), { status: 'dead' });
    for (const entry of list(data.summaries)) {
        if (nameOf(entry) && typeof entry?.text === 'string') {
            const keywords = Array.isArray(entry.keywords) ? entry.keywords.filter((k) => typeof k === 'string') : [];
            add(nameOf(entry), { summary: entry.text, keywords });
        }
    }
    // A "here" list that was all junk says nothing about who is in the scene, so nobody is moved out
    const hereKnown = Array.isArray(data.here) && (here.length > 0 || rawHere.length === 0);
    return { updates: [...byName.values()], here: hereKnown ? here : null };
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
    const archived = [];
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

        // The oldest entries retold as one summary, which takes their place in What happened; the
        // entries themselves go to the archive, where a mention of what is in them brings them back
        const summary = typeof update.summary === 'string' ? update.summary.trim() : '';
        if (summary && character.events.length > MAX_EVENTS) {
            const folded = character.events.slice(0, EVENTS_TO_FOLD);
            archived.push(archiveMemories(cast, character, folded, update.keywords, messageIndex));
            // A summary of off-screen entries is off-screen too
            const mark = folded.every((e) => e.startsWith(OFFSCREEN_PREFIX)) ? OFFSCREEN_PREFIX : '';
            character.events = [mark + summary, ...character.events.slice(EVENTS_TO_FOLD)];
        } else if (character.events.length > MAX_EVENTS + EVENTS_TO_FOLD) {
            // The model never summed them up: archive the oldest anyway, so What happened stays short
            archived.push(archiveMemories(cast, character, character.events.slice(0, EVENTS_TO_FOLD), [], messageIndex));
            character.events = character.events.slice(EVENTS_TO_FOLD);
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
        // The cast moved on, so going back to before the last tidy would lose this update
        delete cast.tidyUndo;
        const meanwhile = meanwhileOf(before, cast);
        cast.journal.push({ messageIndex, signature: messageSignature(messageIndex), before, ...(meanwhile.length ? { meanwhile } : {}), ...(archived.length ? { archived } : {}) });
        if (cast.journal.length > MAX_JOURNAL) cast.journal.splice(0, cast.journal.length - MAX_JOURNAL);
        saveCast();
    }
    return changed;
}

/* ---------- Archive ---------- */

// Capitalised words that start sentences rather than name anything
const NOT_KEYWORDS = new Set(['the', 'then', 'when', 'after', 'before', 'but', 'and', 'so', 'now', 'there', 'that', 'this', 'they', 'she', 'he', 'it', 'we', 'my', 'his', 'her', 'their', 'our', 'one', 'once', 'while', 'with', 'by', 'at', 'in', 'on', 'for', 'if', 'what', 'who', 'where', 'why', 'how', 'all', 'some', 'no', 'not', 'even', 'still', 'just']);

/** Names of people, places and things in the entries, for when the model gave no keywords. */
function keywordsFrom(entries, ownNames) {
    const found = new Map();
    for (const entry of entries) {
        for (const match of entry.replace(OFFSCREEN_PREFIX, '').matchAll(/\b\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)*/gu)) {
            const word = match[0].replace(/'s$/, '');
            const key = word.toLowerCase();
            if (word.length < 3 || NOT_KEYWORDS.has(key) || ownNames.has(key) || key === 'i') continue;
            found.set(key, word);
        }
    }
    return [...found.values()].slice(0, 8);
}

/**
 * Moves memories into the archive, tagged with keywords (people, places, things in them, never the
 * character's own name, which would bring them back all the time).
 * @returns {string} The archive entry's id
 */
function archiveMemories(cast, character, entries, keywords, messageIndex) {
    const ownNames = new Set([character.name, ...(character.aliases || []), ...character.name.split(/\s+/)].map((n) => n.toLowerCase()));
    const seen = new Set();
    let tags = (Array.isArray(keywords) ? keywords : [])
        .map((k) => String(k).trim())
        .filter((k) => k.length >= 2 && !ownNames.has(k.toLowerCase()) && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
        .slice(0, 10);
    if (!tags.length) tags = keywordsFrom(entries, ownNames);
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    cast.archive.push({ id, character: castKey(character.name), name: character.name, entries: [...entries], keywords: tags, messageIndex, created: Date.now() });
    if (cast.archive.length > MAX_ARCHIVE) cast.archive.splice(0, cast.archive.length - MAX_ARCHIVE);
    return id;
}

/** A character's archived memories, oldest first. */
export function listArchive(name) {
    const cast = getCast();
    const character = findCharacter(cast, name);
    if (!character) return [];
    return cast.archive.filter((a) => a.character === castKey(character.name));
}

/** Changes an archived memory's keywords by hand. */
export function editArchiveKeywords(id, keywords) {
    const entry = getCast().archive.find((a) => a.id === id);
    if (!entry) return;
    entry.keywords = keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 10);
    saveCast();
    refreshCastPrompt();
}

/** Removes an archived memory by hand. */
export function deleteArchive(id) {
    const cast = getCast();
    cast.archive = cast.archive.filter((a) => a.id !== id);
    saveCast();
    refreshCastPrompt();
}

/** Archived memories whose keywords appear in the text, newest first, within the notes' budget. */
export function recallArchive(text) {
    const cast = chat_metadata?.[METADATA_KEY];
    if (!cast?.archive?.length || !text) return [];
    const hits = [];
    let used = 0;
    for (const entry of [...cast.archive].reverse()) {
        if (!cast.characters[entry.character]) continue;
        const hit = entry.keywords.some((k) => new RegExp(`(^|[^\\p{L}])${escapeRegex(k)}($|[^\\p{L}])`, 'iu').test(text));
        if (!hit) continue;
        const size = entry.entries.join(' ').length;
        if (used + size > ARCHIVE_CHARS && hits.length) continue;
        hits.push(entry);
        used += size;
        if (hits.length >= ARCHIVE_IN_NOTES) break;
    }
    return hits;
}

/**
 * What an update changed that the user cannot see in the story: who left or came back, who died, and
 * what the away characters started and finished. Shown as "Meanwhile" under the reply.
 * @returns {Array<{name: string, kind: 'left'|'back'|'died'|'doing'|'done', text?: string}>}
 */
function meanwhileOf(before, cast) {
    const plain = (line) => line.replace(OFFSCREEN_PREFIX, '');
    const lines = [];
    for (const [key, old] of Object.entries(before)) {
        const now = cast.characters[key];
        if (!now) continue;
        if (old?.status === 'present' && now.status === 'away') lines.push({ name: now.name, kind: 'left' });
        if (old?.status === 'away' && now.status === 'present') lines.push({ name: now.name, kind: 'back' });
        if (old?.status !== 'dead' && now.status === 'dead') lines.push({ name: now.name, kind: 'died' });
        const oldEvents = new Set(old?.events || []);
        const oldSteps = new Set(old?.steps || []);
        // A summary that replaced old entries is bookkeeping, not news
        const summary = now.events.length && !oldEvents.has(now.events[0]) && (old?.events?.length || 0) > MAX_EVENTS ? now.events[0] : null;
        for (const event of now.events) {
            if (!oldEvents.has(event) && event !== summary && event.startsWith(OFFSCREEN_PREFIX)) lines.push({ name: now.name, kind: 'done', text: plain(event) });
        }
        for (const step of now.steps) {
            if (!oldSteps.has(step)) lines.push({ name: now.name, kind: 'doing', text: plain(step) });
        }
    }
    return lines;
}

/**
 * The Meanwhile lines for a message: what its update changed off-screen, as long as the message is still
 * the one that update read (not deleted, swiped away or edited out of the journal).
 */
export function getMeanwhile(messageIndex) {
    const cast = chat_metadata?.[METADATA_KEY];
    if (!cast?.journal?.length) return [];
    const signature = messageSignature(messageIndex);
    return cast.journal
        .filter((e) => e.messageIndex === messageIndex && e.signature === signature && e.meanwhile)
        .flatMap((e) => e.meanwhile)
        .filter((line) => cast.characters[castKey(line.name)] || line.kind === 'died');
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
        castStatus.task = 'update';
        notify();
        try {
            await waitForTrackers();
            const chatId = getContext().chatId;
            const signature = messageSignature(messageIndex);

            let response;
            try {
                response = await requestCast(await buildUpdatePrompt(messageIndex), { task: 'update', schema: UPDATE_SCHEMA });
            } catch (error) {
                console.warn('[RPG Companion] Cast update failed:', error);
                castStatus.lastError = error?.message || String(error);
                castStatus.errorTask = 'update';
                return;
            }
            // The chat or the message changed while we waited: drop this result
            if (getContext().chatId !== chatId || messageSignature(messageIndex) !== signature) return;

            const parsed = parseUpdate(response);
            if (!parsed) {
                console.warn('[RPG Companion] Cast update: could not read the reply as JSON');
                castStatus.lastError = 'The model did not reply with the cast in the right format.';
                castStatus.errorTask = 'update';
                return;
            }
            applyCastUpdate(parsed.updates, messageIndex, { here: parsed.here });
            castStatus.lastOk = Date.now();
            castStatus.lastError = null;
            refreshCastPrompt();
        } finally {
            castStatus.running = false;
            castStatus.task = null;
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
        undoEntry(cast, cast.journal.pop());
        undone = true;
    }
    if (undone) saveCast();
    return updateCastFromMessage(latest, { force: true });
}

/* ---------- Tidy (Cast tab) ---------- */

const TIDY_EVENTS = 5;        // what a tidy aims for: at most this many What happened entries per character

/** The tidy request: every character's whole memory, the cards and the recent story, and the rules. */
async function buildTidyPrompt(characters) {
    const context = getContext();
    const userName = context.name1 || 'User';
    const range = castReadRange();
    const last = chat.length - 1;
    const first = range === 0 ? 0 : Math.max(0, last - range + 1);
    const story = chat.slice(first).filter((m) => !m.is_system)
        .map((m) => `${m.is_user ? userName : (m.name || 'Narrator')}: ${messageText(m)}`).join('\n\n');
    let cards = '';
    try {
        cards = String(await getCharacterCardsInfo() || '').trim().slice(0, CARDS_LIMIT);
    } catch {
        // No card info: the memory and the story are the context
    }

    const system = `You tidy the cast ledger of an ongoing roleplay story: the lasting memory of its major characters, each written by the character about themself in FIRST PERSON ("I", "me", "my"). You never write story text. You reply with JSON only.

Rewrite each character's memory so it is shorter, cleaner and correct:
- "what_happened": their finished experiences, oldest first. Merge entries that belong together, drop repeats and filler, and keep every fact that still matters (names, places, deals, debts, injuries, promises, and how the character feels about them). Aim for at most ${TIDY_EVENTS} entries; the oldest can become one short summary. Each entry two to four sentences, past tense.
- "doing_now" (only for characters whose status is "away"): one or two sentences, present tense, of what they are doing at this moment. Drop steps that are already over or replaced by later ones; a finished step that matters belongs at the end of "what_happened".
- Fix mistakes: entries that contradict each other or the story and the cards (the story wins), wrong or misspelled names, entries in third person or the wrong tense, entries that belong to a different character, and things the character could not know.
- Never invent events or details, and never change what happened. Use only what is already in the memory, the story and the cards.
- Keep each character's own voice.
- "fixes": one short line for each mistake you corrected, naming the character ("Kael: the debt was fifty silver, not forty"). Merging and shortening need no line. Empty if nothing was wrong.
Work quickly: this is cleanup, not a puzzle. Make the obvious merges and corrections and move on.

Reply with JSON only:
{"characters": [{"name": "Name", "what_happened": ["I ..."], "doing_now": "I'm ..."}], "fixes": ["Name: ..."]}
Include every character listed, with the exact name given. Use "" for "doing_now" of characters who are not away.`;

    const ledger = characters.map((c) => compact(c));
    return [
        { role: 'system', content: system },
        { role: 'user', content: `${cards ? `<cards>\n${cards}\n</cards>\n\n` : ''}${story ? `<story>\n${range === 0 ? 'All of it.' : 'The latest messages.'}\n\n${story}\n</story>\n\n` : ''}<ledger>\nThe memory to tidy.\n${JSON.stringify(ledger)}\n</ledger>\n\nTidy it. JSON only.` },
    ];
}

/**
 * Applies a tidy reply. Only text is changed (never status), a character is kept as they were when the
 * reply leaves their memory empty, and locked characters are left alone.
 * @returns {{count: number, fixes: string[]}|null} null when the reply could not be read
 */
function applyTidy(text, characters) {
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
    if (!Array.isArray(data?.characters)) return null;

    const cast = getCast();
    const strip = (line) => String(line).replace(/^\s*\(off-screen\)\s*/i, '').trim();
    let count = 0;
    for (const entry of data.characters) {
        const character = findCharacter(cast, entry?.name);
        if (!character || character.locked || !characters.includes(character)) continue;
        // Everything tracked now happens off-screen; entries from before that keep no mark
        const marked = character.events.length > 0 && character.events.every((e) => e.startsWith(OFFSCREEN_PREFIX));
        const events = (Array.isArray(entry.what_happened) ? entry.what_happened : [entry.what_happened])
            .filter((e) => typeof e === 'string').map(strip).filter(Boolean);
        const doing = typeof entry.doing_now === 'string' ? strip(entry.doing_now)
            : (Array.isArray(entry.doing_now) ? strip(entry.doing_now.filter((s) => typeof s === 'string').at(-1) || '') : '');
        let touched = false;
        if (events.length) {
            character.events = events.map((e) => (marked ? OFFSCREEN_PREFIX + e : e));
            touched = true;
        }
        if (character.status === 'away' && doing) {
            character.steps = [OFFSCREEN_PREFIX + doing];
            touched = true;
        }
        if (touched) count++;
    }
    const fixes = (Array.isArray(data.fixes) ? data.fixes : []).filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim());
    return { count, fixes };
}

/**
 * Tidy (Cast tab): has the background model compress every character's memory, boil Doing now down to
 * what is true now and fix mistakes. The cast as it was is kept until the next update, for Undo tidy.
 */
export function tidyCast() {
    updateQueue = updateQueue.then(async () => {
        if (!extensionSettings.enabled || extensionSettings.castEnabled === false) return;
        const cast = getCast();
        const characters = Object.values(cast.characters).filter((c) => !c.locked && (c.events?.length || c.steps?.length));
        if (!characters.length) return;

        castStatus.running = true;
        castStatus.task = 'tidy';
        notify();
        try {
            const chatId = getContext().chatId;
            let response;
            try {
                response = await requestCast(await buildTidyPrompt(characters), { task: 'tidy', schema: TIDY_SCHEMA });
            } catch (error) {
                console.warn('[RPG Companion] Cast tidy failed:', error);
                castStatus.lastError = error?.message || String(error);
                castStatus.errorTask = 'tidy';
                return;
            }
            if (getContext().chatId !== chatId) return;

            const snapshot = structuredClone(cast.characters);
            const result = applyTidy(response, characters);
            if (!result) {
                console.warn('[RPG Companion] Cast tidy: could not read the reply as JSON');
                castStatus.lastError = 'The model did not reply with the cast in the right format.';
                castStatus.errorTask = 'tidy';
                return;
            }
            cast.tidyUndo = snapshot;
            castStatus.lastTidy = { at: Date.now(), chatId, ...result };
            castStatus.lastError = null;
            saveCast();
            refreshCastPrompt();
        } finally {
            castStatus.running = false;
            castStatus.task = null;
            notify();
        }
    }).catch((error) => console.error('[RPG Companion] Cast tidy error:', error));
    return updateQueue;
}

/** Whether the last tidy can still be undone (until the next update changes the cast). */
export function canUndoTidy() {
    return Boolean(chat_metadata?.[METADATA_KEY]?.tidyUndo);
}

/** Puts the cast back as it was before the last tidy (characters forgotten since then stay forgotten). */
export function undoTidy() {
    const cast = getCast();
    if (!cast.tidyUndo) return;
    for (const [key, character] of Object.entries(cast.tidyUndo)) {
        if (cast.characters[key]) cast.characters[key] = character;
    }
    delete cast.tidyUndo;
    castStatus.lastTidy = null;
    saveCast();
    refreshCastPrompt();
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
    const recalled = recallArchive(lookback);
    if (recalled.length) {
        notes += 'Older memories, brought back by what was just said:\n';
        notes += recalled.map((a) => {
            const marked = a.entries.every((e) => e.startsWith(OFFSCREEN_PREFIX));
            return `- ${a.name}: ${marked ? OFFSCREEN_PREFIX : ''}${a.entries.map((e) => e.replace(OFFSCREEN_PREFIX, '')).join(' ')}`;
        }).join('\n') + '\n';
    }
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
