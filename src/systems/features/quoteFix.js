/**
 * Mismatched quote repair.
 *
 * SillyTavern colours dialogue only when both quote marks match: "…" or “…”. Models often open with a
 * curly “ and close with a straight " (very often on the last line of a reply), or the other way round,
 * and then the line is left uncoloured with a plain straight mark. When a reply arrives this pairs each
 * mismatched quote with its partner, so the line gets coloured like any other dialogue.
 */

import { chat, eventSource, event_types, updateMessageBlock } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';

const OPEN_CURLY = '“';
const CLOSE_CURLY = '”';
const STRAIGHT = '"';

// HTML tags and code spans are left alone (their quote marks are not dialogue)
const SKIP_PATTERN = /(<[^>]*>|`[^`\n]*`)/;

/**
 * A straight quote opens dialogue when it starts the line or follows a space or an opening bracket
 * or dash; anything else closes it.
 */
function isOpeningPosition(prev) {
    return prev === undefined || /[\s([{—–*_~>-]/.test(prev);
}

/**
 * Pairs mismatched quote marks on each line: “…" becomes “…” and "…” becomes “…”. Matching pairs and
 * lone marks are left as they are.
 * @param {string} text - Message text
 * @returns {string} The text with mismatched pairs repaired
 */
export function fixMismatchedQuotes(text) {
    if (typeof text !== 'string' || !text.includes(STRAIGHT) || !(text.includes(OPEN_CURLY) || text.includes(CLOSE_CURLY))) {
        return text;
    }

    return text.split('\n').map((line) => {
        if (!line.includes(STRAIGHT)) return line;

        // split() with a capture group: odd entries are the skipped tags and code spans
        const parts = line.split(SKIP_PATTERN);
        const chars = parts.map((part, p) => (p % 2 ? null : [...part]));

        // open: null, or { kind: 'curly' | 'straight', part, index } of the quote still waiting for its partner
        let open = null;
        chars.forEach((partChars, p) => {
            if (!partChars) return;
            partChars.forEach((ch, i) => {
                const prev = i > 0 ? partChars[i - 1] : undefined;
                if (ch === OPEN_CURLY) {
                    open = { kind: 'curly', part: p, index: i };
                } else if (ch === CLOSE_CURLY) {
                    // "…” : make the straight opener curly too
                    if (open?.kind === 'straight') chars[open.part][open.index] = OPEN_CURLY;
                    open = null;
                } else if (ch === STRAIGHT) {
                    if (open?.kind === 'curly' && !isOpeningPosition(prev)) {
                        // “…" : make the straight closer curly
                        partChars[i] = CLOSE_CURLY;
                        open = null;
                    } else if (open?.kind === 'straight') {
                        open = null;
                    } else {
                        open = { kind: 'straight', part: p, index: i };
                    }
                }
            });
        });

        return parts.map((part, p) => (chars[p] ? chars[p].join('') : part)).join('');
    }).join('\n');
}

/**
 * Repairs the quotes of a newly received reply (and its current swipe) and redraws it if anything changed.
 * @param {number} messageId - Index of the message in the chat
 */
function onReplyReceived(messageId) {
    if (!extensionSettings.enabled || extensionSettings.fixMismatchedQuotes === false) return;

    const message = chat[messageId];
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') return;

    const fixed = fixMismatchedQuotes(message.mes);
    if (fixed === message.mes) return;

    message.mes = fixed;
    if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = fixed;
    }
    // Streamed replies are already on screen; redraw this one from the repaired text
    if (document.querySelector(`#chat .mes[mesid="${messageId}"]`)) {
        updateMessageBlock(messageId, message);
    }
}

/**
 * Registers the repair for new replies. SillyTavern saves the chat after a reply arrives, so the
 * repaired text is what gets saved.
 */
export function initQuoteFix() {
    eventSource.on(event_types.MESSAGE_RECEIVED, onReplyReceived);
}
