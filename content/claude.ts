// WebAI Memory - Claude adapter

/* global OAM */

OAM.initPlatform({
  platform: 'claude',
  conversationSelectors: [
    '.ReactVirtualized__Grid',
    'div[data-scrollable="true"]',
    'main',
  ],
  userMessageSelectors: [
    '.font-user-message',
    '[data-is-user="true"]',
  ],
  assistantMessageSelectors: [
    '.font-claude-message',
    '[data-is-user="false"]',
  ],
  inputSelectors: [
    'div[contenteditable="true"]',
    '.ProseMirror',
  ],
  sendButtonSelectors: [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send"]',
    'form button',
  ],
});
