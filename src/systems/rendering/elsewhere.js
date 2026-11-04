/**
 * Elsewhere: a button at the top right of the chat that opens every away character's current off-screen
 * activity at a glance (an overlay on desktop, a full-screen sheet on phones). It only shows while
 * someone is away with something in Doing now.
 */

import { chat, eventSource, event_types } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { i18n } from '../../core/i18n.js';
import { listCharacters, onCastChanged, OFFSCREEN_PREFIX } from '../features/cast.js';

const t = (key, fallback) => i18n.getTranslation(key) || fallback;
let isOpen = false;

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const plain = (line) => String(line || '').replace(OFFSCREEN_PREFIX, '');

/** Away characters with something in Doing now, the longest unseen first. */
function awayCharacters() {
    return listCharacters()
        .filter((c) => c.status === 'away' && c.steps?.length)
        .sort((a, b) => (a.lastSeen ?? 0) - (b.lastSeen ?? 0));
}

function seenLabel(character) {
    const replies = Math.max(0, chat.length - 1 - (character.lastSeen ?? chat.length - 1));
    if (!replies) return t('elsewhere.justLeft', 'just left');
    return `${t('elsewhere.seen', 'last seen')} ${replies} ${replies === 1 ? t('elsewhere.message', 'message') : t('elsewhere.messages', 'messages')} ${t('elsewhere.ago', 'ago')}`;
}

function card(character) {
    const steps = character.steps.map(plain);
    const now = steps.at(-1);
    const before = steps.slice(0, -1);
    const last = character.events?.length ? plain(character.events.at(-1)) : '';
    return `
        <article class="rpg-elsewhere-card">
            <header><span class="rpg-elsewhere-name">${escapeHtml(character.name)}</span><span class="rpg-elsewhere-seen">${escapeHtml(seenLabel(character))}</span></header>
            ${before.length ? `<ul class="rpg-elsewhere-before">${before.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
            <p class="rpg-elsewhere-now"><span class="rpg-elsewhere-tag">${escapeHtml(t('elsewhere.now', 'Now'))}</span>${escapeHtml(now)}</p>
            ${last ? `<p class="rpg-elsewhere-last"><span class="rpg-elsewhere-tag">${escapeHtml(t('elsewhere.last', 'Last'))}</span>${escapeHtml(last)}</p>` : ''}
        </article>`;
}

const glyph = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="10" r="3"/><path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z"/></svg>';

function setOpen(open, { focus = true } = {}) {
    isOpen = open;
    $('#rpg-elsewhere-panel, #rpg-elsewhere-backdrop').toggleClass('is-shown', open);
    $('#rpg-elsewhere-button').attr('aria-expanded', String(open));
    if (!focus) return;
    if (open) $('#rpg-elsewhere-panel .rpg-elsewhere-close').trigger('focus');
    else $('#rpg-elsewhere-button').trigger('focus');
}

/** Puts the button at the top right of the chat, below anything above the messages. */
function position() {
    const chatEl = document.getElementById('chat');
    const $button = $('#rpg-elsewhere-button');
    if (!chatEl || !$button.length) return;
    const rect = chatEl.getBoundingClientRect();
    $button.css({ top: `${rect.top + 12}px`, left: 'auto', right: `${Math.max(8, window.innerWidth - rect.right + 12)}px` });
}

/** Draws (or removes) the Elsewhere button and its panel from the current cast. */
export function renderElsewhere() {
    const enabled = extensionSettings.enabled && extensionSettings.castEnabled !== false && extensionSettings.castElsewhere !== false;
    const away = enabled ? awayCharacters() : [];
    if (!away.length) {
        $('#rpg-elsewhere-button, #rpg-elsewhere-panel, #rpg-elsewhere-backdrop').remove();
        isOpen = false;
        return;
    }
    const title = t('elsewhere.title', 'Elsewhere');
    const closeText = t('common.close', 'Close');
    const phone = window.innerWidth <= 1000;
    const theme = extensionSettings.theme;

    if (!$('#rpg-elsewhere-button').length) {
        $('body').append(`
            <button type="button" id="rpg-elsewhere-button" data-theme="${escapeHtml(theme)}" aria-haspopup="dialog" aria-expanded="false" title="${escapeHtml(t('elsewhere.help', 'What the characters who are away are doing right now'))}">
                ${glyph}<span class="rpg-elsewhere-button-label">${escapeHtml(title)}</span><span class="rpg-elsewhere-count"></span>
            </button>
            <div id="rpg-elsewhere-backdrop"></div>
            <div id="rpg-elsewhere-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"></div>`);
        $('#rpg-elsewhere-button').on('click', () => setOpen(true));
        $('#rpg-elsewhere-backdrop').on('click', () => setOpen(false));
        $('#rpg-elsewhere-panel').on('click', '.rpg-elsewhere-close', () => setOpen(false));
    }
    $('#rpg-elsewhere-button').attr('data-theme', theme).find('.rpg-elsewhere-count').text(away.length);
    $('#rpg-elsewhere-panel')
        .attr('data-theme', theme)
        .toggleClass('is-sheet', phone)
        .html(`
            <div class="rpg-elsewhere-head">
                <span class="rpg-elsewhere-title">${glyph}${escapeHtml(title)}</span>
                <span class="rpg-elsewhere-count">${away.length}</span>
                <button type="button" class="rpg-elsewhere-close" title="${escapeHtml(closeText)}" aria-label="${escapeHtml(closeText)}">×</button>
            </div>
            <p class="rpg-elsewhere-note">${escapeHtml(t('elsewhere.note', 'Off-screen: the story has not shown you any of this yet.'))}</p>
            <div class="rpg-elsewhere-list">${away.map(card).join('')}</div>`);
    position();
    if (isOpen) setOpen(true, { focus: false });
}

export function initElsewhere() {
    onCastChanged(renderElsewhere);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        isOpen = false;
        setTimeout(renderElsewhere, 0);
    });
    for (const event of [event_types.MESSAGE_RECEIVED, event_types.MESSAGE_SENT, event_types.MESSAGE_DELETED]) {
        eventSource.on(event, () => setTimeout(renderElsewhere, 0));
    }
    $(window).on('resize.rpgElsewhere', () => {
        renderElsewhere();
        position();
    });
    $(document).on('keydown.rpgElsewhere', (e) => {
        if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            setOpen(false);
        }
    });
    renderElsewhere();
}
