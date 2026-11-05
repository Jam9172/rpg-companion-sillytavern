/**
 * Theme Management Module
 * Handles theme application, custom colors, and animations
 */

import { extensionSettings, $panelContainer } from '../../core/state.js';
import { syncAlternatePresentCharactersTheme } from './alternatePresentCharacters.js';

// The colour and font variables Cast's parts outside the panel are drawn with (Meanwhile, Elsewhere)
const CAST_THEME_VARS = ['--rpg-bg', '--rpg-accent', '--rpg-text', '--rpg-highlight', '--rpg-border',
    '--forge-brass', '--forge-ember', '--forge-card', '--forge-muted', '--forge-heading', '--forge-body-font'];

/**
 * The current theme's colours and fonts for Cast's parts that sit outside the panel (the Meanwhile folds
 * in the chat and the Elsewhere button and panel), where the panel's theme variables do not reach. Read
 * from the panel, so the custom colours count too. Every variable is in the result; an empty value means
 * the stylesheet's own (Arcane Forge) default.
 * @returns {Object<string, string>}
 */
export function castThemeStyle() {
    const out = Object.fromEntries(CAST_THEME_VARS.map((name) => [name, '']));
    if (extensionSettings.theme === 'forge') {
        // The stylesheet's defaults are Arcane Forge's, and Arcane Forge UI's colour pickers set --forge-*
        // on the page itself, so those already reach here and follow the pickers live. Only the panel
        // colours need pointing at the pickers, as the panel does.
        Object.assign(out, {
            '--rpg-bg': 'var(--forge-ui-bg, #120908)',
            '--rpg-accent': 'var(--forge-ui-card, #1E100D)',
            '--rpg-text': 'var(--forge-ui-text, #F1E3D6)',
            '--rpg-highlight': 'var(--forge-ui-ember, #E8622C)',
            '--rpg-border': 'var(--forge-ui-border, #4A2219)',
        });
        return out;
    }
    const panel = document.getElementById('rpg-companion-panel');
    if (!panel) return out;
    const css = getComputedStyle(panel);
    const value = (name) => css.getPropertyValue(name).trim();
    for (const name of ['--rpg-bg', '--rpg-accent', '--rpg-text', '--rpg-highlight', '--rpg-border']) out[name] = value(name);
    // Other themes have one accent colour and the panel's own font
    const accent = out['--rpg-highlight'] || 'currentColor';
    out['--forge-brass'] = accent;
    out['--forge-ember'] = accent;
    out['--forge-card'] = out['--rpg-accent'];
    out['--forge-muted'] = `color-mix(in srgb, ${out['--rpg-text'] || 'currentColor'} 70%, transparent)`;
    out['--forge-heading'] = css.fontFamily;
    out['--forge-body-font'] = css.fontFamily;
    return out;
}

/** Puts castThemeStyle()'s variables on an element (an empty one is removed). */
export function applyCastTheme(element, style = castThemeStyle()) {
    if (!element) return;
    for (const [name, value] of Object.entries(style)) {
        if (value) element.style.setProperty(name, value);
        else element.style.removeProperty(name);
    }
}

/**
 * Converts hex color and opacity percentage to rgba string
 * @param {string} hex - Hex color (e.g., '#ff0000')
 * @param {number} opacity - Opacity percentage (0-100)
 * @returns {string} - RGBA color string
 */
export function hexToRgba(hex, opacity = 100) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = opacity / 100;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Gets stat bar colors with opacity applied
 * @returns {{low: string, high: string}} RGBA color strings for stat bars
 */
export function getStatBarColors() {
    return {
        low: hexToRgba(
            extensionSettings.statBarColorLow || '#cc3333',
            extensionSettings.statBarColorLowOpacity ?? 100
        ),
        high: hexToRgba(
            extensionSettings.statBarColorHigh || '#33cc66',
            extensionSettings.statBarColorHighOpacity ?? 100
        )
    };
}

/**
 * Loads the Arcane Forge theme's fonts (bundled in fonts/, so they work offline), once, only when
 * that theme is chosen.
 */
