# Spec: `eval-console`

## Purpose

Provide a simple local WebUI without hiding evaluation state or errors.

## Required views

- Dataset list/import/editor with validation feedback.
- Device selector showing serial, model and authorization state.
- Judge configuration with connection test and multimodal capability indication.
- Run launcher with dataset, device and failed-only rerun options.
- Live run view with aggregate counts and per-sample status.
- Sample detail with instruction, assertions, Judge result, final response, screenshot and trace timeline.
- Report history and export/open actions.

## Local API

- `GET /api/devices`
- `GET/POST/PATCH /api/datasets`
- `POST /api/judge/test`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events` using SSE
- `POST /api/runs/:runId/cancel`
- `POST /api/runs/:runId/rerun`
- `GET /api/runs/:runId/report`

All request/response and error bodies use shared validated schemas. Errors have a stable machine code, human message and optional field details.

## Security

- Bind to `127.0.0.1` by default and do not enable CORS for arbitrary origins.
- Judge secrets are accepted only by the backend and never echoed in API responses.
- Dataset and run ids are validated before resolving filesystem paths.

## Success criteria

- A user can complete the primary flow without using a terminal after ADB is installed and the evaluation APK is ready.
- Refreshing the browser reconstructs the current run from persisted backend state.

