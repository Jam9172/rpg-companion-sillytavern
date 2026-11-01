/**
 * Avatar Utilities Module
 * Handles safe avatar/thumbnail URL generation with error handling
 */

import { getThumbnailUrl } from '../../../../../../script.js';

/**
 * Safely retrieves a thumbnail URL from SillyTavern's API with error handling.
 * Returns null instead of throwing errors to prevent extension crashes.
 *
 * @param {string} type - Type of thumbnail ('avatar' or 'persona')
 * @param {string} filename - Filename of the avatar/persona
 * @returns {string|null} Thumbnail URL or null if unavailable/error
 */
export function getSafeThumbnailUrl(type, filename) {
    // Return null if no filename provided
    if (!filename || filename === 'none') {
        // console.log(`[RPG Companion] No valid filename provided for ${type} thumbnail`);
        return null;
    }

    try {
        // Attempt to get thumbnail URL from SillyTavern API
        const url = getThumbnailUrl(type, filename);

        // Validate that we got a string back
        if (typeof url !== 'string' || url.trim() === '') {
            console.warn(`[RPG Companion] getThumbnailUrl returned invalid result for ${type}:`, filename);
            return null;
        }

        // console.log(`[RPG Companion] Successfully generated ${type} thumbnail URL for: ${filename}`);
        return url;
    } catch (error) {
        // Log detailed error information for debugging
        console.error(`[RPG Companion] Failed to get ${type} thumbnail for "${filename}":`, error);
        console.error('[RPG Companion] Error details:', {
            type,
            filename,
            errorMessage: error.message,
            errorStack: error.stack
        });
        return null;
    }
}

/**
 * Shrinks an uploaded image so its longest side is at most maxSize pixels, so large
 * photos don't bloat the settings file they are saved in. Smaller images are returned
 * unchanged. Falls back to the original data URL if the image can't be processed.
 *
 * @param {string} dataUrl - Image as a data: URL (from FileReader.readAsDataURL)
 * @param {number} [maxSize=768] - Longest side in pixels
 * @returns {Promise<string>} Data URL of the (possibly) resized image
 */
export function downscaleImageDataUrl(dataUrl, maxSize = 768) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const longest = Math.max(img.naturalWidth, img.naturalHeight);
            if (!longest || longest <= maxSize) {
                resolve(dataUrl);
                return;
            }
            try {
                const scale = maxSize / longest;
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                // WebP keeps transparency and is much smaller than PNG
                resolve(canvas.toDataURL('image/webp', 0.88));
            } catch (error) {
                console.warn('[RPG Companion] Could not resize uploaded avatar, keeping original:', error);
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}
