MATRIX FOCUS INTERCEPTOR — MV3 v1.4.0
=====================================

FILES
-----
manifest.json        Extension metadata, permissions, incognito mode.
background.js        Storage state, dynamic DNR redirects, navigation context,
                     temporary bypass and rule synchronization.
incognito-block.js   Incognito-only document_start fallback blocker.
popup.html/js/css    Compact master control popup.
options.html/js/css  Standalone configuration dashboard.
block.html/js/css    Local interception UI, Matrix terminal and Snake challenge.
styles.css           Shared base theme tokens and controls.

BLOCKING ARCHITECTURE
---------------------
• Normal tabs use declarativeNetRequest to redirect configured main-frame requests.
• The redirect target carries the configured domain and mode in its query string.
• The exact original URL is also captured with webNavigation for Snake handoff.
• Incognito uses split extension mode plus an Incognito-only document_start fallback.
• The fallback checks the shared configured site list through the Incognito service worker.
• Text Warning Mode has no proceed button.
• Snake Game Mode unlocks after 10 red food nodes are collected.
• Proceed temporarily disables only that domain for 4 seconds using session storage and alarms.

INSTALL
-------
1. Unzip the package.
2. Open chrome://extensions/.
3. Enable Developer mode.
4. Remove the previous Matrix/Block copy before loading this version.
5. Click Load unpacked and select the inner folder containing manifest.json.
6. Open the extension Details page.
7. Turn on Allow in Incognito.
8. Open the Matrix Panel and configure at least one test domain.
9. Test in a NEW normal tab and a NEW Incognito tab.

IMPORTANT
---------
After changing extension files, use Reload on chrome://extensions/.
For Incognito testing, close all old Incognito tabs and create a fresh Incognito window.
The Incognito fallback is intentionally separate from normal-tab blocking, so Incognito does
not depend on the DNR redirect to a chrome-extension:// page succeeding.

NO EXTERNAL ASSETS
------------------
No remote libraries, hosted fonts, external images, frameworks, or inline remote resources are used.
