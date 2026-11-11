// Cast's Reasoning dropdown: SillyTavern's Reasoning Effort scale, and what each level sends per provider
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly } from './helpers/env.mjs';

const { extensionSettings: s } = await ext('src/core/state.js');
const cast = await ext('src/systems/features/castRequest.js');
const LEVELS = ['min', 'low', 'medium', 'high', 'max'];
const column = (fn) => LEVELS.map(fn);

test('the scale, and settings saved before it', () => {
    assert.deepEqual(cast.CAST_REASONING, ['auto', 'min', 'low', 'medium', 'high', 'max']);
    const read = (saved) => { s.castReasoning = saved; return cast.castReasoning(); };
    assert.equal(read('off'), 'min');       // Off was "as little as possible"
    assert.equal(read('default'), 'auto');  // Model default
    assert.equal(read('low'), 'low');
    assert.equal(read('max'), 'max');
    assert.equal(read('nonsense'), 'min');
    assert.equal(read(undefined), 'min');
});

test('providers are recognised by connection name and by the External API address', () => {
    for (const api of ['claude', 'openrouter', 'xai', 'perplexity', 'nanogpt', 'deepseek']) assert.equal(cast.castProvider({ api }), api);
    for (const api of ['openai', 'azure_openai', 'custom', 'makersuite', 'mistralai']) assert.equal(cast.castProvider({ api }), 'openai', api);
    const byUrl = (baseUrl) => cast.castProvider({ baseUrl });
    assert.equal(byUrl('https://openrouter.ai/api/v1'), 'openrouter');
    assert.equal(byUrl('https://nano-gpt.com/api/v1'), 'nanogpt');
    assert.equal(byUrl('https://api.x.ai/v1'), 'xai');
    assert.equal(byUrl('https://api.perplexity.ai'), 'perplexity');
    assert.equal(byUrl('https://api.anthropic.com/v1'), 'claude');
    assert.equal(byUrl('https://api.openai.com/v1'), 'openai');
    assert.equal(byUrl('http://localhost:1234/v1'), 'openai');
    assert.equal(byUrl('https://api.box.ai/v1'), 'openai', 'not x.ai');
});

test('Auto sends no reasoning setting on any path', () => {
    for (const provider of ['claude', 'openai', 'openrouter', 'xai', 'perplexity', 'nanogpt', 'deepseek']) {
        assert.deepEqual(cast.backendReasoning('auto', provider), {});
        assert.deepEqual(cast.externalReasoning('auto', provider, 10000), {});
    }
});

test('through SillyTavern\'s backend each level is what the provider column says', () => {
    const sent = (provider) => column((level) => cast.backendReasoning(level, provider).reasoning_effort);
    assert.deepEqual(sent('openai'), ['low', 'low', 'medium', 'high', 'high']);
    assert.deepEqual(sent('openrouter'), ['low', 'low', 'medium', 'high', 'high']);
    assert.deepEqual(sent('xai'), ['low', 'low', 'low', 'high', 'high']);
    assert.deepEqual(sent('perplexity'), ['low', 'low', 'medium', 'high', 'high']);
    // Claude and NanoGPT get SillyTavern's scale: its backend makes the budget (1024, 15%, 25%, 50%, 95%)
    // and NanoGPT's words (none, minimal, low, medium, high) from it
    assert.deepEqual(sent('claude'), LEVELS);
    assert.deepEqual(sent('nanogpt'), LEVELS);
    assert.equal(cast.backendReasoning('low', 'deepseek').include_reasoning, true);
    assert.equal(cast.backendReasoning('low', 'openai').include_reasoning, false);
});

test('called directly (External API) each level is what the provider column says', () => {
    const room = 20000;
    assert.deepEqual(column((l) => cast.externalReasoning(l, 'nanogpt', room).reasoning_effort), ['none', 'minimal', 'low', 'medium', 'high']);
    assert.deepEqual(cast.externalReasoning('low', 'nanogpt', room).reasoning, { exclude: true });
    assert.deepEqual(column((l) => cast.externalReasoning(l, 'openrouter', room).reasoning.effort), ['low', 'low', 'medium', 'high', 'high']);
    assert.deepEqual(column((l) => cast.externalReasoning(l, 'openai', room).reasoning_effort), ['low', 'low', 'medium', 'high', 'high']);
    assert.deepEqual(column((l) => cast.externalReasoning(l, 'xai', room).reasoning_effort), ['low', 'low', 'low', 'high', 'high']);
    assert.deepEqual(column((l) => cast.externalReasoning(l, 'perplexity', room).reasoning_effort), ['low', 'low', 'medium', 'high', 'high']);
    // Claude: 1024, then 15%, 25%, 50% and 95% of the room, never under 1024 or over 21333
    assert.deepEqual(column((l) => cast.externalReasoning(l, 'claude', room).thinking.budget_tokens), [1024, 3000, 5000, 10000, 19000]);
    assert.equal(cast.externalReasoning('low', 'claude', 4000).thinking.budget_tokens, 1024);
    assert.equal(cast.externalReasoning('max', 'claude', 30000).thinking.budget_tokens, 21333);
    assert.ok('temperature' in cast.externalReasoning('low', 'claude', room), 'no temperature while Claude thinks');
});

test('the reply keeps its room at every level, on every provider', () => {
    const reply = { update: 3000, tidy: 6000, fold: 4000 };
    const share = { claude: [0, 0.15, 0.25, 0.5, 0.95], openrouter: [0.2, 0.2, 0.5, 0.8, 0.8] };
    for (const task of Object.keys(reply)) {
        for (const provider of ['claude', 'openai', 'openrouter', 'xai', 'perplexity', 'nanogpt']) {
            const rooms = column((level) => cast.castTokenRoom(task, level, provider));
            assert.deepEqual(rooms, [...rooms].sort((a, b) => a - b), `${task}/${provider}: more thinking, more room`);
            rooms.forEach((room, i) => {
                let thinking = Math.floor(room * (share[provider]?.[i] ?? 0));
                if (provider === 'claude') thinking = Math.min(Math.max(thinking, 1024), 21333);
                assert.ok(room - thinking >= reply[task], `${task}/${provider}/${LEVELS[i]}: ${room} - ${thinking} leaves the reply ${reply[task]}`);
                assert.ok(room <= 32000, `${task}/${provider}/${LEVELS[i]}: ${room} stays within what models accept`);
            });
        }
        assert.ok(cast.castTokenRoom(task, 'auto', 'openai') >= reply[task]);
    }
});
