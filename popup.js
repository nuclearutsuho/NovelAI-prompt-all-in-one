import TagEditor from './lib/TagEditor.js';
import common from './lib/common.js';
import Autocomplete from './lib/Autocomplete.js';

let editor;
let autocomplete;
let currentMode = 'positive'; // 'positive' | 'negative'
let rawPositive = '';
let rawNegative = '';
let positiveTags = [];
let negativeTags = [];

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initCommunication();
});

function initUI() {
  // Autocomplete
  autocomplete = new Autocomplete();
  autocomplete.load();

  // Tabs
  const tabPositive = document.getElementById('tab-positive');
  const tabNegative = document.getElementById('tab-negative');

  tabPositive.addEventListener('click', () => switchTab('positive'));
  tabNegative.addEventListener('click', () => switchTab('negative'));

  // Editor
  const container = document.getElementById('editor-container');
  editor = new TagEditor(container, {
    onChange: (tags) => {
      updateTagsFromEditor(tags);
      syncToPage();
    }
  });

  // Bind Autocomplete to Editor (for inline edit)
  editor.bindAutocomplete(autocomplete);

  // Input Area
  const input = document.getElementById('quick-input');
  const btnAdd = document.getElementById('btn-add');

  // Attach Autocomplete to Input
  autocomplete.attach(input, (val) => {
    // When autocomplete selects, add tag
    const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
    newTags.forEach(t => editor.addTag(t));
    input.value = '';
    input.focus();
  });

  const addTag = () => {
    const val = input.value.trim();
    if (val) {
      // Split by comma if user pasted multiple
      const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
      newTags.forEach(t => editor.addTag(t));
      input.value = '';
      // scroll to bottom
      container.scrollTop = container.scrollHeight;
    }
  };

  btnAdd.addEventListener('click', addTag);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // If autocomplete is visible, let it handle Enter?
      // Autocomplete handles Enter in its own keydown.
      // But if no selection, we add tag.
      // We need to know if autocomplete handled it.
      // Autocomplete.js swallows Event?
      // Autocomplete.js: input.addEventListener('keydown'...
      // If we add listener here, order matters.
      // But Autocomplete logic: if dropdown visible and selected -> preventDefault.
      // If not visible or no selection -> let it bubble?
      // Autocomplete: if (e.key === 'Enter') { ... e.preventDefault(); ... }

      // So if generic Enter reaches here, it means autocomplete didn't take it.
      // Wait, we need a small delay or check?
      // Let's assume correct behavior.
      setTimeout(() => {
        if (input.value.trim()) addTag();
      }, 50);
    }
  });

  // Start Sync Page
  document.getElementById('openSyncPageBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'sync.html' });
  });

  // Language Toggle
  const langBtns = {
    'btn-en': 'en',
    'btn-jp': 'jp',
    'btn-zh': 'zh'
  };
  Object.keys(langBtns).forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      // Simple hack: reload popup or just ignore for now? 
      // Ideally we should apply translations. 
      // Let's at least save the preference if we had one.
      // For now, let's just implement basic text replacement if possible, or just acknowledge the click.
      console.log('Language switch not fully re-implemented yet');
    });
  });

  // Settings Persistence
  const settings = [
    'preservePrompt',
    'alternativeDanbooruAutocomplete',
    'triggerSpace',
    'triggerTab'
  ];

  // Load Settings
  chrome.storage.local.get(settings, (data) => {
    settings.forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        el.checked = !!data[key];
        el.addEventListener('change', () => {
          chrome.storage.local.set({ [key]: el.checked });
        });
      }
    });
  });

  // Settings Modal
  const btnSettings = document.getElementById('btn-settings');
  const modal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');

  btnSettings.addEventListener('click', () => { modal.style.display = 'flex'; });
  closeSettings.addEventListener('click', () => { modal.style.display = 'none'; });

  // Sync UI is handled automatically, but button provides feedback
  const btnSync = document.getElementById('btn-sync');
  btnSync.addEventListener('click', () => {
    requestPrompt(); // Re-fetch from page
    syncToPage();    // Force push current? No, usually "Sync" button in header means "Refresh from page" or "Push to page"?
    // In this context, let's make it "Refresh from Page" because "Push" happens on edit.
    // Or maybe "Push to Page" is safer?
    // Let's make it bidirectional: Pull if empty, Push if changed? 
    // Safer: Pull from page (Refresh). Explicit action.

    requestPrompt();

    // Visual animation
    btnSync.classList.add('rotating');
    setTimeout(() => btnSync.classList.remove('rotating'), 500);
  });
}

