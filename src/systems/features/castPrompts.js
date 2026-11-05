/**
 * Cast's prompts that can be changed in RPG Companion's Prompts editor. Only the instructions are here: what
 * each request asks the model to reply with (the JSON format and its example) stays in cast.js, so an edited
 * prompt cannot break the replies Cast reads. {userName} is replaced with the user's name.
 */
import { extensionSettings } from '../../core/state.js';

export const DEFAULT_CAST_PROMPTS = {
    // The background model, after each reply: who is tracked, and how away characters live off-screen
    castUpdate: `<ledger_rules>
Each character's memory is written by the character about themself, in FIRST PERSON ("I", "me", "my"), in their own voice:
- What happened: a short timeline of what they finished doing or went through, for continuity. Past tense, ONE short sentence per entry: what happened and how it ended. Never the small details.
- Doing now: what they are doing at this moment. Present tense, one short sentence. Kept only while they are away.
Nothing else is tracked: looks, personality and relationships come from the cards and the story.

HERE: in the same scene as {userName} at the end of the NEW messages. The story already shows what they do, so you write nothing about them.
AWAY: anywhere else. You write their off-screen life.
Being talked about, remembered or thought of does not make anyone here.

Major characters only: named people who matter to the story (they deal with {userName} in a meaningful way, keep coming back, or move the plot). The names in front of the messages only say who wrote them: a narrator, game master or storyteller is never tracked, and the card's own character only counts when they appear in the story as a person. Never {userName}, never passing extras (waiters, guards, crowds), never anyone under "forgotten". Use the exact ledger name for a known character, even when the story uses a nickname or title.
</ledger_rules>

<off_screen_lives>
Away characters are the leads of their own stories, not extras waiting in the wings for {userName}.
- They always have a Doing now, from the moment they leave until they are back with {userName}.
- Proactive: each activity pushes their own goals forward. They make and carry out plans, take risks, seek people out, make deals, pick fights, follow leads, and deal with the consequences of what they did before. When they get what they wanted, or it falls through, they go after something new.
- Never idle: no "waiting for {userName}", "thinking about {userName}", "resting", "passing time" or "going about my day". Thinking about {userName} only counts when it drives an action.
- Their world has other people in it (a rival, a boss, a lover, a creditor, other ledger characters). Keep them inside the activity.
- Move them in proportion to the story time that passes in the NEW messages: a few minutes, usually nothing new; hours or more, close the activity and start the next.
- Build on their memory and on who they are in the cards. Big moves are fine when they follow from who they are (a new job, a betrayal, a debt paid off). Off limits: deaths, meeting {userName}, arriving in {userName}'s scene.
</off_screen_lives>`,
    // The background model, when memories are summed up and story beats become a chapter
    castFold: `Do only the jobs listed in the request:
- Character summary: retell the listed memories of one character (the first may already be a summary) as a short timeline in that character's own voice, in FIRST PERSON ("I", "me", "my"), past tense: one or two short sentences, about 40 words at most, in order ("I ..., then I ..."). Keep only what matters for continuity: who, where, how each thing ended, and any debt or promise still open. Drop the small details. "keywords": three to eight names of the people, places and things in those memories (never the character's own name); a later mention of one brings the full memories back.
- Chapter: retell the listed story beats (or earlier chapters) as one chapter of the story: four to six sentences, past tense, third person, keeping who, where and what changed.
Use only what is listed. Add nothing.`,
    // The background model, when Tidy is pressed
    castTidy: `Rewrite each character's memory so it is shorter, cleaner and correct:
- "what_happened": a short timeline of their finished experiences, oldest first, for continuity only. Merge entries that belong together and drop repeats, filler and small details; keep who, where, how each thing ended, and any debt or promise still open. At most 4 entries: the oldest become one summary of one or two short sentences, and every other entry is ONE short sentence of 20 words at most, past tense. Merging means shortening: never just join two entries with "and".
- "doing_now" (only for characters whose status is "away"): one short sentence, present tense, of what they are doing at this moment. Drop steps that are already over or replaced by later ones; a finished step that matters belongs at the end of "what_happened".
- Fix mistakes: entries that contradict each other or the story and the cards (the story wins), wrong or misspelled names, entries in third person or the wrong tense, entries that belong to a different character, and things the character could not know.
- Never invent events or details, and never change what happened. Use only what is already in the memory, the story and the cards.
- Keep each character's own voice.
- Entries starting with "★" are key memories: keep each one as its own entry, still starting with "★", and change it only to fix a mistake.
- "fixes": one short line for each mistake you corrected, naming the character ("Kael: the debt was fifty silver, not forty"). Merging and shortening need no line. Empty if nothing was wrong.
Work quickly: this is cleanup, not a puzzle. Make the obvious merges and corrections and move on.`,
    // The main model: what the cast notes are and how to use them
    castNotes: `Lasting memory of this story's characters, each in their own words (first person), for consistency. Use it quietly: never quote or list these notes in the reply. Lines marked (off-screen) happened where {userName} could not see: characters may bring them up, but {userName} does not know them yet.`,
    // The main model: how to treat characters who are away (sent only when there are some)
    castAway: `Characters who are away have their own lives and concerns. Bring one into the story only when it fits naturally (word of them reaches {userName}, a chance meeting, a consequence of what they are doing), never just to involve them. Do not have them come looking for {userName} or step in on {userName}'s behalf without a reason of their own, and do not make them fixated on {userName}.`,
    // The main model: what the story so far is and how to use it
    castStory: `What has happened in this story so far, for continuity. Use it quietly: never quote, list or recap it in the reply.`,
};

// Where each prompt's custom text is kept in the settings ('' = the default above)
export const CAST_PROMPT_SETTINGS = {
    castUpdate: 'customCastUpdatePrompt',
    castFold: 'customCastFoldPrompt',
    castTidy: 'customCastTidyPrompt',
    castNotes: 'customCastNotesPrompt',
    castAway: 'customCastAwayPrompt',
    castStory: 'customCastStoryPrompt',
};

/**
 * One of Cast's prompts as it is sent: the custom text from the Prompts editor, or the default.
 * @param {keyof DEFAULT_CAST_PROMPTS} key
 * @param {string} [userName]
 */
export function castPrompt(key, userName = 'User') {
    const custom = String(extensionSettings[CAST_PROMPT_SETTINGS[key]] || '').trim();
    return (custom || DEFAULT_CAST_PROMPTS[key]).replace(/{userName}/g, userName);
}