function loadForgeFonts() {
    if (document.getElementById('rpg-forge-fonts')) return;
    const link = document.createElement('link');
    link.id = 'rpg-forge-fonts';
    link.rel = 'stylesheet';
    link.href = new URL('../../../fonts/fonts.css', import.meta.url).href;
    document.head.appendChild(link);
}

/**
 * Applies the selected theme to the panel.
 */
export function applyTheme() {
    if (!$panelContainer) return;

    const theme = extensionSettings.theme;

    // Remove all theme attributes first
    $panelContainer.removeAttr('data-theme');

    // Clear any inline CSS variable overrides
    $panelContainer.css({
        '--rpg-bg': '',
        '--rpg-accent': '',
        '--rpg-text': '',
        '--rpg-highlight': '',
        '--rpg-border': '',
        '--rpg-shadow': ''
    });

    // Apply the selected theme
    if (theme === 'custom') {
        applyCustomTheme();
    } else if (theme !== 'default') {
        // For non-default themes, set the data-theme attribute
        // which will trigger the CSS theme rules
        $panelContainer.attr('data-theme', theme);
    }
    if (theme === 'forge') {
        loadForgeFonts();
    }
    // For 'default', we do nothing - it will use the CSS variables from .rpg-panel class
    // which fall back to SillyTavern's theme variables

    // Apply theme to mobile toggle and thought elements as well
    const $mobileToggle = $('#rpg-mobile-toggle');
    const $thoughtIcon = $('#rpg-thought-icon');
    const $thoughtPanel = $('#rpg-thought-panel');

    if ($mobileToggle.length) {
        if (theme === 'default') {
            $mobileToggle.removeAttr('data-theme');
        } else {
            $mobileToggle.attr('data-theme', theme);
        }
    }

    if ($thoughtIcon.length) {
        if (theme === 'default') {
            $thoughtIcon.removeAttr('data-theme');
        } else {
            $thoughtIcon.attr('data-theme', theme);
        }
    }

    if ($thoughtPanel.length) {
        if (theme === 'default') {
            $thoughtPanel.removeAttr('data-theme');
        } else {
            $thoughtPanel.attr('data-theme', theme);
        }
    }

    syncAlternatePresentCharactersTheme();
}

/**
 * Applies custom colors when custom theme is selected.
 */
export function applyCustomTheme() {
    if (!$panelContainer) return;

    const colors = extensionSettings.customColors;

    // Convert hex colors with opacity to rgba
    const bgColor = hexToRgba(colors.bg, colors.bgOpacity ?? 100);
    const accentColor = hexToRgba(colors.accent, colors.accentOpacity ?? 100);
    const textColor = hexToRgba(colors.text, colors.textOpacity ?? 100);
    const highlightColor = hexToRgba(colors.highlight, colors.highlightOpacity ?? 100);

    // Create shadow with 50% opacity of highlight color
    const shadowColor = hexToRgba(colors.highlight, (colors.highlightOpacity ?? 100) * 0.5);

    // Apply custom CSS variables as inline styles to main panel
    $panelContainer.css({
        '--rpg-bg': bgColor,
        '--rpg-accent': accentColor,
        '--rpg-text': textColor,
        '--rpg-highlight': highlightColor,
        '--rpg-border': highlightColor,
        '--rpg-shadow': shadowColor
    });

    // Apply custom colors to mobile toggle and thought elements
    const customStyles = {
        '--rpg-bg': bgColor,
        '--rpg-accent': accentColor,
        '--rpg-text': textColor,
        '--rpg-highlight': highlightColor,
        '--rpg-border': highlightColor,
        '--rpg-shadow': shadowColor
    };

    const $mobileToggle = $('#rpg-mobile-toggle');
    const $thoughtIcon = $('#rpg-thought-icon');
    const $thoughtPanel = $('#rpg-thought-panel');

    if ($mobileToggle.length) {
        $mobileToggle.attr('data-theme', 'custom').css(customStyles);
    }

    if ($thoughtIcon.length) {
        $thoughtIcon.attr('data-theme', 'custom').css(customStyles);
    }

    if ($thoughtPanel.length) {
        $thoughtPanel.attr('data-theme', 'custom').css(customStyles);
    }

    syncAlternatePresentCharactersTheme();
}

