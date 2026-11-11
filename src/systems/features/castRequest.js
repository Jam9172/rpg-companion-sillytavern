/**
 * Cast's background model requests: which connection they use, how much the model may reason before it
 * answers, and strict JSON.
 *
 * Reasoning is the expensive part of a Cast update (most of the reply tokens on models that think, and
 * never shown), so Cast sets it per request instead of following the chat preset:
 *   - a Connection Profile picked in the Cast tab: that profile's model and preset, with Cast's settings
 *   - the main connection on OpenRouter: sent directly, with Cast's settings
 *   - RPG Companion's External API (OpenRouter, NanoGPT or any OpenAI-style API): Cast's settings added
 *     to its request
 *   - anything else: SillyTavern's own quiet generation (reasoning follows the preset)
 * With strict JSON on, the reply has to match the task's schema; a connection that rejects schemas is
 * retried without, one that rejects Cast's reasoning setting is retried with the model's default, and
 * one that rejects the token room is retried with a smaller one.
 *
 * The reasoning levels are SillyTavern's own Reasoning Effort scale (Auto, Minimum ... Maximum), and each
 * means to a provider what it means there:
 *
 *   | Level   | Claude (share of the room) | OpenAI   | OpenRouter      | xAI    | Perplexity | NanoGPT   |
 *   | Auto    | not sent                   | not sent | not sent        | -      | -          | -         |
 *   | Minimum | 1024 tokens                | "low"    | "low" (20%)     | "low"  | "low"      | "none"    |
 *   | Low     | 15%                        | "low"    | "low" (20%)     | "low"  | "low"      | "minimal" |
 *   | Medium  | 25%                        | "medium" | "medium" (50%)  | "low"  | "medium"   | "low"     |
 *   | High    | 50%                        | "high"   | "high" (80%)    | "high" | "high"     | "medium"  |
 *   | Maximum | 95%                        | "high"   | "high" (80%)    | "high" | "high"     | "high"    |
 *
 * Claude's thinking is at least 1024 tokens and, as Cast doesn't stream, at most 21333. OpenRouter turns
 * its keyword into that share of the room for the models it sizes that way.
 */

import { main_api } from '../../../../../../../script.js';
import { oai_settings, getChatCompletionModel } from '../../../../../../openai.js';
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings } from '../../core/state.js';
import { generateWithExternalAPI } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

export const CAST_REASONING = ['auto', 'min', 'low', 'medium', 'high', 'max'];
// Settings saved before the scale: Off asked for the least thinking, "Model default" left it to the model
const EARLIER_REASONING = { off: 'min', default: 'auto' };

// The keyword each level is for the providers that take one (the table above)
const KEYWORD = {
    openai:     { min: 'low',  low: 'low',     medium: 'medium', high: 'high',   max: 'high' },
    openrouter: { min: 'low',  low: 'low',     medium: 'medium', high: 'high',   max: 'high' },
    xai:        { min: 'low',  low: 'low',     medium: 'low',    high: 'high',   max: 'high' },
    perplexity: { min: 'low',  low: 'low',     medium: 'medium', high: 'high',   max: 'high' },
    nanogpt:    { min: 'none', low: 'minimal', medium: 'low',    high: 'medium', max: 'high' },
    // not in the table: SillyTavern's own mapping for DeepSeek
    deepseek:   { min: 'low',  low: 'low',     medium: 'high',   high: 'high',   max: 'max' },
};
// The share of the token room that becomes thinking, in percent, for the providers that size it that way
const THINKING_SHARE = {
    claude:     { min: 0,  low: 15, medium: 25, high: 50, max: 95 },
    openrouter: { min: 20, low: 20, medium: 50, high: 80, max: 80 },
};
const CLAUDE_THINKING = { least: 1024, most: 21333 };

// Room for the reply itself; thinking gets its own room on top, so it can't crowd the reply out
const REPLY_TOKENS = { update: 3000, tidy: 6000, fold: 4000 };
const THINKING_TOKENS = { min: 2000, low: 4000, medium: 6000, high: 9000, max: 12000 };
// With the level left to the model
const AUTO_TOKENS = { update: 10000, tidy: 16000, fold: 12000 };
// Updates invent off-screen lives; a tidy only cleans up
const TEMPERATURE = { update: 0.7, tidy: 0.3, fold: 0.3 };

/** @returns {string} one of CAST_REASONING */
export function castReasoning() {
    const saved = extensionSettings.castReasoning;
    const level = EARLIER_REASONING[saved] ?? saved;
    return CAST_REASONING.includes(level) ? level : 'min';
}

