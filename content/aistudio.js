"use strict";
// WebAI Memory - Google AI Studio adapter
/* global OAM */
OAM.initPlatform({
    platform: 'aistudio',
    conversationSelectors: [
        'ms-chat-prompt',
        'ms-prompt-editor',
        '.chat-container',
        'mat-sidenav-content',
        'main',
        '[role="main"]',
        'body',
    ],
    userMessageSelectors: [
        'ms-chat-turn:has([data-turn-role="User"])',
        '[data-turn-role="User"] .turn-content',
        '[data-turn-role="User"]',
        '.user-turn',
        '.chat-turn-user',
    ],
    assistantMessageSelectors: [
        'ms-chat-turn:has([data-turn-role="Model"])',
        '[data-turn-role="Model"] .turn-content',
        '[data-turn-role="Model"]',
        '.model-turn',
        '.chat-turn-model',
    ],
    inputSelectors: [
        'ms-chunk-input textarea',
        'textarea[aria-label*="prompt" i]',
        'textarea[aria-label*="Type something" i]',
        'textarea[placeholder*="prompt" i]',
        '.prompt-box-container textarea',
        'textarea',
    ],
    sendButtonSelectors: [
        'button.run-button[aria-label*="Run" i]',
        'button[aria-label="Run prompt"]',
        'button[aria-label="Run"]',
        'button.run-button',
        'button[aria-label*="Run" i]',
    ],
});