/**
 * Toggles visibility of custom color pickers.
 */
export function toggleCustomColors() {
    const isCustom = extensionSettings.theme === 'custom';
    $('#rpg-custom-colors').toggle(isCustom);
}

/**
 * Toggles animations on/off by adding/removing a class to the panel.
 */
export function toggleAnimations() {
    if (extensionSettings.enableAnimations) {
        $panelContainer.addClass('rpg-animations-enabled');
    } else {
        $panelContainer.removeClass('rpg-animations-enabled');
    }
}

/**
 * Updates visibility of feature toggles in main panel based on settings
 */
export function updateFeatureTogglesVisibility() {
    const $featuresRow = $('#rpg-features-row');
    const $htmlToggle = $('#rpg-html-toggle-wrapper');
    const $dialogueColoringToggle = $('#rpg-dialogue-coloring-toggle-wrapper');
    const $deceptionToggle = $('#rpg-deception-toggle-wrapper');
    const $omniscienceToggle = $('#rpg-omniscience-toggle-wrapper');
    const $cyoaToggle = $('#rpg-cyoa-toggle-wrapper');
    const $spotifyToggle = $('#rpg-spotify-toggle-wrapper');

    const $dynamicWeatherToggle = $('#rpg-dynamic-weather-toggle-wrapper');
    const $narratorToggle = $('#rpg-narrator-toggle-wrapper');
    const $autoAvatarsToggle = $('#rpg-auto-avatars-toggle-wrapper');

    // Show/hide individual toggles
    $htmlToggle.toggle(extensionSettings.showHtmlToggle);
    $dialogueColoringToggle.toggle(extensionSettings.showDialogueColoringToggle);
    $deceptionToggle.toggle(extensionSettings.showDeceptionToggle ?? true);
    $omniscienceToggle.toggle(extensionSettings.showOmniscienceToggle ?? true);
    $cyoaToggle.toggle(extensionSettings.showCYOAToggle ?? true);
    $spotifyToggle.toggle(extensionSettings.showSpotifyToggle);

    $dynamicWeatherToggle.toggle(extensionSettings.showDynamicWeatherToggle);
    $narratorToggle.toggle(extensionSettings.showNarratorMode);
    $autoAvatarsToggle.toggle(extensionSettings.showAutoAvatars);

    // Hide entire row if all toggles are hidden
    const anyVisible = extensionSettings.showHtmlToggle ||
                      extensionSettings.showDialogueColoringToggle ||
                      (extensionSettings.showDeceptionToggle ?? true) ||
                      (extensionSettings.showOmniscienceToggle ?? true) ||
                      (extensionSettings.showCYOAToggle ?? true) ||
                      extensionSettings.showSpotifyToggle ||
                      extensionSettings.showDynamicWeatherToggle ||
                      extensionSettings.showNarratorMode ||
                      extensionSettings.showAutoAvatars;
    $featuresRow.toggle(anyVisible);
}

/**
 * Updates the settings popup theme in real-time.
 * Backwards compatible wrapper for SettingsModal class.
 * @param {Object} settingsModal - The SettingsModal instance (passed as parameter to avoid circular dependency)
 */
export function updateSettingsPopupTheme(settingsModal) {
    if (settingsModal) {
        settingsModal.updateTheme();
    }
}

/**
 * Applies custom theme colors to the settings popup.
 * Backwards compatible wrapper for SettingsModal class.
 * @deprecated Use settingsModal.updateTheme() instead
 * @param {Object} settingsModal - The SettingsModal instance (passed as parameter to avoid circular dependency)
 */
export function applyCustomThemeToSettingsPopup(settingsModal) {
    if (settingsModal) {
        settingsModal._applyCustomTheme();
    }
}
