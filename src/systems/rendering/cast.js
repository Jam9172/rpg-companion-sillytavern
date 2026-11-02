/**
 * Cast tab: every character in the story's lasting memory, with their bio, finished events and what
 * they are doing now. Fields can be edited in place; a character can be locked (the background model
 * leaves them alone) or removed.
 */

import { extensionSettings } from '../../core/state.js';
import { i18n } from '../../core/i18n.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { listCharacters, editCharacter, deleteCharacter, onCastChanged, refreshCastPrompt } from '../features/cast.js';

const t = (key, fallback) => i18n.getTranslation(key) || fallback;

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

const FIELDS = [
    ['role', 'cast.field.role', 'Role'],
    ['appearance', 'cast.field.appearance', 'Looks'],
    ['personality', 'cast.field.personality', 'Personality'],
    ['relationship', 'cast.field.relationship', 'Toward you'],
    ['location', 'cast.field.location', 'Last seen'],
];

function field(name, key, label, value) {
    return `
        <div class="rpg-cast-field">
            <span class="rpg-cast-label">${escapeHtml(t(key, label))}</span>
            <span class="rpg-cast-value" contenteditable="true" spellcheck="false" data-field="${name}" data-placeholder="—">${escapeHtml(value)}</span>
        </div>`;
}

function card(character) {
    const [statusKey, statusFallback] = STATUS_LABELS[character.status] || STATUS_LABELS.away;
    const open = openState.has(character.name) ? openState.get(character.name) : character.status === 'present';
    const events = (character.events || []).map((event, i) => `
        <li class="rpg-cast-event">
            <span>${escapeHtml(event)}</span>
            <button type="button" class="rpg-cast-event-remove" data-index="${i}" title="${escapeHtml(t('cast.removeEvent', 'Remove this event'))}" aria-label="${escapeHtml(t('cast.removeEvent', 'Remove this event'))}">×</button>
        </li>`).join('');
    const lockTitle = character.locked
        ? t('cast.unlock', 'Locked: the background model leaves this character alone. Click to unlock.')
        : t('cast.lock', 'Lock this character so the background model stops changing them');

    return `
        <details class="rpg-cast-card${character.locked ? ' is-locked' : ''}" data-name="${escapeHtml(character.name)}" data-status="${escapeHtml(character.status)}"${open ? ' open' : ''}>
            <summary class="rpg-cast-head">
                <span class="rpg-cast-name">${escapeHtml(character.name)}</span>
                ${character.role ? `<span class="rpg-cast-role">${escapeHtml(character.role)}</span>` : ''}
                <span class="rpg-cast-status">${escapeHtml(t(statusKey, statusFallback))}</span>
                <button type="button" class="rpg-cast-lock" aria-pressed="${character.locked}" title="${escapeHtml(lockTitle)}" aria-label="${escapeHtml(lockTitle)}"><i class="fa-solid ${character.locked ? 'fa-lock' : 'fa-lock-open'}"></i></button>
            </summary>
            <div class="rpg-cast-body">
                ${FIELDS.map(([name, key, label]) => field(name, key, label, character[name])).join('')}
                <div class="rpg-cast-block">
                    <span class="rpg-cast-label">${escapeHtml(t('cast.bio', 'Background'))}</span>
                    <p class="rpg-cast-value rpg-cast-bio" contenteditable="true" spellcheck="false" data-field="bio" data-placeholder="—">${escapeHtml(character.bio)}</p>
                </div>
                ${events ? `<div class="rpg-cast-block"><span class="rpg-cast-label">${escapeHtml(t('cast.events', 'What happened'))}</span><ul class="rpg-cast-events">${events}</ul></div>` : ''}
                ${character.steps?.length ? `<div class="rpg-cast-block"><span class="rpg-cast-label">${escapeHtml(t('cast.steps', 'Doing now'))}</span><p class="rpg-cast-steps">${character.steps.map(escapeHtml).join(' → ')}</p></div>` : ''}
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
    $doc.on('keydown', '#rpg-cast .rpg-cast-value', function (e) {
        if (e.key === 'Enter' && !$(this).hasClass('rpg-cast-bio')) {
            e.preventDefault();
            this.blur();
        }
    });
    $doc.on('blur', '#rpg-cast .rpg-cast-value', function () {
        const value = this.textContent.trim();
        editCharacter(nameOf(this), { [$(this).data('field')]: value });
        refreshCastPrompt();
    });
    $doc.on('click', '#rpg-cast .rpg-cast-event-remove', function () {
        const name = nameOf(this);
        const index = Number($(this).data('index'));
        const character = listCharacters().find((c) => c.name === name);
        if (!character) return;
        editCharacter(name, { events: character.events.filter((_, i) => i !== index) });
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
