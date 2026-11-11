/**
 * Prompts Editor Module
 * Provides UI for customizing all AI prompts used in the extension
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { DEFAULT_HTML_PROMPT, DEFAULT_DIALOGUE_COLORING_PROMPT, DEFAULT_DECEPTION_PROMPT, DEFAULT_OMNISCIENCE_FILTER_PROMPT, DEFAULT_CYOA_PROMPT, DEFAULT_SPOTIFY_PROMPT, DEFAULT_NARRATOR_PROMPT, DEFAULT_CONTEXT_INSTRUCTIONS_PROMPT, DEFAULT_TRACKER_INSTRUCTIONS_PROMPT, DEFAULT_TRACKER_CONTINUATION_PROMPT, DEFAULT_AVATAR_CUSTOM_INSTRUCTION } from '../generation/promptBuilder.js';
import { DEFAULT_PLOT_RANDOM_PROMPT, DEFAULT_PLOT_NATURAL_PROMPT } from '../features/plotProgression.js';
import { DEFAULT_COMBAT_NARRATIVE_PROMPT } from '../generation/encounterPrompts.js';
import { DEFAULT_CAST_PROMPTS, CAST_PROMPT_SETTINGS } from '../features/castPrompts.js';
import { refreshCastPrompt } from '../features/cast.js';
import { i18n } from '../../core/i18n.js';

let $editorModal = null;

// The default of every prompt, each from the module that sends it, so the editor shows what is really sent
const DEFAULT_PROMPTS = {
    html: DEFAULT_HTML_PROMPT,
    dialogueColoring: DEFAULT_DIALOGUE_COLORING_PROMPT,
    deception: DEFAULT_DECEPTION_PROMPT,
    omniscience: DEFAULT_OMNISCIENCE_FILTER_PROMPT,
    cyoa: DEFAULT_CYOA_PROMPT,
    spotify: DEFAULT_SPOTIFY_PROMPT,
    narrator: DEFAULT_NARRATOR_PROMPT,
    contextInstructions: DEFAULT_CONTEXT_INSTRUCTIONS_PROMPT,
    plotRandom: DEFAULT_PLOT_RANDOM_PROMPT,
    plotNatural: DEFAULT_PLOT_NATURAL_PROMPT,
    avatar: DEFAULT_AVATAR_CUSTOM_INSTRUCTION,
    trackerInstructions: DEFAULT_TRACKER_INSTRUCTIONS_PROMPT,
    trackerContinuation: DEFAULT_TRACKER_CONTINUATION_PROMPT,
    combatNarrative: DEFAULT_COMBAT_NARRATIVE_PROMPT,
};

// Cast's prompts (instructions only: their reply formats stay fixed in cast.js)
Object.assign(DEFAULT_PROMPTS, DEFAULT_CAST_PROMPTS);

// Where each prompt's custom text is kept ('' = the default). Its textarea is #rpg-prompt-<key in kebab-case>.
const PROMPT_SETTINGS = {
    html: 'customHtmlPrompt',
    dialogueColoring: 'customDialogueColoringPrompt',
    deception: 'customDeceptionPrompt',
    omniscience: 'customOmnisciencePrompt',
    cyoa: 'customCYOAPrompt',
    spotify: 'customSpotifyPrompt',
    narrator: 'customNarratorPrompt',
    contextInstructions: 'customContextInstructionsPrompt',
    plotRandom: 'customPlotRandomPrompt',
    plotNatural: 'customPlotNaturalPrompt',
    avatar: 'avatarLLMCustomInstruction',
    trackerInstructions: 'customTrackerInstructionsPrompt',
    trackerContinuation: 'customTrackerContinuationPrompt',
    combatNarrative: 'customCombatNarrativePrompt',
    ...CAST_PROMPT_SETTINGS,
};

const textarea = (key) => $(`#rpg-prompt-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
const isDefault = (key, text) => String(text ?? '').trim() === DEFAULT_PROMPTS[key].trim();
const notify = (key, fallback) => toastr.success(i18n.getTranslation(`template.promptsEditor.messages.${key}`) || fallback);

let promptsEditorHandlersBound = false;

/**
 * Initialize the prompts editor modal
 */
