import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const { extensionSettings } = await ext('src/core/state.js');
const inv = await ext('src/systems/rendering/inventory.js');
const { escapeAttribute } = await ext('src/utils/security.js');
extensionSettings.showLockIcons = true;

const name = `Lantern"><b class="injected">x</b>'`;
const render = (html) => { const host = document.createElement('div'); host.innerHTML = html; return host; };

for (const view of ['list', 'grid']) {
    test(`item names stay text in lock icons (${view} view)`, async () => {
        const cases = [
            ['onPerson', await quietly(() => inv.renderOnPersonView(name, view))],
            ['clothing', await quietly(() => inv.renderClothingView(name, view))],
            ['assets', await quietly(() => inv.renderAssetsView(name, view))],
            ['stored.Home', await quietly(() => inv.renderStoredView({ Home: name }, [], view))],
        ];
        for (const [where, html] of cases) {
            const host = render(html);
            assert.equal(host.querySelector('.injected'), null, where);
            const paths = [...host.querySelectorAll('.rpg-section-lock-icon')].map((el) => el.getAttribute('data-path'));
            assert.ok(paths.includes(`inventory.${where}.${name}`), `${where}: ${JSON.stringify(paths)}`);
        }
    });
}

test('escapeAttribute escapes quotes and angle brackets', () => {
    assert.equal(escapeAttribute(`a"b'c<d>&`), 'a&quot;b&#39;c&lt;d&gt;&amp;');
    assert.equal(escapeAttribute(undefined), '');
});

test('character names stay text in Present Characters lock icons', async () => {
    // Only the lock icons: the rest of the character card is outside this test
    const state = await ext('src/core/state.js');
    const { renderThoughts } = await ext('src/systems/rendering/thoughts.js');
    const charName = `Mira"><b class="injected">x</b>`;
    Object.assign(state.extensionSettings, {
        showCharacterThoughts: true,
        trackerConfig: { ...state.extensionSettings.trackerConfig, presentCharacters: { ...state.extensionSettings.trackerConfig?.presentCharacters, customFields: [{ name: 'Appearance', enabled: true }] } },
    });
    state.lastGeneratedData.characterThoughts = JSON.stringify([{ name: charName, Appearance: 'Tall' }]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    state.setThoughtsContainer($(host));
    await quietly(() => renderThoughts({ useCommittedFallback: false }));
    const locks = [...host.querySelectorAll('.rpg-section-lock-icon')];
    assert.ok(locks.length > 0);
    assert.ok(locks.every((el) => !el.querySelector('.injected')));
    const paths = locks.map((el) => el.getAttribute('data-path'));
    assert.ok(paths.includes(`${charName}.Appearance`), JSON.stringify(paths));
});