/**
 * The provider a request goes to, as one of the table's columns: by SillyTavern's name for the connection,
 * or by the External API's address. Anything else is treated as OpenAI-style (its keywords are valid on
 * SillyTavern's scale too).
 */
export function castProvider({ api = '', baseUrl = '' } = {}) {
    if (api) {
        return api in KEYWORD || api in THINKING_SHARE ? api : 'openai';
    }
    const host = [
        [/openrouter\.ai/i, 'openrouter'], [/nano-gpt\.com/i, 'nanogpt'], [/anthropic\.com/i, 'claude'],
        [/(^|[/.])x\.ai/i, 'xai'], [/perplexity\.ai/i, 'perplexity'], [/deepseek\.com/i, 'deepseek'],
    ].find(([pattern]) => pattern.test(baseUrl));
    return host ? host[1] : 'openai';
}

/** Claude's thinking budget for a level within a token room (the table's Claude column). */
function claudeThinkingTokens(level, maxTokens) {
    const wanted = Math.floor(maxTokens * THINKING_SHARE.claude[level] / 100);
    return Math.min(Math.max(wanted, CLAUDE_THINKING.least), CLAUDE_THINKING.most);
}

/**
 * The token room for a request: the reply's own room plus room to think. Where thinking is a share of
 * the room, the room is made large enough for the reply to keep its part after that share.
 */
export function castTokenRoom(task, level, provider) {
    if (level === 'auto') return AUTO_TOKENS[task];
    const reply = REPLY_TOKENS[task];
    let room = reply + THINKING_TOKENS[level];
    const share = THINKING_SHARE[provider]?.[level];
    if (share) {
        room = Math.max(room, Math.ceil(reply * 100 / (100 - share)));
    }
    if (provider === 'claude') {
        // its thinking never exceeds the cap, so neither does the room need to
        room = Math.min(room, reply + CLAUDE_THINKING.most);
    }
    return room;
}

/** Connection Profiles Cast can use (empty when the Connection Manager is off). */
export function castConnectionProfiles() {
    try {
        return getContext().ConnectionManagerRequestService.getSupportedProfiles()
            .filter((p) => p?.id)
            .map((p) => ({ id: p.id, name: p.name || p.id }));
    } catch {
        return [];
    }
}

/** The picked profile ({id, api}), or null for RPG Companion's own connection (also when the profile is gone). */
function castProfile() {
    const id = extensionSettings.castConnection || '';
    if (!id) return null;
    try {
        const profile = getContext().ConnectionManagerRequestService.getSupportedProfiles().find((p) => p?.id === id);
        return profile ? { id, api: String(profile.api || '') } : null;
    } catch {
        return null;
    }
}

// Cast's requests run in the background. TauriTavern only reports a failed request as an error when it is
// marked quiet; otherwise the error comes back as the reply's text.
const QUIET = { type: 'quiet' };

/**
 * Reasoning fields for a request that goes through SillyTavern's (or TauriTavern's) own backend.
 * - Auto: nothing is sent, so the connection's own preset decides.
 * - Claude and NanoGPT: the level on SillyTavern's scale; the backend turns it into Claude's thinking
 *   budget and into NanoGPT's own words ('min' is its "none").
 * - The others: the provider's keyword, as SillyTavern's own requests send it.
 * TauriTavern only turns DeepSeek's thinking on when the thinking is asked back, so it is asked for there
 * (the reply's text stays separate from it).
 */
export function backendReasoning(level, provider) {
    if (level === 'auto') return {};
    const scaled = provider === 'claude' || provider === 'nanogpt';
    return { reasoning_effort: scaled ? level : KEYWORD[provider][level], include_reasoning: provider === 'deepseek' };
}

/** Reasoning fields for RPG Companion's External API, which calls the provider directly. */
export function externalReasoning(level, provider, maxTokens) {
    if (level === 'auto') return {};
    if (provider === 'claude') {
        // Anthropic takes a thinking budget, and no temperature while thinking is on
        return { thinking: { type: 'enabled', budget_tokens: claudeThinkingTokens(level, maxTokens) }, temperature: undefined };
    }
    const effort = KEYWORD[provider][level];
    // OpenRouter takes a reasoning object; NanoGPT and OpenAI-style APIs a top-level reasoning_effort
    // (NanoGPT also leaves the thinking out of the reply with reasoning.exclude)
    if (provider === 'openrouter') return { reasoning: { effort, exclude: true } };
    if (provider === 'nanogpt') return { reasoning_effort: effort, reasoning: { exclude: true } };
    return { reasoning_effort: effort };
}

function asText(content) {
    if (content && typeof content === 'object') return JSON.stringify(content);
    return String(content ?? '');
}

