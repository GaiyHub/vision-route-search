## ADDED Requirements

### Requirement: Browser action parity
The system SHALL expose the OpenMinis browser action set: `navigate`, `screenshot`, `click`, `type`, `get_text`, `scroll`, `get_page_info`, `execute_js`, `find_elements`, `hover`, `get_readable`, `set_user_agent`, `set_viewport`, `get_backbone`, `fetch`, `new_tab`, `close_tab`, `list_tabs`, `get_cookies`, `set_cookies`, `scroll_and_collect`, and `wait_for_dom_stable`.

#### Scenario: Model receives aligned browser schema
- **WHEN** a new agent task is created with `browser_use` enabled
- **THEN** the tool schema lists every aligned action and its applicable parameters

#### Scenario: Legacy action remains compatible
- **WHEN** the model or restored history calls `page_info`, `read_page`, or `wait_for_stable`
- **THEN** the system executes the corresponding aligned action without failure

### Requirement: Structured DOM-first observation
The system SHALL return page text, readable content, page metadata, semantic element information, and compact DOM backbone directly from the WebView without requiring a phone screenshot.

#### Scenario: Inspect interactive search input
- **WHEN** an input is identified by placeholder, accessible name, id, name, role, type, or visible text
- **THEN** `find_elements` returns a stable ref and sufficient semantic attributes for later interaction

#### Scenario: Read search results
- **WHEN** a result page contains readable DOM text
- **THEN** `get_readable` or `get_text` returns that content with URL, title, length and truncation metadata

### Requirement: Deterministic browser interaction
The system SHALL support ref-first and selector-based click/type, coordinate click, hover, deterministic scrolling, and DOM stability waits with structured success or failure results.

#### Scenario: Scroll reports completed movement
- **WHEN** `scroll` is executed on a scrollable page or container
- **THEN** the result reports the before and after positions after the movement has occurred

#### Scenario: Collect a long result list
- **WHEN** `scroll_and_collect` is called with an item selector and bounded scroll count
- **THEN** the system returns de-duplicated items collected across the requested scroll positions in one tool result

### Requirement: Browser screenshot reaches the model
The system SHALL attach an explicitly requested browser screenshot to the next model inference as a `ScreenshotImage`, while excluding its base64 bytes from text history and task logs.

#### Scenario: Explicit screenshot
- **WHEN** `browser_use` executes `screenshot` successfully
- **THEN** the next vision-capable inference receives the captured image and the textual result contains only compact metadata

#### Scenario: DOM-only action
- **WHEN** `get_text`, `get_readable`, `find_elements`, `get_backbone`, `get_page_info`, or `list_tabs` executes
- **THEN** no new phone screenshot is captured solely because of that action

### Requirement: Browser state is separate from phone UI state
The system SHALL classify browser effects from the action definition and SHALL NOT request `_changesScreen` judgment from the model for `browser_use`.

#### Scenario: Browser navigation
- **WHEN** `navigate` changes the WebView page
- **THEN** AgentLoop uses the browser result rather than phone accessibility-tree settling to observe the change

#### Scenario: Browser read action
- **WHEN** a read-only browser action executes
- **THEN** AgentLoop reuses the existing phone observation and records progress from the browser result

### Requirement: Multi-tab session
The system SHALL maintain at most three browser tabs and route every action to an explicit `tab_id` or the selected tab.

#### Scenario: Open and inspect tabs
- **WHEN** the model creates tabs and calls `list_tabs`
- **THEN** the result identifies each tab, selected state, URL and title

#### Scenario: Tab limit
- **WHEN** a fourth tab is requested while three tabs are open
- **THEN** the action fails without replacing an existing tab

### Requirement: Advanced browser controls
The system SHALL support bounded JavaScript execution, user-agent and viewport changes, current-session resource fetching, and current-site Cookie retrieval and update.

#### Scenario: Execute asynchronous script
- **WHEN** `execute_js` contains an asynchronous expression within the configured timeout
- **THEN** the resolved serializable value is returned with bounded output size

#### Scenario: Fetch allowed resource
- **WHEN** `fetch` targets an allowed public HTTP or HTTPS resource within the size limit
- **THEN** the resource is saved to app storage and its metadata and local path are returned

#### Scenario: Reject unsafe fetch
- **WHEN** `fetch` targets a disallowed scheme, loopback address, private address, or oversized resource
- **THEN** the action fails without exposing the resource

#### Scenario: Manage current-site cookies
- **WHEN** the model explicitly calls `get_cookies` or `set_cookies`
- **THEN** the action is restricted to the current page site and its result is excluded from unsanitized task logging
