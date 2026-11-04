/**
 * Cast tab: every character in the story's lasting memory, with their bio, finished events and what
 * they are doing now. Fields can be edited in place; a character can be locked (the background model
 * leaves them alone) or removed.
 */

import { extensionSettings } from '../../core/state.js';
import { i18n } from '../../core/i18n.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { listCharacters, editCharacter, deleteCharacter, listForgotten, rememberCharacter, onCastChanged, refreshCastPrompt, OFFSCREEN_PREFIX, castReadRange, refreshCast, getCastStatus, tidyCast, canUndoTidy, undoTidy, listArchive, editArchiveKeywords, deleteArchive, getStory, editStory, toggleKeyMemory } from '../features/cast.js';
import { saveSettings } from '../../core/persistence.js';
import { castConnectionProfiles, castReasoning } from '../features/castRequest.js';
import { renderAllMeanwhile } from './meanwhile.js';
import { renderElsewhere } from './elsewhere.js';

const t = (key, fallback) => i18n.getTranslation(key) || fallback;

// Read ranges offered in the picker (0 = the whole story)
const RANGE_PRESETS = [4, 10, 25, 50, 100, 0];

function rangeLabel(value) {
    return value === 0
        ? t('cast.range.whole', 'Whole story')
        : `${t('cast.range.last', 'Last')} ${value} ${t('cast.range.messages', 'messages')}`;
}

function timeAgo(time) {
    const seconds = Math.round((Date.now() - time) / 1000);
    if (seconds < 45) return t('cast.time.now', 'just now');
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} ${t('cast.time.minutes', 'min ago')}`;
    const hours = Math.round(minutes / 60);
    return `${hours} ${t('cast.time.hours', 'h ago')}`;
}

/** The Refresh button and a line saying how the last background update went. */
function statusBar() {
    const status = getCastStatus();
    const refreshHelp = t('cast.refresh.help', 'Redo the cast update for the latest message: undo what it changed, then read it again.');
    const tidyHelp = t('cast.tidy.help', 'Compress every character\'s memory: merge and shorten What happened, cut Doing now down to what is true now, and fix mistakes. Nothing new is made up, and it can be undone.');
    const tidying = status.running && status.task === 'tidy';
    const tidy = status.lastTidy && status.lastTidy.at >= (status.lastOk || 0) ? status.lastTidy : null;
    let line;
    if (status.running) line = `<span class="rpg-cast-state is-running">${escapeHtml(tidying ? t('cast.state.tidying', 'Tidying…') : t('cast.state.running', 'Updating…'))}</span>`;
    else if (status.lastError) line = `<span class="rpg-cast-state is-error" title="${escapeHtml(status.lastError)}">${escapeHtml(status.errorTask === 'tidy' ? t('cast.state.tidyFailed', 'Tidy failed') : t('cast.state.failed', 'Last update failed'))}: ${escapeHtml(status.lastError)}</span>`;
    else if (tidy) line = `<span class="rpg-cast-state">${escapeHtml(t('cast.state.tidied', 'Tidied'))} ${tidy.count} ${escapeHtml(tidy.count === 1 ? t('cast.character', 'character') : t('cast.characters', 'characters'))} ${escapeHtml(timeAgo(tidy.at))}</span>`;
    else if (status.lastOk) line = `<span class="rpg-cast-state">${escapeHtml(t('cast.state.ok', 'Updated'))} ${escapeHtml(timeAgo(status.lastOk))}</span>`;
    else line = `<span class="rpg-cast-state">${escapeHtml(t('cast.state.idle', 'Updates after each reply'))}</span>`;
    const fixes = tidy && !status.running && !status.lastError
        ? (tidy.fixes.length
            ? `<details class="rpg-cast-fixes"><summary>${tidy.fixes.length} ${escapeHtml(tidy.fixes.length === 1 ? t('cast.fix', 'fix') : t('cast.fixes', 'fixes'))}</summary><ul>${tidy.fixes.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></details>`
            : `<p class="rpg-cast-fixes">${escapeHtml(t('cast.noFixes', 'No mistakes found.'))}</p>`)
        : '';
    const undo = canUndoTidy() && !status.running
        ? `<button type="button" class="rpg-cast-undo-tidy" title="${escapeHtml(t('cast.undoTidy.help', 'Put every character\'s memory back as it was before the last tidy.'))}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>${escapeHtml(t('cast.undoTidy', 'Undo tidy'))}</span></button>`
        : '';
    return `
        <div class="rpg-cast-status-bar">
            ${line}
            <div class="rpg-cast-actions">
                ${undo}
                <button type="button" class="rpg-cast-tidy" title="${escapeHtml(tidyHelp)}"${status.running ? ' disabled' : ''}>
                    <i class="fa-solid fa-broom" aria-hidden="true"></i>
                    <span>${escapeHtml(t('cast.tidy', 'Tidy'))}</span>
                </button>
                <button type="button" class="rpg-cast-refresh" title="${escapeHtml(refreshHelp)}"${status.running ? ' disabled' : ''}>
                    <i class="fa-solid fa-rotate${status.running && !tidying ? ' fa-spin' : ''}" aria-hidden="true"></i>
                    <span>${escapeHtml(t('cast.refresh', 'Refresh'))}</span>
                </button>
            </div>
            ${fixes}
        </div>`;
}

