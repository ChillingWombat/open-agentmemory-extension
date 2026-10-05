// WebAI Memory - ChatGPT adapter

/* global OAM */

OAM.initPlatform({
  platform: 'chatgpt',
  conversationSelectors: [
    'main',
    '[role="presentation"]',
    '.react-scroll-to-bottom--css',
  ],
  userMessageSelectors: [
    '[data-message-author-role="user"]',
    '[class*="user-message"]',
  ],
  assistantMessageSelectors: [
    '[data-message-author-role="assistant"]',
    '[class*="assistant-message"]',
  ],
  inputSelectors: [
    '#prompt-textarea',
    '[contenteditable="true"][id="prompt-textarea"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  sendButtonSelectors: [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send"]',
    'form button:last-of-type',
  ],
});
