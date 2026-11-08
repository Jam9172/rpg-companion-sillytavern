import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st } from './helpers/env.mjs';

const pc = await ext('src/utils/presentCharacters.js');

test('namesMatch finds card names in longer names, in any alphabet', () => {
    for (const [card, ai] of [['Alice', 'Alice Liddell'], ['Zoë', 'Zoë Laurent'], ['José', 'José García'], ['Élise', 'Élise Dupont'],
        ['Анна', 'Анна Каренина'], ['Мария', 'Мария (служанка) Иванова'], ['明', '明 李'], ['Liddell', 'Alice Liddell']]) {
        assert.equal(pc.namesMatch(card, ai), true, `${card} / ${ai}`);
    }
});

test('namesMatch does not match parts of other words or someone\'s relative', () => {
    for (const [card, ai] of [['Ann', "Ann's Mother"], ['Ann', 'Ann’s Mother'], ['Ann', 'Annabel'], ['Анна', 'Аннушка'], ['Zoë', 'Zoëlle']]) {
        assert.equal(pc.namesMatch(card, ai), false, `${card} / ${ai}`);
    }
});

test('a card named in Cyrillic gets its portrait', async () => {
    const script = await st('script.js');
    const { FALLBACK_AVATAR_DATA_URI } = await ext('src/core/state.js');
    script.characters.length = 0;
    script.characters.push({ name: 'Анна', avatar: 'anna.png' });
    assert.notEqual(pc.resolvePresentCharacterPortrait('Анна Каренина'), FALLBACK_AVATAR_DATA_URI);
});

test('thoughts and relationship written as objects give their text, never "[object Object]"', () => {
    const [mira, bo, kael] = pc.parsePresentCharacters(JSON.stringify([
        { name: 'Mira', thoughts: { content: '' }, relationship: { status: 'Friend' } },
        { name: 'Bo', thoughts: { content: 'Hungry.' }, relationship: { label: 'Rival' } },
        { name: 'Kael', thoughts: 'Plain text.', relationship: 'Ally' },
    ]));
    assert.equal(mira.ThoughtsContent, '');
    assert.equal(mira.Relationship, 'Friend');
    assert.equal(bo.ThoughtsContent, 'Hungry.');
    assert.equal(typeof bo.Relationship, 'string');
    assert.equal(kael.ThoughtsContent, 'Plain text.');
    assert.equal(kael.Relationship, 'Ally');
});

test('one empty entry among the characters doesn\'t drop the others', () => {
    const names = pc.parsePresentCharacters(JSON.stringify([{ name: 'Mira' }, null, 'stray', { name: 'Bo' }])).map((c) => c.name);
    assert.deepEqual(names, ['Mira', 'Bo']);
    assert.deepEqual(pc.parsePresentCharacters(JSON.stringify({ characters: [null, { name: 'Bo' }] })).map((c) => c.name), ['Bo']);
});
