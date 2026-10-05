// WebAI Memory - Gemini adapter

/* global OAM */

OAM.initPlatform({
  platform: 'gemini',
  conversationSelectors: [
    '.conversation-container',
    'main',
    '[role="main"]',
  ],
  userMessageSelectors: [
    '.user-query',
    '[data-message-author-role="user"]',
    '.query-text',
  ],
  assistantMessageSelectors: [
    '.model-response-text',
    '.response-container-content',
    '[data-message-author-role="model"]',
    '.markdown-main-panel',
  ],
  inputSelectors: [
    '.ql-editor[contenteditable]',
    '[contenteditable="true"][aria-label*="message"]',
    '[contenteditable="true"]',
    'textarea',
  ],
  sendButtonSelectors: [
    'button[aria-label="Send message"]',
    '.send-button',
    'button[data-test-id="send-button"]',
    'button[aria-label*="Send"]',
  ],
});
