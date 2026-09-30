'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const globalWarning = document.getElementById('global-warning');
  const globalCount = document.getElementById('global-count');
  const form = document.getElementById('site-form');
  const domainInput = document.getElementById('domain-input');
  const modeInput = document.getElementById('mode-input');
  const siteWarning = document.getElementById('site-warning');
  const clearSiteWarning = document.getElementById('clear-site-warning');
  const formMessage = document.getElementById('form-message');
  const tableBody = document.getElementById('site-table-body');
  const emptyState = document.getElementById('empty-state');
  const ruleCount = document.getElementById('rule-count');
  const headerStatus = document.getElementById('header-status');
  const incognitoHint = document.getElementById('incognito-hint');

  let sites = [];
  let currentEnabled = true;

  function normalizeDomain(input) {
    try {
      let value = String(input || '').trim().toLowerCase();
      if (!value) return '';

      if (value.includes('://')) {
        value = new URL(value).hostname;
      } else {
        value = value.split('/')[0].split('?')[0].split('#')[0];
        if (value.includes(':')) value = new URL(`https://${value}`).hostname;
      }

      value = value.replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
      if (!value || value.length > 253 || !/^[a-z0-9.-]+$/.test(value)) return '';
      if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) return '';

      const labels = value.split('.');
      if (labels.some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
        return '';
      }

      return value;
    } catch (_error) {
      return '';
    }
  }

  function showMessage(message, type = 'info') {
    formMessage.textContent = message;
    formMessage.className = `form-message form-message-${type}`;
  }

  function updateGlobalCount() {
    globalCount.textContent = String(globalWarning.value.length);
  }

  function escapeText(value) {
    return String(value ?? '');
  }

  function renderSites() {
    tableBody.replaceChildren();
    emptyState.hidden = sites.length !== 0;
    ruleCount.textContent = `${sites.length} ACTIVE`;

    for (const site of sites) {
      const row = document.createElement('tr');
      const domainCell = document.createElement('td');
      const modeCell = document.createElement('td');
      const warningCell = document.createElement('td');
      const actionCell = document.createElement('td');

      domainCell.className = 'domain-cell';
      domainCell.textContent = escapeText(site.domain);

      const modeBadge = document.createElement('span');
      modeBadge.className = 'mode-badge';
      modeBadge.textContent = site.mode === 'snake' ? 'SNAKE GAME' : 'TEXT WARNING';
      modeCell.appendChild(modeBadge);

      warningCell.textContent = site.warningText.trim() ? 'SITE-SPECIFIC' : 'GLOBAL DEFAULT';

      const deactivate = document.createElement('button');
      deactivate.type = 'button';
      deactivate.className = 'danger-button';
      deactivate.textContent = 'DEACTIVATE';
      deactivate.dataset.domain = site.domain;
      deactivate.title = `Remove ${site.domain} from the block matrix`;
      actionCell.className = 'action-cell';
      actionCell.appendChild(deactivate);

      row.append(domainCell, modeCell, warningCell, actionCell);
      tableBody.appendChild(row);
    }
  }

  async function getState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
      if (!response?.ok) throw new Error(response?.error || 'Could not load state.');
      sites = Array.isArray(response.state.blockedSites) ? response.state.blockedSites : [];
      currentEnabled = response.state.extensionEnabled !== false;
      globalWarning.value = response.state.globalWarningText || '';
      updateGlobalCount();
      renderSites();
      headerStatus.textContent = currentEnabled ? 'ONLINE' : 'PAUSED';
      headerStatus.classList.toggle('large-status-off', !currentEnabled);
    } catch (error) {
      showMessage(`State error: ${error.message}`, 'error');
      console.error('[Matrix options] State load failed:', error);
    }
  }

  async function checkIncognitoAccess() {
    try {
      const allowed = await chrome.extension.isAllowedIncognitoAccess();
      incognitoHint.textContent = allowed
        ? 'INCOGNITO ACCESS: ENABLED'
        : 'INCOGNITO ACCESS: ENABLE “ALLOW IN INCOGNITO” IN EXTENSIONS';
      incognitoHint.classList.toggle('warning-text', !allowed);
    } catch (_error) {
      incognitoHint.textContent = 'INCOGNITO ACCESS: CHECK EXTENSION SETTINGS';
    }
  }

  async function saveState(nextSites) {
    const warning = globalWarning.value.trimEnd();
    const response = await chrome.runtime.sendMessage({
      action: 'SAVE_SETTINGS',
      globalWarningText: warning,
      blockedSites: nextSites
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Save failed.');
    }

    sites = response.state.blockedSites;
    currentEnabled = response.state.extensionEnabled !== false;
    renderSites();
  }

  globalWarning.addEventListener('input', updateGlobalCount);

  clearSiteWarning.addEventListener('click', () => {
    siteWarning.value = '';
    siteWarning.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('Synchronizing rule matrix…', 'info');

    const domain = normalizeDomain(domainInput.value);
    if (!domain) {
      showMessage('Enter a valid domain such as youtube.com.', 'error');
      domainInput.focus();
      return;
    }

    const mode = modeInput.value === 'snake' ? 'snake' : 'text';
    const warningText = siteWarning.value.trimEnd();
    const existingIndex = sites.findIndex((site) => site.domain === domain);
    const nextSite = { domain, mode, warningText };
    const nextSites = [...sites];

    if (existingIndex >= 0) {
      nextSites[existingIndex] = nextSite;
    } else {
      nextSites.push(nextSite);
    }

    nextSites.sort((a, b) => a.domain.localeCompare(b.domain));

    try {
      await saveState(nextSites);
      showMessage(
        existingIndex >= 0 ? `Updated ${domain}.` : `Added ${domain} to the block matrix.`,
        'success'
      );
      form.reset();
      modeInput.value = 'text';
    } catch (error) {
      showMessage(`Save failed: ${error.message}`, 'error');
      console.error('[Matrix options] Save failed:', error);
    }
  });

  tableBody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-domain]');
    if (!button) return;

    const domain = normalizeDomain(button.dataset.domain);
    const nextSites = sites.filter((site) => site.domain !== domain);

    button.disabled = true;
    showMessage(`Deactivating ${domain}…`, 'info');

    try {
      await saveState(nextSites);
      showMessage(`${domain} has been deactivated.`, 'success');
    } catch (error) {
      button.disabled = false;
      showMessage(`Deactivation failed: ${error.message}`, 'error');
      console.error('[Matrix options] Deactivation failed:', error);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.extensionEnabled) {
      currentEnabled = changes.extensionEnabled.newValue !== false;
      headerStatus.textContent = currentEnabled ? 'ONLINE' : 'PAUSED';
      headerStatus.classList.toggle('large-status-off', !currentEnabled);
    }
    if (changes.globalWarningText) {
      globalWarning.value = typeof changes.globalWarningText.newValue === 'string' ? changes.globalWarningText.newValue : '';
      updateGlobalCount();
    }
    if (changes.blockedSites) {
      sites = Array.isArray(changes.blockedSites.newValue) ? changes.blockedSites.newValue : [];
      renderSites();
    }
  });

  void getState();
  void checkIncognitoAccess();
});
