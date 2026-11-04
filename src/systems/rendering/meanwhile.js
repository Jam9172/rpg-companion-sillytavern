/**
 * Meanwhile: a small fold under each reply with what Cast's update for it changed off-screen (who left
 * or came back, and what the away characters started and finished). Scrolling up through the chat reads
 * as a timeline of the background story. Deleting, swiping or redoing a reply's update changes its fold.
 */

import { chat, eventSource, event_types } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { i18n } from '../../core/i18n.js';
import { getMeanwhile, onCastChanged } from '../features/cast.js';

// Folds the user opened, by message index, so a redraw keeps them open
const open = new Set();

const t = (key, fallback) => i18n.getTranslation(key) || fallback;

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function line(item) {
    const name = `<span class="rpg-meanwhile-name">${escapeHtml(item.name)}</span>`;
    switch (item.kind) {
        case 'left': return `<li class="is-status">${name} ${escapeHtml(t('meanwhile.left', 'left the scene'))}</li>`;
        case 'back': return `<li class="is-status">${name} ${escapeHtml(t('meanwhile.back', 'is back'))}</li>`;
        case 'died': return `<li class="is-status">${name} ${escapeHtml(t('meanwhile.died', 'died'))}</li>`;
        case 'done': return `<li><span class="rpg-meanwhile-kind">${escapeHtml(t('meanwhile.done', 'Finished'))}</span>${name}<span class="rpg-meanwhile-text">${escapeHtml(item.text)}</span></li>`;
        default: return `<li><span class="rpg-meanwhile-kind is-now">${escapeHtml(t('meanwhile.doing', 'Now'))}</span>${name}<span class="rpg-meanwhile-text">${escapeHtml(item.text)}</span></li>`;
    }
}

/** Draws (or removes) the Meanwhile fold of one message. */
export function renderMeanwhile(messageIndex) {
    const mes = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
    if (!mes) return;
    const existing = mes.querySelector(':scope .rpg-meanwhile');
    const enabled = extensionSettings.enabled && extensionSettings.castEnabled !== false && extensionSettings.castMeanwhile !== false;
    const items = enabled && !chat[messageIndex]?.is_user ? getMeanwhile(messageIndex) : [];
    if (!items.length) {
        existing?.remove();
        return;
    }
    const html = `<summary><i class="fa-solid fa-eye-slash" aria-hidden="true"></i><span>${escapeHtml(t('meanwhile.title', 'Meanwhile'))}</span><span class="rpg-meanwhile-count">${items.length}</span></summary><ul>${items.map(line).join('')}</ul>`;
    if (existing?.dataset.html === html) return;
    const fold = existing || document.createElement('details');
    fold.className = 'rpg-meanwhile';
    fold.dataset.mesid = String(messageIndex);
    fold.dataset.html = html;
    fold.innerHTML = html;
    fold.open = open.has(messageIndex);
    if (!existing) {
        const text = mes.querySelector('.mes_text');
        if (text) text.after(fold);
        else mes.querySelector('.mes_block')?.append(fold);
    }
}

/** Draws the Meanwhile folds of every message on screen. */
export function renderAllMeanwhile() {
    document.querySelectorAll('#chat .mes[mesid]').forEach((mes) => renderMeanwhile(Number(mes.getAttribute('mesid'))));
}

export function initMeanwhile() {
    // toggle does not bubble, so listen in the capture phase
    document.addEventListener('toggle', (e) => {
        if (!(e.target instanceof HTMLDetailsElement) || !e.target.matches('.rpg-meanwhile')) return;
        const index = Number(e.target.dataset.mesid);
        if (e.target.open) open.add(index); else open.delete(index);
    }, true);
    onCastChanged(renderAllMeanwhile);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (index) => renderMeanwhile(Number(index)));
    for (const event of [event_types.MESSAGE_SWIPED, event_types.MESSAGE_UPDATED, event_types.MESSAGE_EDITED, event_types.MORE_MESSAGES_LOADED, event_types.MESSAGE_DELETED]) {
        eventSource.on(event, () => setTimeout(renderAllMeanwhile, 0));
    }
    eventSource.on(event_types.CHAT_CHANGED, () => {
        open.clear();
        setTimeout(renderAllMeanwhile, 0);
    });
    renderAllMeanwhile();
}
