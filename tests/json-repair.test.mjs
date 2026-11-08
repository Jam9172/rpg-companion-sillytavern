import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly } from './helpers/env.mjs';

const { repairJSON } = await ext('src/utils/jsonRepair.js');

test('repairJSON does not evaluate text that is not JSON', async () => {
    globalThis.__evaluated = undefined;
    for (const text of ['{a: (globalThis.__evaluated = true)}', '{a: f()}', '[globalThis.__evaluated = 1]', '{a: undefined}']) {
        assert.equal(await quietly(() => repairJSON(text)), null, text);
    }
    assert.equal(globalThis.__evaluated, undefined);
});

test('repairJSON still reads bare keys and single-quoted strings', () => {
    assert.deepEqual(repairJSON(`{mood: 'calm', n: 2, list: ['a', "b's"], nested: {ok: true}}`),
        { mood: 'calm', n: 2, list: ['a', "b's"], nested: { ok: true } });
    assert.deepEqual(repairJSON(`{name: 'Zandik\\'s Office', say: 'a "quote"'}`), { name: "Zandik's Office", say: 'a "quote"' });
    assert.deepEqual(repairJSON('{"a": [1, 2,], }'), { a: [1, 2] });
});

test('opening a chat does not evaluate braces in the latest reply', async () => {
    const script = await st('script.js');
    const { extensionSettings } = await ext('src/core/state.js');
    const { onChatLoaded } = await ext('src/systems/integration/sillytavern.js');
    for (const enabled of [true, false]) {
        extensionSettings.enabled = enabled;
        const mes = 'The door opens. {mood: (globalThis.__evaluated = "yes")}';
        script.chat.length = 0;
        script.chat.push({ name: 'Innkeeper', is_user: false, is_system: false, mes, swipes: [mes], swipe_id: 0, extra: {} });
        globalThis.__evaluated = undefined;
        await quietly(async () => { try { await onChatLoaded(); } catch { /* the panel isn't there to render */ } });
        assert.equal(globalThis.__evaluated, undefined, `enabled=${enabled}`);
    }
});

test('repairJSON keeps // and /* inside strings', () => {
    for (const text of [
        '{\n  "weather": {"forecast": "Clear, see https://example.com"},\n  "time": {"start": "9:00"}\n}',
        '{"notes":"https://wiki.example/Library","time":{"start":"9:00"}}',
        '{"inventory":{"onPerson":"Scroll /* torn */ of Light"}}',
    ]) {
        assert.deepEqual(repairJSON(text), JSON.parse(text));
    }
});

test('repairJSON strips comments and trailing commas outside strings', () => {
    const text = '{\n  "hp": 80, // 0 to 100\n  "note": "see https://example.com // not a comment", /* stray */\n  "tags": ["a", "b",],\n}';
    assert.deepEqual(repairJSON(text), { hp: 80, note: 'see https://example.com // not a comment', tags: ['a', 'b'] });
    assert.deepEqual(repairJSON('{"a": 1, // last\n}'), { a: 1 });
    assert.deepEqual(repairJSON(`{note: 'a // b', n: 1,}`), { note: 'a // b', n: 1 });
});

test('a reply whose tracker text contains "//" keeps it', async () => {
    const { parseResponse } = await ext('src/systems/generation/parser.js');
    const reply = 'She smiles.\n```json\n{\n  "infoBox": {\n    "location": {"value": "Guild Hall"},\n    "weather": {"emoji": "🌧️", "forecast": "Rain // heavy"}\n  }\n}\n```';
    const result = await quietly(() => parseResponse(reply, { suppressNoDataError: true }));
    assert.equal(JSON.parse(result.infoBox).weather.forecast, 'Rain // heavy');
});

test('tracker JSON with \\\' inside a double-quoted string still parses', async () => {
    const text = '{"thoughts": {"content": "I don\\\'t trust him."}, "mood": "She\\\'s calm"}';
    assert.deepEqual(await quietly(() => repairJSON(text)), { thoughts: { content: "I don't trust him." }, mood: "She's calm" });
    const { parseResponse } = await ext('src/systems/generation/parser.js');
    const reply = 'He frowns.\n```json\n{"infoBox": {"location": {"value": "Kael\\\'s Forge"}}}\n```';
    const result = await quietly(() => parseResponse(reply, { suppressNoDataError: true }));
    assert.equal(JSON.parse(result.infoBox).location.value, "Kael's Forge");
});