/**
 * Where Cast's requests go: {via, provider, profile}. `via` is 'profile' (a Connection Profile), 'external'
 * (RPG Companion's External API), 'openrouter' (the main connection, sent directly) or 'preset'
 * (SillyTavern's own quiet generation, where reasoning follows the preset).
 */
function castRoute() {
    const profile = castProfile();
    if (profile) return { via: 'profile', provider: castProvider({ api: profile.api }), profile };
    if (extensionSettings.generationMode === 'external') {
        return { via: 'external', provider: castProvider({ baseUrl: extensionSettings.externalApiSettings?.baseUrl || '' }) };
    }
    if (main_api === 'openai' && oai_settings.chat_completion_source === 'openrouter') return { via: 'openrouter', provider: 'openrouter' };
    return { via: 'preset', provider: 'openai' };
}

async function send(messages, { via, provider, profile }, { maxTokens, temperature, reasoning, jsonSchema }) {
    const context = getContext();
    if (via === 'profile') {
        const result = await context.ConnectionManagerRequestService.sendRequest(profile.id, messages, maxTokens,
            { stream: false, extractData: true, includePreset: true },
            { ...QUIET, temperature, ...backendReasoning(reasoning, provider), ...(jsonSchema ? { json_schema: jsonSchema } : {}) });
        return asText(result?.content);
    }

    if (via === 'external') {
        const extra = { max_tokens: maxTokens, temperature, ...externalReasoning(reasoning, provider, maxTokens) };
        if (jsonSchema) extra.response_format = { type: 'json_schema', json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.value } };
        return asText(await generateWithExternalAPI(messages, extra));
    }

    if (via === 'openrouter') {
        const result = await context.ChatCompletionService.processRequest({
            stream: false,
            messages,
            model: getChatCompletionModel(oai_settings),
            chat_completion_source: 'openrouter',
            max_tokens: maxTokens,
            provider: oai_settings.openrouter_providers,
            allow_fallbacks: oai_settings.openrouter_allow_fallbacks,
            quantizations: oai_settings.openrouter_quantizations,
            ...QUIET,
            temperature,
            ...backendReasoning(reasoning, provider),
            ...(jsonSchema ? { json_schema: jsonSchema } : {}),
        }, {}, true);
        return asText(result?.content);
    }

    return asText(await safeGenerateRaw({ prompt: messages, quietToLoud: false, responseLength: maxTokens, jsonSchema }));
}

/**
 * Sends a Cast request and returns the reply text.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{task: 'update'|'tidy'|'fold', schema?: {name: string, value: Object}}} options
 * @returns {Promise<string>}
 */
export async function requestCast(messages, { task, schema }) {
    // A tidy has to catch contradictions across the whole memory, and summing up has to keep what matters;
    // both miss things without some thinking and run rarely, so they always reason at least a little
    const reasoning = task !== 'update' && castReasoning() === 'min' ? 'low' : castReasoning();
    const route = castRoute();
    let options = {
        // The token room stays the one for the picked setting, also when a retry falls back to the default
        maxTokens: castTokenRoom(task, reasoning, route.provider),
        temperature: TEMPERATURE[task],
        reasoning,
        jsonSchema: extensionSettings.castStrictJson !== false && schema
            ? { name: schema.name, strict: true, value: schema.value }
            : null,
    };

    // At most three tries: as set, then without whatever the connection turned down
    for (let attempt = 1; ; attempt++) {
        try {
            const text = await send(messages, route, options);
            if (text.trim() || !options.jsonSchema) return text;
            throw new Error('Empty reply');
        } catch (error) {
            const message = String(error?.message || error);
            if (attempt >= 3) throw error;
            if (options.reasoning !== 'auto' && /reason|thinking/i.test(message)) {
                // e.g. "Unsupported xAI reasoning_effort: low", or a model that always thinks
                console.warn('[RPG Companion] Cast: the connection turned down the reasoning setting, retrying with the model default:', message);
                options = { ...options, reasoning: 'auto' };
            } else if (options.maxTokens > AUTO_TOKENS[task] && /max[_ ]?(completion[_ ])?tokens|maximum[^.]*tokens|output tokens/i.test(message)) {
                // a model with a smaller output limit than the room this level asks for
                console.warn('[RPG Companion] Cast: the connection turned down the token room, retrying with a smaller one:', message);
                options = { ...options, maxTokens: AUTO_TOKENS[task] };
            } else if (options.jsonSchema) {
                // Some connections reject schemas, or return nothing with them
                console.warn('[RPG Companion] Cast: strict JSON failed, retrying without it:', message);
                options = { ...options, jsonSchema: null };
            } else {
                throw error;
            }
        }
    }
}
