'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('master-toggle');
  const masterLabel = document.getElementById('master-label');
  const masterDescription = document.getElementById('master-description');
  const statusChip = document.getElementById('status-chip');
  const openOptions = document.getElementById('open-options');
  const incognitoStatus = document.getElementById('incognito-status');

  function render(enabled) {
    toggle.checked = enabled;
    masterLabel.textContent = enabled ? 'BLOCKING ENABLED' : 'BLOCKING DISABLED';
    masterDescription.textContent = enabled
      ? 'Network filters are active.'
      : 'All configured filters are currently offline.';
    statusChip.textContent = enabled ? 'ONLINE' : 'PAUSED';
    statusChip.classList.toggle('status-chip-off', !enabled);
  }

  async function loadState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
      if (!response?.ok) throw new Error(response?.error || 'State unavailable.');
      render(response.state.extensionEnabled !== false);

      try {
        const allowed = await chrome.extension.isAllowedIncognitoAccess();
        incognitoStatus.textContent = allowed ? 'INCOGNITO: READY' : 'INCOGNITO: ENABLE ACCESS';
        incognitoStatus.classList.toggle('warning-text', !allowed);
      } catch (_error) {
        incognitoStatus.textContent = 'INCOGNITO: USE EXTENSION SETTINGS';
      }
    } catch (error) {
      statusChip.textContent = 'ERROR';
      console.error('[Matrix popup] Load failed:', error);
    }
  }

  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'SET_ENABLED',
        enabled
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Unable to update state.');
      }

      render(response.extensionEnabled !== false);
    } catch (error) {
      console.error('[Matrix popup] Toggle failed:', error);
      toggle.checked = !enabled;
      render(toggle.checked);
    } finally {
      toggle.disabled = false;
    }
  });

  openOptions.addEventListener('click', () => {
    try {
      chrome.runtime.openOptionsPage();
    } catch (error) {
      console.error('[Matrix popup] Options open failed:', error);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.extensionEnabled) return;
    render(changes.extensionEnabled.newValue !== false);
  });

  void loadState();
});
