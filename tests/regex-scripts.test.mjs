// The regex scripts RPG Companion installs in SillyTavern's Regex extension
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext } from './helpers/env.mjs';

const { REGEX_SCRIPTS, syncRegexScripts } = await ext('src/systems/features/regexScripts.js');

// SillyTavern's regexFromString (public/scripts/utils.js) and a plain replace, which is what its engine
// does for a script with an empty replacement
function run(script, text) {
    const m = script.findRegex.match(/(\/?)(.+)\1([a-z]*)/i);
    return text.replace(new RegExp(m[2], m[3]), script.replaceString ?? '');
}
const install = (enabled = true, regex = []) => { const settings = { regex }; syncRegexScripts(settings, () => {}, { enabled }); return settings.regex; };
const byName = (scripts, part) => scripts.find((s) => s.scriptName.includes(part));

const TRACKERS = '```json\n{\n  "userStats": {"stats": []},\n  "infoBox": {"location": {"value": "Cell"}},\n  "characters": []\n}\n```';

test('tracker scripts remove tracker blocks and nothing else', () => {
    const scripts = install();
    for (const script of [byName(scripts, 'Together Mode'), byName(scripts, 'Clean RPG Trackers')]) {
        const code = 'Here is the fix:\n```python\ndef area(r):\n    return 3.14159 * r * r\n```\nCall it with `area(2)`.';
        assert.equal(run(script, code), code, 'code block kept');
        const statusWindow = '```json\n{"name": "Mira", "hp": 12}\n```';
        assert.equal(run(script, statusWindow), statusWindow, 'other JSON kept');
        assert.equal(run(script, `She nods.\n${TRACKERS}`), 'She nods.\n');
        assert.equal(run(script, `She nods.\n${TRACKERS.replace('```json', '```')}`), 'She nods.\n', 'bare fence');
        assert.equal(run(script, '```json\n{"trackers": {"infoBox": {"date": {"value": "x"}}}}\n```'), '', 'wrapped');
        // a tracker block after another JSON block: only the tracker block goes
        assert.equal(run(script, `${statusWindow}\nThen:\n${TRACKERS}\nEnd.`), `${statusWindow}\nThen:\n\nEnd.`);
    }
});

test('Clean HTML removes HTML tags but keeps the extension\'s own tags and plain text', () => {
    const script = byName(install(), 'Clean HTML');
    const keep = [
        '<font color=#abc123>"You\'re pretty good."</font> she says.',
        '"I was at the docks all night," Mira says. <lie truth="She was at the vault" reason="hiding the theft"/>',
        '<ofilter event="Zandik takes the key" reason="behind Mari"/> You hear a faint click.',
        'The gauge reads x < 5 while y > 3, so we wait.',
        '<!-- a comment -->',
    ];
    for (const text of keep) assert.equal(run(script, text), text);
    assert.equal(run(script, 'A sign: <div style="color: red">KEEP OUT</div><br> Below it, mud.'), 'A sign:KEEP OUT Below it, mud.');
    assert.equal(run(script, 'Song <spotify:Song - Artist/> plays.'), 'Song plays.');
});

test('an install from before is updated; what the user changed is kept', () => {
    const old = [
        { scriptName: 'RPG Companion - Remove Tracker JSON (Together Mode)', findRegex: '/```(?:json|markdown)?[\\s\\S]*?```/gim', disabled: true, markdownOnly: true, promptOnly: true },
        { scriptName: 'Clean HTML (From Outgoing Prompt)', findRegex: '/\\s?<(?!\\!--)(?:"[^"]*"|\'[^\']*\'|[^\'">])*>/g', disabled: false, promptOnly: true },
        { scriptName: 'Clean RPG Trackers (From Outgoing Prompt)', findRegex: '/my own pattern/g', disabled: false, promptOnly: true },
    ];
    const scripts = install(true, old);
    assert.equal(scripts.length, 3);
    const together = byName(scripts, 'Together Mode');
    assert.equal(together.findRegex, REGEX_SCRIPTS[2].findRegex, 'the catch-all pattern is replaced');
    assert.equal(together.disabled, true, 'a script the user disabled stays disabled');
    assert.equal(byName(scripts, 'Clean HTML').findRegex, REGEX_SCRIPTS[0].findRegex, 'old default updated');
    assert.equal(byName(scripts, 'Clean RPG Trackers').findRegex, '/my own pattern/g', 'a rewritten pattern is kept');
});

test('with RPG Companion off, Clean HTML is off too, and comes back with it', () => {
    const settings = { regex: [] };
    const sync = (enabled) => syncRegexScripts(settings, () => {}, { enabled });
    sync(true);
    const html = byName(settings.regex, 'Clean HTML');
    sync(false);
    assert.equal(html.disabled, true);
    assert.equal(byName(settings.regex, 'Together Mode').disabled, false, 'tracker JSON stays hidden');
    sync(true);
    assert.equal(html.disabled, false);
    // one the user disabled stays disabled through off and on
    html.disabled = true;
    sync(false); sync(true);
    assert.equal(html.disabled, true);
    assert.equal(sync(true), false, 'nothing to change the second time');
});
