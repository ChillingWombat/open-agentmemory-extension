"use strict";
// WebAI Memory - Grok adapter
/* global OAM */
OAM.initPlatform({
    platform: 'grok',
    conversationSelectors: [
        'main',
        '.grok-chat',
        '[data-testid="conversation"]',
        'body',
    ],
    userMessageSelectors: [
        '.user-message',
        '[data-testid="user-message"]',
        '.message.user',
    ],
    assistantMessageSelectors: [
        '.grok-message',
        '[data-testid="grok-message"]',
        '.message.assistant',
    ],
    inputSelectors: [
        'textarea[placeholder*="Ask Grok"]',
        'textarea',
        '[contenteditable="true"]',
    ],
    sendButtonSelectors: [
        'button[aria-label="Grok"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
    ],
});