/** The picker for how much of the story the background model reads per update. */
function rangePicker() {
    const current = castReadRange();
    const values = RANGE_PRESETS.includes(current) ? RANGE_PRESETS : [...RANGE_PRESETS.slice(0, -1), current, 0].sort((a, b) => (a || Infinity) - (b || Infinity));
    const options = values.map((v) => `<option value="${v}"${v === current ? ' selected' : ''}>${escapeHtml(rangeLabel(v))}</option>`).join('');
    const help = t('cast.range.help', 'How much of the story the background model reads on each update. More gives better memory but costs more tokens per reply.');
    return `
        <label class="rpg-cast-range" title="${escapeHtml(help)}">
            <span class="rpg-cast-label">${escapeHtml(t('cast.range.title', 'Reads'))}</span>
            <select class="rpg-cast-range-select" aria-label="${escapeHtml(help)}">
                ${options}
                <option value="custom">${escapeHtml(t('cast.range.custom', 'Custom…'))}</option>
            </select>
        </label>
        ${current === 0 ? `<p class="rpg-cast-range-note">${escapeHtml(t('cast.range.wholeNote', 'Reads the whole chat on every update: best memory, but long stories cost a lot of tokens and can pass your tracker model\'s context limit.'))}</p>` : ''}`;
}

// Whether the Settings and Story folds are open, so a re-render keeps them that way
let modelOpen = false;
let storyOpen = false;

/** The story so far: chapters, then the beats since the last one, all editable. */
function storyFold() {
    const { chapters, beats } = getStory();
    const count = [
        chapters.length ? `${chapters.length} ${chapters.length === 1 ? t('cast.story.chapter', 'chapter') : t('cast.story.chapters', 'chapters')}` : '',
        beats.length ? `${beats.length} ${beats.length === 1 ? t('cast.story.beat', 'beat') : t('cast.story.beats', 'beats')}` : '',
    ].filter(Boolean).join(' · ');
    const removeTitle = escapeHtml(t('cast.story.remove', 'Remove this line'));
    let number = 0;
    const chapterHtml = chapters.map((c) => `
        <div class="rpg-cast-chapter">
            <span class="rpg-cast-label">${escapeHtml(c.part ? t('cast.story.earlier', 'Earlier') : `${t('cast.story.chapterTitle', 'Chapter')} ${++number}`)}</span>
            <p class="rpg-cast-story-text" contenteditable="true" spellcheck="false" data-kind="chapter" data-id="${escapeHtml(c.id)}">${escapeHtml(c.text)}</p>
        </div>`).join('');
    const beatHtml = beats.length ? `
        <span class="rpg-cast-label">${escapeHtml(chapters.length ? t('cast.story.since', 'Since then') : t('cast.story.sofar', 'So far'))}</span>
        <ul class="rpg-cast-events">${beats.map((b) => `
            <li class="rpg-cast-event">
                <span class="rpg-cast-story-text" contenteditable="true" spellcheck="false" data-kind="beat" data-id="${escapeHtml(b.id)}">${escapeHtml(b.text)}</span>
                <button type="button" class="rpg-cast-story-remove" data-kind="beat" data-id="${escapeHtml(b.id)}" title="${removeTitle}" aria-label="${removeTitle}">×</button>
            </li>`).join('')}</ul>` : '';
    return `
        <details class="rpg-cast-story"${storyOpen ? ' open' : ''}>
            <summary><span class="rpg-cast-label">${escapeHtml(t('cast.story.title', 'Story so far'))}</span><span class="rpg-cast-story-count">${escapeHtml(count)}</span></summary>
            ${chapterHtml || beatHtml ? chapterHtml + beatHtml : `<p class="rpg-cast-pending">${escapeHtml(t('cast.story.empty', 'Each reply adds a line here; every 20 become a chapter.'))}</p>`}
        </details>`;
}