function switchTab(mode) {
  currentMode = mode;

  document.getElementById('tab-positive').classList.toggle('active', mode === 'positive');
  document.getElementById('tab-negative').classList.toggle('active', mode === 'negative');

  if (mode === 'positive') {
    editor.setTags(positiveTags);
  } else {
    editor.setTags(negativeTags);
  }
}

function updateTagsFromEditor(updatedTags) {
  if (currentMode === 'positive') {
    positiveTags = updatedTags;
  } else {
    negativeTags = updatedTags;
  }
}

function tagsToString(tags) {
  return tags.map(t => {
    // We include disabled tags but they are handled by logic?
    // No, usually we don't include disabled tags in the prompt sent to NAI.
    if (t.disabled) return '';
    return t.value;
  }).filter(Boolean).join(', ');
}

function parsePromptToTags(promptText) {
  if (!promptText) return [];
  // Use common.splitTags logic
  const parts = common.splitTags(promptText);
  return parts.map(p => ({ value: p.trim(), disabled: false }));
}

// Track last sent prompt to avoid echo loops destroying focus
let lastSentPositive = null;
let lastSentNegative = null;

/* Communication */
function initCommunication() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'RETURN_PROMPT') {
      const { positive, negative } = msg.data;

      // Skip echo: if this matches what we just sent, ignore
      if (positive === lastSentPositive && negative === lastSentNegative) {
        return;
      }

      // Skip if identical to current popup state
      const currentPosStr = tagsToString(positiveTags);
      const currentNegStr = tagsToString(negativeTags);
      if (positive === currentPosStr && negative === currentNegStr) {
        rawPositive = positive;
        rawNegative = negative;
        return;
      }

      // Apply external change
      rawPositive = positive || '';
      rawNegative = negative || '';
      positiveTags = parsePromptToTags(rawPositive);
      negativeTags = parsePromptToTags(rawNegative);

      hasReceivedInitialData = true;

      editor.setTags(currentMode === 'positive' ? positiveTags : negativeTags);

      lastSentPositive = rawPositive;
      lastSentNegative = rawNegative;

      // Update visual status
      const statusEl = document.getElementById('sync-status');
      if (statusEl) {
        statusEl.textContent = 'Linked';
        statusEl.style.color = '#4caf50';
      }
    }
  });

  // Initial Request — retry a few times to handle timing issues
  // (injector.js might not have registered its listeners yet)
  requestPromptWithRetry(5, 800);
}

let hasReceivedInitialData = false;

function requestPromptWithRetry(retries, delayMs) {
  requestPrompt();
  if (retries > 0) {
    setTimeout(() => {
      if (!hasReceivedInitialData) {
        requestPromptWithRetry(retries - 1, delayMs);
      }
    }, delayMs);
  }
}

function requestPrompt() {
  console.log('[Popup] Sending GET_PROMPT to active tab');

  // Method 1: Target active tab (Standard Popup)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      console.log('[Popup] Target tab ID:', tabs[0].id);
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PROMPT' });
    } else {
      console.warn('[Popup] No active tab found');
    }
  });

  // Method 2: Broadcast to Runtime (Manager Panel / Iframe / DevTools)
  // If Popup is in an iframe, tabs.query might fail or return the wrong thing.
  // Bridge.js listens to runtime.onMessage too.
  chrome.runtime.sendMessage({ type: 'GET_PROMPT' }, (response) => {
    if (chrome.runtime.lastError) {
      // Ignore "Could not establish connection" if no background listener
      // console.log('Runtime broadcast error (expected if no BG listener):', chrome.runtime.lastError);
    }
  });
}

function syncToPage() {
  const posStr = tagsToString(positiveTags);
  const negStr = tagsToString(negativeTags);

  // Update local echo logic
  lastSentPositive = posStr;
  lastSentNegative = negStr;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'SET_PROMPT',
        data: {
          positive: posStr,
          negative: negStr
        }
      });
    }
  });
}
