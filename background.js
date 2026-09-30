'use strict';

const DEFAULT_STATE = Object.freeze({
  extensionEnabled: true,
  globalWarningText:
    'ACCESS DENIED\n\nThis destination is inside your focus perimeter.\nReturn to the task that matters.',
  blockedSites: [],
  temporaryBypasses: {}
});

const RULE_PRIORITY = 1000;
const RULE_ID_START = 1000;
const BYPASS_MS = 4000;
const BYPASS_ALARM_PREFIX = 'matrix-rearm:';
const PENDING_NAVIGATION_MAX_AGE_MS = 15000;

let stateCache = cloneState(DEFAULT_STATE);
let stateReadyPromise = null;
let syncQueue = Promise.resolve();

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

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

    if (!value || value.length > 253) return '';
    if (!/^[a-z0-9.-]+$/.test(value)) return '';
    if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) return '';

    const labels = value.split('.');
    if (
      labels.some(
        (label) =>
          !label ||
          label.length > 63 ||
          label.startsWith('-') ||
          label.endsWith('-')
      )
    ) {
      return '';
    }

    return value;
  } catch (_error) {
    return '';
  }
}

function sanitizeMode(mode) {
  return mode === 'snake' ? 'snake' : 'text';
}

function sanitizeSites(sites) {
  const seen = new Set();
  const result = [];

  if (!Array.isArray(sites)) return result;

  for (const raw of sites) {
    const domain = normalizeDomain(raw?.domain);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);

    result.push({
      domain,
      mode: sanitizeMode(raw?.mode),
      warningText:
        typeof raw?.warningText === 'string' ? raw.warningText.slice(0, 4000) : ''
    });
  }

  return result.sort((a, b) => a.domain.localeCompare(b.domain));
}

function sanitizeBypasses(value) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {};
  const now = Date.now();

  for (const [domainRaw, expiryRaw] of Object.entries(input)) {
    const domain = normalizeDomain(domainRaw);
    const expiry = Number(expiryRaw);
    if (domain && Number.isFinite(expiry) && expiry > now) {
      result[domain] = expiry;
    }
  }

  return result;
}

async function readState() {
  if (!stateReadyPromise) {
    stateReadyPromise = Promise.all([
      chrome.storage.local.get({
        extensionEnabled: DEFAULT_STATE.extensionEnabled,
        globalWarningText: DEFAULT_STATE.globalWarningText,
        blockedSites: DEFAULT_STATE.blockedSites
      }),
      chrome.storage.session.get({
        temporaryBypasses: DEFAULT_STATE.temporaryBypasses
      })
    ])
      .then(([storedLocal, storedSession]) => {
        stateCache = {
          extensionEnabled: storedLocal.extensionEnabled !== false,
          globalWarningText:
            typeof storedLocal.globalWarningText === 'string'
              ? storedLocal.globalWarningText
              : DEFAULT_STATE.globalWarningText,
          blockedSites: sanitizeSites(storedLocal.blockedSites),
          temporaryBypasses: sanitizeBypasses(storedSession.temporaryBypasses)
        };
        return cloneState(stateCache);
      })
      .catch((error) => {
        console.error('[Matrix] State load failed:', error);
        stateCache = cloneState(DEFAULT_STATE);
        return cloneState(stateCache);
      });
  }

  return stateReadyPromise;
}