/** The background model's settings: connection, reasoning and strict JSON. */
function modelSettings() {
    const profiles = castConnectionProfiles();
    const connection = profiles.some((p) => p.id === extensionSettings.castConnection) ? extensionSettings.castConnection : '';
    const reasoning = castReasoning();
    const option = (value, label, selected) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    return `
        <details class="rpg-cast-model"${modelOpen ? ' open' : ''}>
            <summary>${escapeHtml(t('cast.settings.title', 'Settings'))}</summary>
            <label class="rpg-cast-model-row" title="${escapeHtml(t('cast.model.connectionHelp', 'Which connection Cast uses. A Connection Profile lets Cast use its own model, separate from the chat.'))}">
                <span class="rpg-cast-label">${escapeHtml(t('cast.model.connection', 'Connection'))}</span>
                <select class="rpg-cast-connection">
                    ${option('', t('cast.model.sameConnection', 'Same as RPG Companion'), connection)}
                    ${profiles.map((p) => option(p.id, p.name, connection)).join('')}
                </select>
            </label>
            <label class="rpg-cast-model-row" title="${escapeHtml(t('cast.model.reasoningHelp', 'How much the model thinks before each update. Thinking is never shown and costs reply tokens; Off is fastest and cheapest. Tidy always thinks at least a little.'))}">
                <span class="rpg-cast-label">${escapeHtml(t('cast.model.reasoning', 'Reasoning'))}</span>
                <select class="rpg-cast-reasoning">
                    ${option('off', t('cast.model.reasoningOff', 'Off (fastest, cheapest)'), reasoning)}
                    ${option('low', t('cast.model.reasoningLow', 'Low'), reasoning)}
                    ${option('default', t('cast.model.reasoningDefault', 'Model default'), reasoning)}
                </select>
            </label>
            <label class="checkbox_label rpg-cast-model-check">
                <input type="checkbox" class="rpg-cast-strict"${extensionSettings.castStrictJson !== false ? ' checked' : ''}>
                <span>${escapeHtml(t('cast.model.strict', 'Strict JSON (replies always match Cast\'s format)'))}</span>
            </label>
            <p class="rpg-cast-range-note">${escapeHtml(t('cast.model.note', 'Reasoning and temperature are set by Cast on Connection Profiles, OpenRouter and the External API (OpenRouter, NanoGPT or any OpenAI-style API). Other connections follow their preset. A connection that turns the reasoning setting down gets the model default.'))}</p>
            <label class="checkbox_label rpg-cast-model-check" title="${escapeHtml(t('cast.story.injectHelp', 'Send the story so far (chapters and the latest beats) to the main model, so it keeps the whole story in mind. Turn it off if Memory Books already gives it summaries.'))}">
                <input type="checkbox" class="rpg-cast-story-toggle"${extensionSettings.castStoryInject !== false ? ' checked' : ''}>
                <span>${escapeHtml(t('cast.story.inject', 'Send "Story so far" to the main model'))}</span>
            </label>
            <label class="checkbox_label rpg-cast-model-check" title="${escapeHtml(t('cast.meanwhile.help', 'A small fold under each reply with what changed off-screen: who left or came back, and what the away characters started and finished.'))}">
                <input type="checkbox" class="rpg-cast-meanwhile-toggle"${extensionSettings.castMeanwhile !== false ? ' checked' : ''}>
                <span>${escapeHtml(t('cast.meanwhile.toggle', 'Show "Meanwhile" under replies'))}</span>
            </label>
            <label class="checkbox_label rpg-cast-model-check" title="${escapeHtml(t('cast.elsewhere.help', 'A button at the top right of the chat that shows what every away character is doing right now.'))}">
                <input type="checkbox" class="rpg-cast-elsewhere-toggle"${extensionSettings.castElsewhere !== false ? ' checked' : ''}>
                <span>${escapeHtml(t('cast.elsewhere.toggle', 'Show the "Elsewhere" button'))}</span>
            </label>
        </details>`;
}

