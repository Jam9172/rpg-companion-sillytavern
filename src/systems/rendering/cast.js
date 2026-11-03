/**
 * Cast tab: every character in the story's lasting memory, with their bio, finished events and what
 * they are doing now. Fields can be edited in place; a character can be locked (the background model
 * leaves them alone) or removed.
 */

import { extensionSettings } from '../../core/state.js';
import { i18n } from '../../core/i18n.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { listCharacters, editCharacter, deleteCharacter, onCastChanged, refreshCastPrompt, OFFSCREEN_PREFIX, castReadRange, refreshCast, getCastStatus } from '../features/cast.js';
import { saveSettings } from '../../core/persistence.js';

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
    let line;
    if (status.running) line = `<span class="rpg-cast-state is-running">${escapeHtml(t('cast.state.running', 'Updating…'))}</span>`;
    else if (status.lastError) line = `<span class="rpg-cast-state is-error" title="${escapeHtml(status.lastError)}">${escapeHtml(t('cast.state.failed', 'Last update failed'))}: ${escapeHtml(status.lastError)}</span>`;
    else if (status.lastOk) line = `<span class="rpg-cast-state">${escapeHtml(t('cast.state.ok', 'Updated'))} ${escapeHtml(timeAgo(status.lastOk))}</span>`;
    else line = `<span class="rpg-cast-state">${escapeHtml(t('cast.state.idle', 'Updates after each reply'))}</span>`;
    return `
        <div class="rpg-cast-status-bar">
            ${line}
            <button type="button" class="rpg-cast-refresh" title="${escapeHtml(refreshHelp)}"${status.running ? ' disabled' : ''}>
                <i class="fa-solid fa-rotate${status.running ? ' fa-spin' : ''}" aria-hidden="true"></i>
                <span>${escapeHtml(t('cast.refresh', 'Refresh'))}</span>
            </button>
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
function memoryLine(text, kind, index, offscreenTitle) {
    const offscreen = text.startsWith(OFFSCREEN_PREFIX);
    const body = offscreen ? text.slice(OFFSCREEN_PREFIX.length) : text;
    const removeLabel = escapeHtml(kind === 'event' ? t('cast.removeEvent', 'Remove this entry') : t('cast.removeStep', 'Remove this step'));
    return `
        <li class="rpg-cast-event${offscreen ? ' is-offscreen' : ''}"${offscreen ? ` title="${offscreenTitle}"` : ''}>
            ${offscreen ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>' : ''}
            <span class="rpg-cast-memory" contenteditable="true" spellcheck="false" data-kind="${kind}" data-index="${index}">${escapeHtml(body)}</span>
            <button type="button" class="rpg-cast-event-remove" data-kind="${kind}" data-index="${index}" title="${removeLabel}" aria-label="${removeLabel}">×</button>
        </li>`;
}

function card(character) {
    const [statusKey, statusFallback] = STATUS_LABELS[character.status] || STATUS_LABELS.away;
    const open = openState.has(character.name) ? openState.get(character.name) : character.status === 'present';
    const offscreenTitle = escapeHtml(t('cast.offscreen', 'Happened off-screen: you have not seen this yet'));
    const steps = (character.steps || []).map((step, i) => memoryLine(step, 'step', i, offscreenTitle)).join('');
    const events = (character.events || []).map((event, i) => memoryLine(event, 'event', i, offscreenTitle)).join('');
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
                <div class="rpg-cast-block">
                    <span class="rpg-cast-label">${escapeHtml(t('cast.steps', 'Doing now'))}</span>
                    ${steps ? `<ul class="rpg-cast-events rpg-cast-steps-list">${steps}</ul>` : empty(character.status === 'away' ? t('cast.stepsPending', 'Picked up on the next update') : t('cast.stepsNone', 'Nothing yet'))}
                </div>
                <div class="rpg-cast-block">
                    <span class="rpg-cast-label">${escapeHtml(t('cast.events', 'What happened'))}</span>
                    ${events ? `<ul class="rpg-cast-events">${events}</ul>` : empty(t('cast.eventsNone', 'Nothing yet'))}
                </div>
                <div class="rpg-cast-actions">
                    <button type="button" class="rpg-cast-delete">${escapeHtml(t('cast.delete', 'Forget this character'))}</button>
                </div>
            </div>
        </details>`;
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
        ${characters.length
            ? `<div class="rpg-cast-list">${characters.map(card).join('')}</div>`
            : `<p class="rpg-cast-empty">${escapeHtml(t('cast.empty', 'No characters yet. Everyone the story meets is remembered here as it goes on.'))}</p>`}
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
        editCharacter(name, { [key]: list });
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
    $doc.on('click', '#rpg-cast .rpg-cast-delete', async function () {
        const name = nameOf(this);
        const ok = await callGenericPopup(`${t('cast.deleteConfirm', 'Forget')} ${escapeHtml(name)}? ${t('cast.deleteNote', 'Their memory is removed from this chat.')}`, POPUP_TYPE.CONFIRM);
        if (!ok) return;
        deleteCharacter(name);
        refreshCastPrompt();
    });
}