async function persistState(partial) {
  stateCache = {
    ...stateCache,
    ...partial,
    blockedSites: sanitizeSites(partial.blockedSites ?? stateCache.blockedSites),
    temporaryBypasses: sanitizeBypasses(
      partial.temporaryBypasses ?? stateCache.temporaryBypasses
    )
  };

  const localPayload = {};
  if (Object.prototype.hasOwnProperty.call(partial, 'extensionEnabled')) {
    localPayload.extensionEnabled = stateCache.extensionEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'globalWarningText')) {
    localPayload.globalWarningText = stateCache.globalWarningText;
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'blockedSites')) {
    localPayload.blockedSites = stateCache.blockedSites;
  }

  const writes = [];
  if (Object.keys(localPayload).length > 0) {
    writes.push(chrome.storage.local.set(localPayload));
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'temporaryBypasses')) {
    writes.push(
      chrome.storage.session.set({
        temporaryBypasses: stateCache.temporaryBypasses
      })
    );
  }

  await Promise.all(writes);
  stateReadyPromise = Promise.resolve(cloneState(stateCache));
  return cloneState(stateCache);
}

function queueRuleSync(reason = 'unspecified') {
  const job = syncQueue.then(() => syncRules(reason));
  syncQueue = job.catch((error) => {
    console.error(`[Matrix] Rule sync failed (${reason}):`, error);
  });
  return job;
}

async function getCurrentDynamicRuleIds() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.map((rule) => rule.id);
}

function buildRedirectRule(site, index) {
  const safeMode = sanitizeMode(site.mode);
  return {
    id: RULE_ID_START + index,
    priority: RULE_PRIORITY,
    action: {
      type: 'redirect',
      redirect: {
        // Carry the configured domain/mode in the destination so the block page
        // can render even if navigation-context capture is unavailable.
        extensionPath: `/block.html?target=${encodeURIComponent(site.domain)}&mode=${encodeURIComponent(safeMode)}`
      }
    },
    condition: {
      requestDomains: [site.domain],
      resourceTypes: ['main_frame']
    }
  };
}

function activeSites(state) {
  const bypasses = sanitizeBypasses(state.temporaryBypasses);
  return state.blockedSites.filter((site) => !bypasses[site.domain]);
}