// Cards the user opened or closed, by name, so a re-render keeps them that way
const openState = new Map();

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS_LABELS = {
    present: ['cast.status.present', 'Here'],
    away: ['cast.status.away', 'Away'],
    dead: ['cast.status.dead', 'Dead'],
};

/** One memory line (an entry or a step): editable in place, removable, marked when off-screen. */
function memoryLine(text, kind, index, offscreenTitle, isKey = false) {
    const offscreen = text.startsWith(OFFSCREEN_PREFIX);
    const body = offscreen ? text.slice(OFFSCREEN_PREFIX.length) : text;
    const removeLabel = escapeHtml(kind === 'event' ? t('cast.removeEvent', 'Remove this entry') : t('cast.removeStep', 'Remove this step'));
    // What happened entries can be starred as key memories: never summed up, sent whenever the character is
    const keyLabel = escapeHtml(isKey
        ? t('cast.keyOn', 'Key memory: never summed up, and sent to the chat whenever this character is here or mentioned. Click to unstar.')
        : t('cast.keyOff', 'Star as a key memory: never summed up, and sent to the chat whenever this character is here or mentioned'));
    const star = kind === 'event'
        ? `<button type="button" class="rpg-cast-key" data-index="${index}" aria-pressed="${isKey}" title="${keyLabel}" aria-label="${keyLabel}"><i class="fa-${isKey ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i></button>`
        : '';
    return `
        <li class="rpg-cast-event${offscreen ? ' is-offscreen' : ''}${isKey ? ' is-key' : ''}"${offscreen ? ` title="${offscreenTitle}"` : ''}>
            ${offscreen ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>' : ''}
            <span class="rpg-cast-memory" contenteditable="true" spellcheck="false" data-kind="${kind}" data-index="${index}">${escapeHtml(body)}</span>
            ${star}
            <button type="button" class="rpg-cast-event-remove" data-kind="${kind}" data-index="${index}" title="${removeLabel}" aria-label="${removeLabel}">×</button>
        </li>`;
}

