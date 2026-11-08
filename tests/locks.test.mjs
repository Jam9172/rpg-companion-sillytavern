import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const { extensionSettings } = await ext('src/core/state.js');
const { applyLocks, setItemLock, isItemLocked } = await ext('src/systems/generation/lockManager.js');
const send = (data) => quietly(() => JSON.parse(applyLocks(JSON.stringify(data), 'userStats')));

test('locking Stats keeps each stat\'s id, name and value', async () => {
    extensionSettings.lockedItems = {};
    setItemLock('userStats', 'stats', true);
    const sent = await send({ stats: [{ id: 'health', name: 'Health', value: 80 }, { id: 'arousal', name: 'Arousal', value: 0 }] });
    assert.deepEqual(sent.stats, [
        { id: 'health', name: 'Health', value: 80, locked: true },
        { id: 'arousal', name: 'Arousal', value: 0, locked: true },
    ]);
});

test('locking Stats in the older {name: value} shape keeps 0 as a value', async () => {
    extensionSettings.lockedItems = {};
    setItemLock('userStats', 'stats', true);
    const sent = await send({ stats: { health: 80, arousal: 0 } });
    assert.deepEqual(sent.stats, { health: { value: 80, locked: true }, arousal: { value: 0, locked: true } });
});

const lockManager = await ext('src/systems/generation/lockManager.js');
const inventory = await ext('src/systems/rendering/inventory.js');
// The lock path the inventory's lock icon carries for an item (what a click on it locks)
async function inventoryLockPath(name) {
    extensionSettings.showLockIcons = true;
    const host = document.createElement('div');
    host.innerHTML = await quietly(() => inventory.renderOnPersonView(`${name}, Torch`, 'list'));
    return [...host.querySelectorAll('.rpg-section-lock-icon')].map((el) => el.getAttribute('data-path')).find((p) => !p.endsWith('.Torch'));
}

test('locking an item whose name has a "." reaches the model', async () => {
    for (const name of ['Vol. 2 of the Codex', "St. John's Wort", '1.5L flask', '50% off coupon']) {
        extensionSettings.lockedItems = {};
        const path = await inventoryLockPath(name);
        setItemLock('userStats', path, true);
        assert.equal(isItemLocked('userStats', path), true, name);
        const sent = await send({ inventory: { onPerson: [{ name, quantity: 1 }, { name: 'Torch', quantity: 1 }] } });
        assert.deepEqual(sent.inventory.onPerson, [{ name, quantity: 1, locked: true }, { name: 'Torch', quantity: 1 }], name);
        setItemLock('userStats', path, false);
        assert.equal(isItemLocked('userStats', path), false, name);
    }
});

test('locks on names without a "." keep their old paths', async () => {
    assert.equal(await inventoryLockPath('Rope'), 'inventory.onPerson.Rope');
    extensionSettings.lockedItems = { userStats: { inventory: { onPerson: { Rope: true } } } };
    assert.equal(isItemLocked('userStats', 'inventory.onPerson.Rope'), true);
});

test('field locks on a character whose name has a "." reach the model', async () => {
    extensionSettings.lockedItems = {};
    setItemLock('characters', lockManager.lockPath('Dr. Vey', 'Appearance'), true);
    const sent = await quietly(() => JSON.parse(applyLocks(JSON.stringify([{ name: 'Dr. Vey', Appearance: 'Tall' }]), 'characters')));
    const vey = (Array.isArray(sent) ? sent : sent.characters)[0];
    assert.deepEqual(vey.Appearance, { value: 'Tall', locked: true });
});

test('names like __proto__ can\'t reach Object.prototype through a lock', async () => {
    extensionSettings.lockedItems = {};
    for (const name of ['__proto__', 'constructor', 'prototype']) {
        setItemLock('characters', lockManager.lockPath(name, 'Appearance'), true);
        setItemLock('userStats', lockManager.lockPath('inventory', 'stored', name, 'Rope'), true);
        setItemLock(name, 'Appearance', true);
        assert.equal(isItemLocked('characters', lockManager.lockPath(name, 'Appearance')), false, name);
    }
    assert.equal(({}).Appearance, undefined);
    assert.equal(Object.Appearance, undefined);
    assert.equal(({}).Rope, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(extensionSettings.lockedItems)), {});
});

test('names like "constructor" aren\'t sent to the model as locked', async () => {
    extensionSettings.lockedItems = { userStats: { skills: { Riding: true }, inventory: { onPerson: { Rope: true } } } };
    const sent = await send({ skills: ['constructor', 'Riding'], inventory: { onPerson: ['constructor', 'Rope'] } });
    assert.deepEqual(sent.skills, ['constructor', { name: 'Riding', locked: true }]);
    assert.deepEqual(sent.inventory.onPerson, ['constructor', { item: 'Rope', locked: true }]);
    const chars = await quietly(() => JSON.parse(applyLocks(JSON.stringify([{ name: 'constructor', Appearance: 'Tall' }]), 'characters')));
    assert.deepEqual((Array.isArray(chars) ? chars : chars.characters)[0], { name: 'constructor', Appearance: 'Tall' });
});
