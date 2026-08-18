## 1. Tool contract and compatibility

- [x] 1.1 Expand browser action and argument/result types to the OpenMinis action set while preserving legacy aliases.
- [x] 1.2 Update the model-facing browser tool schema and description with aligned parameters, capabilities, limits, and DOM-first guidance.

## 2. Browser session and tabs

- [x] 2.1 Refactor BrowserHost/adapter into a tab-aware WebView host with selected-tab routing and at most three live tabs.
- [x] 2.2 Implement new_tab, close_tab, list_tabs, tab_id routing, user-agent switching, and viewport overrides.

## 3. DOM and interaction actions

- [x] 3.1 Implement get_text, get_readable, get_page_info, get_backbone, richer find_elements, click coordinates, hover, and async execute_js.
- [x] 3.2 Make scrolling deterministic and implement selector container scrolling plus scroll_and_collect de-duplication.
- [x] 3.3 Implement wait_for_dom_stable and preserve legacy read/wait/page-info behavior.

## 4. Resources and browser state

- [x] 4.1 Implement bounded public-resource fetch with app-local persistence and structured metadata.
- [x] 4.2 Implement current-site get_cookies/set_cookies and sanitize sensitive browser results from logs.

## 5. Native browser observation

- [x] 5.1 Return screenshot path/base64 metadata from browser_use and attach explicit screenshots to the next vision inference without serializing image bytes into history.
- [x] 5.2 Remove browser_use from model UI-effect judgment and bypass phone tree settling/screenshots for browser-native actions.
- [x] 5.3 Use browser result fingerprints for loop progress while retaining phone observation for non-browser tools.

## 6. Verification and delivery

- [x] 6.1 Add or update unit tests for schema parity, aliases, DOM scripts, tabs, image extraction, and browser observation scheduling.
- [x] 6.2 Run targeted Jest tests, full Jest, and TypeScript typecheck; fix regressions.
- [ ] 6.3 Build the Android release APK, install it on the connected phone, and verify the aligned browser flow with a safe public search page.