export function initPromptsEditor() {
    $editorModal = $('#rpg-prompts-editor-popup');

    if (!$editorModal.length) {
        console.error('[RPG Companion] Prompts editor modal not found in template');
        return;
    }

    // Every handler below is on the document, so it keeps working for the menu that turning the extension
    // off and on again puts back; binding them again would make each button fire twice
    if (promptsEditorHandlersBound) return;
    promptsEditorHandlersBound = true;

    // A prompt stored as custom although it is the default text (Save used to store every box) goes back
    // to following the default
    for (const [key, setting] of Object.entries(PROMPT_SETTINGS)) {
        if (extensionSettings[setting] && isDefault(key, extensionSettings[setting])) {
            extensionSettings[setting] = '';
        }
    }

    // Save button
    $(document).on('click', '#rpg-prompts-save', function() {
        savePrompts();
        closePromptsEditor();
        notify('saved', 'Prompts saved.');
    });

    // Cancel button
    $(document).on('click', '#rpg-prompts-cancel', function() {
        closePromptsEditor();
    });

    // Close X button
    $(document).on('click', '#rpg-close-prompts-editor', function() {
        closePromptsEditor();
    });

    // Restore All button
    $(document).on('click', '#rpg-prompts-restore-all', function() {
        restoreAllToDefaults();
        notify('restoredAll', 'Every box shows its default. Press Save to keep them.');
    });

    // Individual restore buttons
    $(document).on('click', '.rpg-restore-prompt-btn', function() {
        const promptType = $(this).data('prompt');
        restorePromptToDefault(promptType);
        notify('restored', 'The box shows the default. Press Save to keep it.');
    });

    // Close on background click
    $(document).on('click', '#rpg-prompts-editor-popup', function(e) {
        if (e.target.id === 'rpg-prompts-editor-popup') {
            closePromptsEditor();
        }
    });

    // Open button
    $(document).on('click', '#rpg-open-prompts-editor', function() {
        openPromptsEditor();
    });
}

/**
 * Open the prompts editor modal: each box shows the custom text, or the default when there is none
 */
function openPromptsEditor() {
    for (const [key, setting] of Object.entries(PROMPT_SETTINGS)) {
        textarea(key).val(extensionSettings[setting] || DEFAULT_PROMPTS[key]);
    }

    // Set theme to match current extension theme
    const theme = extensionSettings.theme || 'default';
    $editorModal.attr('data-theme', theme);

    $editorModal.addClass('is-open').css('display', '');
}

/**
 * Close the prompts editor modal
 */
function closePromptsEditor() {
    $editorModal.removeClass('is-open').addClass('is-closing');
    setTimeout(() => {
        $editorModal.removeClass('is-closing').hide();
    }, 200);
}

/**
 * Save all prompts from the editor. A prompt left as its default (or emptied) is saved as empty, so it
 * keeps following the default when a later version improves it.
 */
function savePrompts() {
    for (const [key, setting] of Object.entries(PROMPT_SETTINGS)) {
        const value = String(textarea(key).val() ?? '').trim();
        extensionSettings[setting] = isDefault(key, value) ? '' : value;
    }

    saveSettings();
    refreshCastPrompt();
}

/**
 * Put a prompt's default text back in its box. Like any other edit, it is kept by Save and dropped by Cancel.
 * @param {string} promptType - Key of the prompt to restore (html, plotRandom, castUpdate, ...)
 */
function restorePromptToDefault(promptType) {
    if (!(promptType in PROMPT_SETTINGS)) return;
    textarea(promptType).val(DEFAULT_PROMPTS[promptType]);
}

/**
 * Put every prompt's default text back in its box (kept by Save, dropped by Cancel)
 */
function restoreAllToDefaults() {
    Object.keys(PROMPT_SETTINGS).forEach(restorePromptToDefault);
}

/**
 * Get default prompts (for export/other modules)
 */
export function getDefaultPrompts() {
    return { ...DEFAULT_PROMPTS };
}
