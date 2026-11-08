import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const { cleanItemString, validateStoredInventory } = await ext('src/utils/security.js');
const { parseItems } = await ext('src/utils/itemParser.js');

test('__proto__ and the other __…__ names are removed from item lists, as documented', async () => {
    assert.equal(await quietly(() => cleanItemString('Sword, __proto__, Shield')), 'Sword, Shield');
    assert.equal(await quietly(() => cleanItemString('__proto__, __defineGetter__')), 'None');
    assert.deepEqual(await quietly(() => validateStoredInventory({ Home: 'Sword, __proto__, Shield' })), { Home: 'Sword, Shield' });
});

test('ordinary words are kept as items', () => {
    assert.equal(cleanItemString('Prototype, Constructor, Rope'), 'Prototype, Constructor, Rope');
});

test('names written with a capital second letter keep their spelling', () => {
    assert.deepEqual(parseItems('iPhone, eReader, rope, élan potion'), ['iPhone', 'eReader', 'Rope', 'Élan potion']);
    assert.equal(cleanItemString('iPhone, eReader'), 'iPhone, eReader');
});
