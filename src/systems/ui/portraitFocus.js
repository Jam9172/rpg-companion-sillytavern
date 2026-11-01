/**
 * Portrait focus picker
 * Lets the user choose where a large character portrait centres (and how far it
 * zooms) when it is cropped into the character card's banner.
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';

const DEFAULT_FOCUS = { x: 50, y: 0, zoom: 1 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Saved focus for a character, or the default (top centre, no zoom).
 * @param {string} name
 * @returns {{x: number, y: number, zoom: number}}
 */
export function getPortraitFocus(name) {
    const saved = extensionSettings.portraitFocus?.[name];
    if (!saved) return { ...DEFAULT_FOCUS };
    return {
        x: clamp(Number(saved.x) || 0, 0, 100),
        y: clamp(Number(saved.y) || 0, 0, 100),
        zoom: clamp(Number(saved.zoom) || 1, MIN_ZOOM, MAX_ZOOM)
    };
}

/**
 * Inline style that crops an <img> (object-fit: cover) around a focus point.
 * @param {{x: number, y: number, zoom: number}} focus
 * @returns {string}
 */
export function portraitFocusStyle(focus) {
    return `object-position: ${focus.x}% ${focus.y}%; transform: scale(${focus.zoom}); transform-origin: ${focus.x}% ${focus.y}%;`;
}

/**
 * Opens the picker for one character.
 * @param {Object} options
 * @param {string} options.name - Character name (the key the focus is saved under)
 * @param {string} options.imageUrl - Full-size portrait URL
 * @param {number} options.aspect - Banner width / height, for the live preview
 * @param {HTMLElement} [options.returnFocusTo] - Element to focus again when the picker closes
 * @param {(focus: {x: number, y: number, zoom: number}) => void} options.onSave
 */
export function openPortraitFocusPicker({ name, imageUrl, aspect, returnFocusTo, onSave }) {
    document.getElementById('rpg-portrait-focus-modal')?.remove();

    let focus = getPortraitFocus(name);
    const t = (key, fallback) => i18n.getTranslation(key) || fallback;

    const overlay = document.createElement('div');
    overlay.id = 'rpg-portrait-focus-modal';
    overlay.className = 'rpg-focus-modal';
    overlay.setAttribute('data-theme', extensionSettings.theme || 'default');

    const dialog = document.createElement('div');
    dialog.className = 'rpg-focus-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'rpg-focus-title');

    const title = document.createElement('h3');
    title.id = 'rpg-focus-title';
    title.className = 'rpg-focus-title';
    title.textContent = `${t('portraitFocus.title', 'Portrait focus')}: ${name}`;

    const hint = document.createElement('p');
    hint.className = 'rpg-focus-hint';
    hint.textContent = t('portraitFocus.hint', 'Click or drag on the image to choose what the card centres on. Arrow keys nudge it.');

    // Full image with a draggable focus marker
    const stage = document.createElement('div');
    stage.className = 'rpg-focus-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'slider');
    stage.setAttribute('aria-label', t('portraitFocus.point', 'Focus point'));

    const stageImg = document.createElement('img');
    stageImg.src = imageUrl;
    stageImg.alt = name;
    stageImg.draggable = false;

    const marker = document.createElement('div');
    marker.className = 'rpg-focus-marker';
    marker.setAttribute('aria-hidden', 'true');

    stage.append(stageImg, marker);

    // Live preview shaped like the card's banner
    const previewLabel = document.createElement('span');
    previewLabel.className = 'rpg-focus-label';
    previewLabel.textContent = t('portraitFocus.preview', 'Card preview');

    const preview = document.createElement('div');
    preview.className = 'rpg-focus-preview';
    preview.style.aspectRatio = String(aspect > 0 ? aspect : 1.6);

    const previewImg = document.createElement('img');
    previewImg.src = imageUrl;
    previewImg.alt = '';
    preview.append(previewImg);

    // Zoom
    const zoomId = 'rpg-focus-zoom';
    const zoomLabel = document.createElement('label');
    zoomLabel.className = 'rpg-focus-label';
    zoomLabel.htmlFor = zoomId;
    zoomLabel.textContent = t('portraitFocus.zoom', 'Zoom');

    const zoom = document.createElement('input');
    zoom.type = 'range';
    zoom.id = zoomId;
    zoom.className = 'rpg-focus-zoom';
    zoom.min = String(MIN_ZOOM);
    zoom.max = String(MAX_ZOOM);
    zoom.step = '0.05';

    const side = document.createElement('div');
    side.className = 'rpg-focus-side';
    side.append(previewLabel, preview, zoomLabel, zoom);

    const body = document.createElement('div');
    body.className = 'rpg-focus-body';
    body.append(stage, side);

    // Buttons
    const makeButton = (text, className) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = text;
        return button;
    };
    const resetBtn = makeButton(t('portraitFocus.reset', 'Reset'), 'rpg-focus-btn');
    const cancelBtn = makeButton(t('portraitFocus.cancel', 'Cancel'), 'rpg-focus-btn');
    const saveBtn = makeButton(t('portraitFocus.save', 'Save'), 'rpg-focus-btn rpg-focus-btn-primary');

    const footer = document.createElement('div');
    footer.className = 'rpg-focus-footer';
    footer.append(resetBtn, cancelBtn, saveBtn);

    dialog.append(title, hint, body, footer);
    overlay.append(dialog);
    document.body.append(overlay);

    const render = () => {
        marker.style.left = `${focus.x}%`;
        marker.style.top = `${focus.y}%`;
        previewImg.setAttribute('style', portraitFocusStyle(focus));
        zoom.value = String(focus.zoom);
        stage.setAttribute('aria-valuetext', `${Math.round(focus.x)}% across, ${Math.round(focus.y)}% down`);
    };

    const setFromPointer = (event) => {
        const rect = stageImg.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        focus.x = Math.round(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100));
        focus.y = Math.round(clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100));
        render();
    };

    let dragging = false;
    stage.addEventListener('pointerdown', (event) => {
        dragging = true;
        stage.setPointerCapture(event.pointerId);
        setFromPointer(event);
    });
    stage.addEventListener('pointermove', (event) => {
        if (dragging) setFromPointer(event);
    });
    stage.addEventListener('pointerup', () => { dragging = false; });
    stage.addEventListener('pointercancel', () => { dragging = false; });

    stage.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 10 : 2;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        focus.x = clamp(focus.x + move[0], 0, 100);
        focus.y = clamp(focus.y + move[1], 0, 100);
        render();
    });

    zoom.addEventListener('input', () => {
        focus.zoom = clamp(Number(zoom.value) || 1, MIN_ZOOM, MAX_ZOOM);
        render();
    });

    const close = () => {
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
        returnFocusTo?.focus();
    };

    const onKeydown = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    };
    document.addEventListener('keydown', onKeydown, true);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    resetBtn.addEventListener('click', () => {
        focus = { ...DEFAULT_FOCUS };
        render();
    });
    cancelBtn.addEventListener('click', close);
    saveBtn.addEventListener('click', () => {
        if (!extensionSettings.portraitFocus) {
            extensionSettings.portraitFocus = {};
        }
        extensionSettings.portraitFocus[name] = { ...focus };
        saveSettings();
        onSave?.({ ...focus });
        close();
    });

    render();
    stage.focus();
}