/** A character's archived memories: older What happened entries a mention of their keywords brings back. */
function archiveFold(character, offscreenTitle) {
    const archive = listArchive(character.name);
    if (!archive.length) return '';
    const key = `archive:${character.name}`;
    const keysTitle = escapeHtml(t('cast.archive.keysHelp', 'Keywords: when one comes up in the story, this memory goes back into the chat. Separate them with commas.'));
    const removeTitle = escapeHtml(t('cast.archive.remove', 'Remove this memory from the archive'));
    const entries = archive.slice().reverse().map((a) => `
        <div class="rpg-cast-archive-entry" data-id="${escapeHtml(a.id)}">
            <div class="rpg-cast-archive-head">
                <i class="fa-solid fa-key" aria-hidden="true"></i>
                <span class="rpg-cast-archive-keys" contenteditable="true" spellcheck="false" title="${keysTitle}">${escapeHtml(a.keywords.join(', '))}</span>
                <button type="button" class="rpg-cast-archive-delete" title="${removeTitle}" aria-label="${removeTitle}">×</button>
            </div>
            <ul class="rpg-cast-events">${a.entries.map((e) => {
                const offscreen = e.startsWith(OFFSCREEN_PREFIX);
                return `<li class="rpg-cast-event${offscreen ? ' is-offscreen' : ''}"${offscreen ? ` title="${offscreenTitle}"` : ''}>${offscreen ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>' : ''}<span>${escapeHtml(offscreen ? e.slice(OFFSCREEN_PREFIX.length) : e)}</span></li>`;
            }).join('')}</ul>
        </div>`).join('');
    return `
        <details class="rpg-cast-archive" data-key="${escapeHtml(key)}"${openState.get(key) ? ' open' : ''}>
            <summary><span class="rpg-cast-label">${escapeHtml(t('cast.archive.title', 'Archive'))}</span><span class="rpg-cast-archive-count">${archive.length}</span></summary>
            ${entries}
        </details>`;
}

function card(character) {
    const [statusKey, statusFallback] = STATUS_LABELS[character.status] || STATUS_LABELS.away;
    const open = openState.has(character.name) ? openState.get(character.name) : character.status === 'present';
    const offscreenTitle = escapeHtml(t('cast.offscreen', 'Happened off-screen: you have not seen this yet'));
    const steps = (character.steps || []).map((step, i) => memoryLine(step, 'step', i, offscreenTitle)).join('');
    const events = (character.events || []).map((event, i) => memoryLine(event, 'event', i, offscreenTitle, Boolean(character.keyMemories?.includes(event)))).join('');
    const lockTitle = character.locked
        ? t('cast.unlock', 'Locked: the background model leaves this character alone. Click to unlock.')
        : t('cast.lock', 'Lock this character so the background model stops changing them');
    const empty = (text) => `<p class="rpg-cast-pending">${escapeHtml(text)}</p>`;

    return `
        <details class="rpg-cast-card${character.locked ? ' is-locked' : ''}" data-name="${escapeHtml(character.name)}" data-status="${escapeHtml(character.status)}"${open ? ' open' : ''}>
            <summary class="rpg-cast-head">
                <span class="rpg-cast-name">${escapeHtml(character.name)}</span>
                <span class="rpg-cast-status">${escapeHtml(t(statusKey, statusFallback))}</span>
                <button type="button" class="rpg-cast-lock" aria-pressed="${character.locked}" title="${escapeHtml(lockTitle)}" aria-label="${escapeHtml(lockTitle)}"><i class="fa-solid ${character.locked ? 'fa-lock' : 'fa-lock-open'}"></i></button>
            </summary>
            <div class="rpg-cast-body">
                ${character.status === 'present' ? '' : `<div class="rpg-cast-block">
                    <span class="rpg-cast-label">${escapeHtml(t('cast.steps', 'Doing now'))}</span>
                    ${steps ? `<ul class="rpg-cast-events rpg-cast-steps-list">${steps}</ul>` : empty(character.status === 'away' ? t('cast.stepsPending', 'Picked up on the next update') : t('cast.stepsNone', 'Nothing yet'))}
                </div>`}
                <div class="rpg-cast-block">
                    <span class="rpg-cast-label">${escapeHtml(t('cast.events', 'What happened'))}</span>
                    ${events ? `<ul class="rpg-cast-events">${events}</ul>` : empty(t('cast.eventsNone', 'Nothing yet'))}
                </div>
                ${archiveFold(character, offscreenTitle)}
                <div class="rpg-cast-actions">
                    <button type="button" class="rpg-cast-delete">${escapeHtml(t('cast.delete', 'Forget this character'))}</button>
                </div>
            </div>
        </details>`;
}

/** Forgotten characters, each with a button to track them again. */
function forgottenLine() {
    const names = listForgotten();
    if (!names.length) return '';
    const title = escapeHtml(t('cast.rememberTitle', 'Track this character again (from scratch)'));
    return `<div class="rpg-cast-forgotten">
        <span>${escapeHtml(t('cast.forgotten', 'Forgotten:'))}</span>
        ${names.map((name) => `<button type="button" class="rpg-cast-remember" data-name="${escapeHtml(name)}" title="${title}">${escapeHtml(name)} <i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>`).join('')}
    </div>`;
}

/** Draws the Cast tab from the current chat's ledger. */
export function renderCast() {
    const $cast = $('#rpg-cast');
    if (!$cast.length) return;
    if (extensionSettings.castEnabled === false) {
        $cast.hide();
        return;
    }

    // Mid-edit: only refresh the status bar, so the field being typed in is kept
    if ($cast[0].contains(document.activeElement) && document.activeElement?.isContentEditable) {
        $cast.find('.rpg-cast-status-bar').replaceWith(statusBar());
        return;
    }

    const characters = listCharacters();
    const here = characters.filter((c) => c.status === 'present').length;
    const summary = characters.length
        ? `${characters.length} ${t('cast.known', 'known')} · ${here} ${t('cast.here', 'here')}`
        : '';

    $cast.html(`
        <div class="rpg-cast-header">
            <h4 class="rpg-cast-title">${escapeHtml(t('global.cast', 'Cast'))}</h4>
            <span class="rpg-cast-count">${escapeHtml(summary)}</span>
        </div>
        ${statusBar()}
        ${rangePicker()}
        ${modelSettings()}
        ${storyFold()}
        ${characters.length
            ? `<div class="rpg-cast-list">${characters.map(card).join('')}</div>`
            : `<p class="rpg-cast-empty">${escapeHtml(t('cast.empty', 'No characters yet. Everyone the story meets is remembered here as it goes on.'))}</p>`}
        ${forgottenLine()}
    `);
}

function nameOf(el) {
    return $(el).closest('.rpg-cast-card').data('name');
}

/** Hooks up the Cast tab: redraws on every cast change and saves edits. */
export function initCastTab() {
    onCastChanged(renderCast);
    renderCast();

    const $doc = $(document);
    // toggle does not bubble, so listen in the capture phase
    document.addEventListener('toggle', (e) => {
        if (e.target instanceof HTMLDetailsElement && e.target.matches('#rpg-cast .rpg-cast-card')) {
            openState.set(e.target.dataset.name, e.target.open);
        }
        if (e.target instanceof HTMLDetailsElement && e.target.matches('#rpg-cast .rpg-cast-archive')) {
            openState.set(e.target.dataset.key, e.target.open);
        }
    }, true);
    // The lock sits inside the summary: do not fold the card when it is clicked
    $doc.on('click', '#rpg-cast .rpg-cast-lock', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const locked = $(this).attr('aria-pressed') !== 'true';
        editCharacter(nameOf(this), { locked });
    });
    $doc.on('click', '#rpg-cast .rpg-cast-refresh', function () {
        if (this.disabled) return;
        refreshCast();
    });
    $doc.on('click', '#rpg-cast .rpg-cast-tidy', function () {
        if (this.disabled) return;
        tidyCast();
    });
    $doc.on('click', '#rpg-cast .rpg-cast-undo-tidy', () => undoTidy());
    $doc.on('change', '#rpg-cast .rpg-cast-range-select', async function () {
        let value = this.value;
        if (value === 'custom') {
            const answer = await callGenericPopup(t('cast.range.customPrompt', 'How many of the latest messages should the background model read? (0 = the whole story)'), POPUP_TYPE.INPUT, String(castReadRange()));
            if (answer === false || answer === null || answer === undefined || String(answer).trim() === '') {
                renderCast();
                return;
            }
            value = answer;
        }
        const number = Math.round(Number(value));
        extensionSettings.castUpdateDepth = Number.isFinite(number) && number >= 0 ? (number === 0 ? 0 : Math.max(2, number)) : 4;
        saveSettings();
        renderCast();
    });
    document.addEventListener('toggle', (e) => {
        if (e.target instanceof HTMLDetailsElement && e.target.matches('#rpg-cast .rpg-cast-model')) modelOpen = e.target.open;
        if (e.target instanceof HTMLDetailsElement && e.target.matches('#rpg-cast .rpg-cast-story')) storyOpen = e.target.open;
    }, true);
    $doc.on('change', '#rpg-cast .rpg-cast-connection', function () {
        extensionSettings.castConnection = this.value;
        saveSettings();
    });
    $doc.on('change', '#rpg-cast .rpg-cast-reasoning', function () {
        extensionSettings.castReasoning = this.value;
        saveSettings();
    });
    $doc.on('change', '#rpg-cast .rpg-cast-strict', function () {
        extensionSettings.castStrictJson = this.checked;
        saveSettings();
    });
    $doc.on('change', '#rpg-cast .rpg-cast-story-toggle', function () {
        extensionSettings.castStoryInject = this.checked;
        saveSettings();
        refreshCastPrompt();
    });
    $doc.on('keydown', '#rpg-cast .rpg-cast-story-text', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.blur();
        }
    });
    $doc.on('blur', '#rpg-cast .rpg-cast-story-text', function () {
        const kind = $(this).data('kind');
        const id = String($(this).data('id'));
        const item = getStory()[kind === 'chapter' ? 'chapters' : 'beats'].find((x) => x.id === id);
        if (item && item.text !== this.textContent.trim()) editStory(kind, id, this.textContent);
    });
    $doc.on('click', '#rpg-cast .rpg-cast-story-remove', function () {
        editStory($(this).data('kind'), String($(this).data('id')), '');
    });
    $doc.on('change', '#rpg-cast .rpg-cast-elsewhere-toggle', function () {
        extensionSettings.castElsewhere = this.checked;
        saveSettings();
        renderElsewhere();
    });
    $doc.on('change', '#rpg-cast .rpg-cast-meanwhile-toggle', function () {
        extensionSettings.castMeanwhile = this.checked;
        saveSettings();
        renderAllMeanwhile();
    });
    $doc.on('keydown', '#rpg-cast .rpg-cast-archive-keys', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.blur();
        }
    });
    $doc.on('blur', '#rpg-cast .rpg-cast-archive-keys', function () {
        const id = String($(this).closest('.rpg-cast-archive-entry').data('id'));
        editArchiveKeywords(id, this.textContent.split(','));
    });
    $doc.on('click', '#rpg-cast .rpg-cast-archive-delete', function () {
        deleteArchive(String($(this).closest('.rpg-cast-archive-entry').data('id')));
    });
    const listKey = (kind) => (kind === 'step' ? 'steps' : 'events');
    $doc.on('keydown', '#rpg-cast .rpg-cast-memory', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.blur();
        }
    });
    // Saving an edited line keeps its off-screen mark; an emptied line is removed
    $doc.on('blur', '#rpg-cast .rpg-cast-memory', function () {
        const name = nameOf(this);
        const key = listKey($(this).data('kind'));
        const index = Number($(this).data('index'));
        const character = listCharacters().find((c) => c.name === name);
        if (!character?.[key] || index >= character[key].length) return;
        const old = character[key][index];
        const mark = old.startsWith(OFFSCREEN_PREFIX) ? OFFSCREEN_PREFIX : '';
        const value = this.textContent.trim();
        if (value === old.slice(mark.length)) return;
        const list = [...character[key]];
        if (value) list[index] = mark + value;
        else list.splice(index, 1);
        // A starred entry stays starred when its text is edited
        const keyMemories = key === 'events' && character.keyMemories?.includes(old) && value
            ? character.keyMemories.map((k) => (k === old ? mark + value : k))
            : character.keyMemories;
        editCharacter(name, { [key]: list, ...(keyMemories ? { keyMemories } : {}) });
        refreshCastPrompt();
    });
    $doc.on('click', '#rpg-cast .rpg-cast-event-remove', function () {
        const name = nameOf(this);
        const key = listKey($(this).data('kind'));
        const index = Number($(this).data('index'));
        const character = listCharacters().find((c) => c.name === name);
        if (!character?.[key]) return;
        editCharacter(name, { [key]: character[key].filter((_, i) => i !== index) });
        refreshCastPrompt();
    });
    $doc.on('click', '#rpg-cast .rpg-cast-key', function () {
        toggleKeyMemory(nameOf(this), Number($(this).data('index')));
    });
    $doc.on('click', '#rpg-cast .rpg-cast-delete', async function () {
        const name = nameOf(this);
        const ok = await callGenericPopup(`${t('cast.deleteConfirm', 'Forget')} ${escapeHtml(name)}? ${t('cast.deleteNote', 'Their memory is removed from this chat, and Cast will not track them again unless you bring them back under Forgotten.')}`, POPUP_TYPE.CONFIRM);
        if (!ok) return;
        deleteCharacter(name);
    });
    $doc.on('click', '#rpg-cast .rpg-cast-remember', function () {
        rememberCharacter(String($(this).data('name')));
    });
}
