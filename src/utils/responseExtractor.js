/**
 * Response Extractor Utility
 *
 * Handles extraction of text content from various API response formats.
 * Fixes the "No message generated" error caused by Claude models with
 * extended thinking, where the API response `content` field is an array
 * of content blocks instead of a single string.
 *
 * Also provides a safe wrapper around SillyTavern's `generateRaw` that
 * intercepts the raw fetch response as a fallback.
 */

import { generateRaw } from '../../../../../../../script.js';

/**
 * Extracts text from any API response shape (Anthropic content-block arrays,
 * OpenAI choices, plain strings, etc.).
 *
 * @param {*} response - The raw API response (string, array, or object)
 * @returns {string} The extracted text content
 */
export function extractTextFromResponse(response) {
    if (!response) return '';
    if (typeof response === 'string') return response;

    // Response itself is an array of content blocks (Anthropic extended thinking)
    if (Array.isArray(response)) {
        const texts = response
            .filter(b => b && b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text);
        if (texts.length > 0) return texts.join('\n');

        const strings = response.filter(item => typeof item === 'string');
        if (strings.length > 0) return strings.join('\n');

        return JSON.stringify(response);
    }

    // response.content (string or Anthropic content array)
    if (response.content !== undefined && response.content !== null) {
        if (typeof response.content === 'string') return response.content;
        if (Array.isArray(response.content)) {
            const texts = response.content
                .filter(b => b && b.type === 'text' && typeof b.text === 'string')
                .map(b => b.text);
            if (texts.length > 0) return texts.join('\n');
        }
    }

    // OpenAI choices format
    if (response.choices?.[0]?.message?.content) {
        const c = response.choices[0].message.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
            const texts = c
                .filter(b => b && b.type === 'text' && typeof b.text === 'string')
                .map(b => b.text);
            if (texts.length > 0) return texts.join('\n');
        }
    }

    // Other common fields
    if (typeof response.text === 'string') return response.text;
    if (typeof response.message === 'string') return response.message;
    if (response.message?.content && typeof response.message.content === 'string') {
        return response.message.content;
    }

    return JSON.stringify(response);
}

/** safeGenerateRaw calls in progress, each collecting the generate responses seen while it runs. */
const activeCalls = new Set();
let captureFetch = null;       // the shared window.fetch wrapper, while installed
let fetchBeforeCapture = null; // what window.fetch was before it

function isGenerateUrl(url) {
    return url.includes('/api/backends/') && url.includes('/generate');
}

/** Hands a generate response to the calls in progress, without holding it back from its caller. */
function offerResponse(args, response) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (!isGenerateUrl(url)) return;
    // Streaming replies (SillyTavern's main reply) are never what generateRaw reads
    if ((response.headers?.get?.('content-type') || '').includes('event-stream')) return;
    let pending;
    try {
        pending = response.clone().json().catch(() => null);
    } catch (e) {
        return;
    }
    const body = typeof args[1]?.body === 'string' ? args[1].body : '';
    for (const call of activeCalls) call.responses.push({ body, pending });
}

function startCapture(call) {
    for (const other of activeCalls) {
        other.overlapped = true;
        call.overlapped = true;
    }
    activeCalls.add(call);
    if (captureFetch && window.fetch === captureFetch) return;
    fetchBeforeCapture = window.fetch;
    const base = fetchBeforeCapture;
    captureFetch = async function (...args) {
        const response = await base.apply(this, args);
        if (activeCalls.size) offerResponse(args, response);
        return response;
    };
    window.fetch = captureFetch;
}

function endCapture(call) {
    activeCalls.delete(call);
    if (activeCalls.size) return;
    // Only put fetch back if nobody wrapped it after us; otherwise our wrapper stays in their chain,
    // where it does nothing while no call is in progress
    if (window.fetch === captureFetch) window.fetch = fetchBeforeCapture;
    captureFetch = null;
    fetchBeforeCapture = null;
}

/** Lines of the prompt long enough to recognise its request body by. */
function promptMarkers(prompt) {
    const texts = Array.isArray(prompt) ? prompt.map((m) => m?.content) : [prompt];
    return texts
        .filter((t) => typeof t === 'string')
        .flatMap((t) => t.split('\n'))
        .map((line) => line.trim())
        .filter((line) => line.length >= 20 && !line.includes('{{'))
        .map((line) => JSON.stringify(line).slice(1, -1));
}

/** The raw response of this call's own request, or null when it can't be told apart from another call's. */
async function ownRawData(call, options) {
    const markers = promptMarkers(options?.prompt);
    const mine = call.responses.filter((r) => markers.some((m) => r.body.includes(m)));
    const pick = mine.length ? mine[mine.length - 1] : (!call.overlapped && call.responses.length === 1 ? call.responses[0] : null);
    return pick ? await pick.pending : null;
}

/**
 * Safe wrapper around SillyTavern's `generateRaw`.
 *
 * While it runs, a shared `window.fetch` wrapper keeps a copy of generate responses (never holding them
 * back from their caller, and skipping streaming ones). If `generateRaw` throws "No message generated"
 * (e.g. because the first content block from Claude extended thinking is empty), we extract the real
 * text from this call's own raw response ourselves.
 *
 * @param {object} options - Options passed directly to `generateRaw`
 * @param {Array<{role: string, content: string}>} options.prompt - Message array
 * @param {boolean} [options.quietToLoud] - Whether to use quiet-to-loud mode
 * @returns {Promise<string>} The generated text
 */
export async function safeGenerateRaw(options) {
    const call = { responses: [], overlapped: false };
    startCapture(call);
    try {
        return await generateRaw(options);
    } catch (genErr) {
        if (genErr?.message?.includes('No message generated')) {
            const rawData = await ownRawData(call, options);
            if (rawData) {
                console.warn(
                    '[RPG Companion] generateRaw failed (likely extended thinking). Extracting from raw API data.',
                );
                const extracted = extractTextFromResponse(rawData);
                if (!extracted || !extracted.trim()) {
                    throw new Error('Could not extract text from API response');
                }
                return extracted;
            }
        }
        throw genErr; // Re-throw non-related errors
    } finally {
        endCapture(call);
    }
}