async function syncRules(reason = 'manual') {
  await readState();

  const removeRuleIds = await getCurrentDynamicRuleIds();
  const addRules = [];

  if (stateCache.extensionEnabled) {
    activeSites(stateCache).forEach((site, index) => {
      addRules.push(buildRedirectRule(site, index));
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });

  console.info(
    `[Matrix] Rules synchronized (${reason}) — enabled=${stateCache.extensionEnabled}, active=${addRules.length}`
  );
}

async function scheduleRearm(domain, expiry) {
  const normalized = normalizeDomain(domain);
  const when = Number(expiry);
  if (!normalized || !Number.isFinite(when)) return;

  try {
    await chrome.alarms.create(
      `${BYPASS_ALARM_PREFIX}${normalized}`,
      { when: Math.max(Date.now() + 250, when) }
    );
  } catch (error) {
    console.error(`[Matrix] Could not schedule bypass re-arm for ${normalized}:`, error);
  }
}

async function cleanupAndScheduleBypasses() {
  await readState();

  const cleaned = sanitizeBypasses(stateCache.temporaryBypasses);
  if (JSON.stringify(cleaned) !== JSON.stringify(stateCache.temporaryBypasses)) {
    await persistState({ temporaryBypasses: cleaned });
  }

  for (const [domain, expiry] of Object.entries(stateCache.temporaryBypasses)) {
    await scheduleRearm(domain, expiry);
  }
}

async function rememberPendingNavigation(details) {
  if (!details || details.frameId !== 0 || typeof details.tabId !== 'number') return;

  const url = typeof details.url === 'string' ? details.url : '';
  if (!/^https?:\/\//i.test(url)) return;

  try {
    const domain = normalizeDomain(new URL(url).hostname);
    if (!domain) return;

    await readState();
    if (!stateCache.extensionEnabled) return;

    const bypasses = sanitizeBypasses(stateCache.temporaryBypasses);
    const site = stateCache.blockedSites.find((entry) => entry.domain === domain);
    if (!site || bypasses[domain]) return;

    const stored = await chrome.storage.session.get({ pendingNavigations: {} });
    const pendingNavigations =
      stored.pendingNavigations && typeof stored.pendingNavigations === 'object'
        ? { ...stored.pendingNavigations }
        : {};

    pendingNavigations[String(details.tabId)] = {
      url,
      domain,
      mode: sanitizeMode(site.mode),
      createdAt: Date.now()
    };

    await chrome.storage.session.set({ pendingNavigations });
  } catch (error) {
    console.error('[Matrix] Could not remember pending navigation:', error);
  }
}

async function consumePendingNavigation(tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id) || id < 0) return null;

  try {
    const stored = await chrome.storage.session.get({ pendingNavigations: {} });
    const pendingNavigations =
      stored.pendingNavigations && typeof stored.pendingNavigations === 'object'
        ? { ...stored.pendingNavigations }
        : {};
    const key = String(id);
    const entry = pendingNavigations[key];

    if (!entry || typeof entry !== 'object') return null;
    if (Date.now() - Number(entry.createdAt) > PENDING_NAVIGATION_MAX_AGE_MS) return null;

    const url = typeof entry.url === 'string' ? entry.url : '';
    const domain = normalizeDomain(entry.domain || '');
    if (!url || !domain) return null;

    delete pendingNavigations[key];
    await chrome.storage.session.set({ pendingNavigations });

    return {
      url,
      domain,
      mode: sanitizeMode(entry.mode)
    };
  } catch (error) {
    console.error('[Matrix] Could not consume pending navigation:', error);
    return null;
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  void rememberPendingNavigation(details);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.storage.local.get(DEFAULT_STATE);

    await chrome.storage.local.set({
      extensionEnabled: existing.extensionEnabled !== false,
      globalWarningText:
        typeof existing.globalWarningText === 'string'
          ? existing.globalWarningText
          : DEFAULT_STATE.globalWarningText,
      blockedSites: sanitizeSites(existing.blockedSites)
    });

    await chrome.storage.session.set({
      temporaryBypasses: {},
      pendingNavigations: {}
    });

    stateReadyPromise = null;
    await readState();
    await cleanupAndScheduleBypasses();
    await queueRuleSync('extension installed/updated');
  } catch (error) {
    console.error('[Matrix] onInstalled initialization failed:', error);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    stateReadyPromise = null;
    await readState();
    await cleanupAndScheduleBypasses();
    await queueRuleSync('browser startup');
  } catch (error) {
    console.error('[Matrix] onStartup failed:', error);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    stateCache = {
      ...stateCache,
      ...(changes.extensionEnabled
        ? { extensionEnabled: changes.extensionEnabled.newValue !== false }
        : {}),
      ...(changes.globalWarningText
        ? {
            globalWarningText:
              typeof changes.globalWarningText.newValue === 'string'
                ? changes.globalWarningText.newValue
                : DEFAULT_STATE.globalWarningText
          }
        : {}),
      ...(changes.blockedSites
        ? { blockedSites: sanitizeSites(changes.blockedSites.newValue) }
        : {})
    };

    stateReadyPromise = Promise.resolve(cloneState(stateCache));
    void queueRuleSync('local settings changed').catch(() => {});
    return;
  }

  if (areaName === 'session' && changes.temporaryBypasses) {
    stateCache = {
      ...stateCache,
      temporaryBypasses: sanitizeBypasses(changes.temporaryBypasses.newValue)
    };
    stateReadyPromise = Promise.resolve(cloneState(stateCache));

    for (const [domain, expiry] of Object.entries(stateCache.temporaryBypasses)) {
      void scheduleRearm(domain, expiry);
    }

    void queueRuleSync('temporary bypass changed').catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    try {
      const stored = await chrome.storage.session.get({ pendingNavigations: {} });
      const pendingNavigations =
        stored.pendingNavigations && typeof stored.pendingNavigations === 'object'
          ? { ...stored.pendingNavigations }
          : {};
      delete pendingNavigations[String(tabId)];
      await chrome.storage.session.set({ pendingNavigations });
    } catch (error) {
      console.error('[Matrix] Pending navigation cleanup failed:', error);
    }
  })();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name?.startsWith(BYPASS_ALARM_PREFIX)) return;

  const domain = normalizeDomain(
    alarm.name.slice(BYPASS_ALARM_PREFIX.length)
  );
  if (!domain) return;

  try {
    await readState();
    const expiry = stateCache.temporaryBypasses[domain];

    if (!expiry || expiry <= Date.now()) {
      const temporaryBypasses = { ...stateCache.temporaryBypasses };
      delete temporaryBypasses[domain];
      await persistState({ temporaryBypasses });
    }

    await queueRuleSync(`temporary bypass expired: ${domain}`);
  } catch (error) {
    console.error('[Matrix] Alarm re-arm failed:', error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      const action = message?.action;

      if (action === 'GET_STATE') {
        const state = await readState();
        sendResponse({ ok: true, state: cloneState(state) });
        return;
      }

      if (action === 'CHECK_BLOCK_STATUS') {
        const domain = normalizeDomain(message.domain);
        if (!domain) {
          sendResponse({ ok: true, blocked: false });
          return;
        }

        const state = await readState();
        if (!state.extensionEnabled) {
          sendResponse({ ok: true, blocked: false });
          return;
        }

        const bypasses = sanitizeBypasses(state.temporaryBypasses);
        const site = state.blockedSites.find((entry) => entry.domain === domain);
        if (!site || bypasses[domain]) {
          sendResponse({ ok: true, blocked: false });
          return;
        }

        sendResponse({
          ok: true,
          blocked: true,
          mode: sanitizeMode(site.mode),
          warningText: site.warningText || state.globalWarningText || 'ACCESS DENIED.'
        });
        return;
      }

      if (action === 'SET_ENABLED') {
        const enabled = Boolean(message.enabled);
        await persistState({ extensionEnabled: enabled });
        await queueRuleSync('master toggle');
        sendResponse({ ok: true, extensionEnabled: enabled });
        return;
      }

      if (action === 'SAVE_SETTINGS') {
        const nextSites = sanitizeSites(message.blockedSites);
        const warning =
          typeof message.globalWarningText === 'string'
            ? message.globalWarningText.slice(0, 4000)
            : DEFAULT_STATE.globalWarningText;

        const state = await persistState({
          globalWarningText: warning,
          blockedSites: nextSites
        });

        await queueRuleSync('options save');
        sendResponse({ ok: true, state: cloneState(state) });
        return;
      }

      if (action === 'SYNC_RULES') {
        await queueRuleSync(message.reason || 'runtime sync');
        sendResponse({ ok: true });
        return;
      }

      if (action === 'GET_BLOCK_CONTEXT') {
        const context = await consumePendingNavigation(message.tabId);
        sendResponse({ ok: true, context });
        return;
      }

      if (action === 'TEMPORARY_ALLOW') {
        const domain = normalizeDomain(message.domain);
        if (!domain) {
          sendResponse({ ok: false, error: 'Invalid domain.' });
          return;
        }

        await readState();

        const expiry = Date.now() + BYPASS_MS;
        const temporaryBypasses = {
          ...stateCache.temporaryBypasses,
          [domain]: expiry
        };

        await persistState({ temporaryBypasses });
        await queueRuleSync(`temporary bypass start: ${domain}`);
        await scheduleRearm(domain, expiry);

        sendResponse({ ok: true, expiresAt: expiry });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown action.' });
    } catch (error) {
      console.error('[Matrix] Message handling failed:', error);
      sendResponse({
        ok: false,
        error: error?.message || 'Internal error.'
      });
    }
  })();

  return true;
});

void readState()
  .then(cleanupAndScheduleBypasses)
  .then(() => queueRuleSync('worker initialization'))
  .catch((error) => console.error('[Matrix] Worker initialization failed:', error));
