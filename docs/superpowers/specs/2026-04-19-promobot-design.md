# PromoBot Design Spec

## Summary

PromoBot is a locally deployed, LAN-accessible AI operations platform for promoting a multi-model AI API site. It runs on host `121`, exposes a single browser-based admin console, and centralizes content discovery, draft generation, review, scheduling, publishing, social listening, competitor monitoring, and reputation tracking in one product.

This is a single-user system for the operator only. It does not support self-service signup, public access, or team collaboration in the first release. All AI generation is executed by the backend on `121` against the operator's own OpenAI-compatible API endpoint. The web UI is an operations console, not a model-routing console.

## Goals

- Give the operator one LAN-accessible web console for end-to-end promotion workflows.
- Support multiple projects/brands inside the same system.
- Support both overseas and Chinese/community channels in one product.
- Combine API-first publishing with browser automation fallbacks where official APIs are missing or insufficient.
- Keep the deployment lightweight enough for a single host and a single operator.

## Non-Goals

- Multi-user roles, invitations, or complex approval chains.
- Public internet exposure.
- A generic SaaS control plane for third-party customers.
- A visual no-code automation builder in the first release.

## Final Scope Decisions

- Deployment target: host `121`
- Access model: LAN only, IP allowlist plus simple admin password login
- Operator model: single operator, multi-project
- AI model access: backend-only configuration on `121`
- Default review policy: low-risk content can auto-enter the publish queue; medium/high-risk content requires review
- Session strategy: persistent local browser profiles/cookies on `121`; re-login is manual when sessions expire
- Product shape: one product, one web console, one deployment target, internally modular

## Channel Scope

### Primary publishing and listening channels

- X / Twitter
- Reddit
- Facebook Group
- Xiaohongshu
- Weibo
- V2EX
- Blog output (`file`, `WordPress`, or `Ghost`)

### Execution model by channel

- X / Twitter: API-first, browser fallback permitted
- Reddit: API-first, browser/manual fallback permitted
- Facebook Group: browser automation first
- Xiaohongshu: browser automation first
- Weibo: browser automation first
- V2EX: discovery/listening first, manual or browser-assisted reply path
- Blog: file export or CMS API publication

## Product Modules

PromoBot is one product with six backend modules and one unified admin UI.

### 1. Content Operations Core

Responsible for:

- project configuration
- content discovery intake
- AI draft generation
- draft editing
- review queue
- scheduling
- publish execution
- publish logs

### 2. Social Inbox

Responsible for:

- cross-platform keyword listening
- unified inbox of matched posts
- AI reply suggestion
- direct reply where APIs exist
- manual takeover flow where APIs do not exist

### 3. Competitor Monitoring

Responsible for:

- RSS polling
- search-based monitoring
- source deduplication
- AI summarization/tagging
- one-click follow-up draft creation

### 4. Reputation Tracking

Responsible for:

- brand mention collection
- sentiment analysis
- trend visualization
- negative-item surfacing
- processed-state tracking

### 5. Multi-Platform Publishers

Responsible for:

- platform-specific publish adapters
- API credential use
- Playwright browser sessions
- publish retries
- result normalization

### 6. Account Session Center

Responsible for:

- API credential storage
- browser session/profile metadata
- connection tests
- session status display
- re-login triggers

## System Architecture

PromoBot runs as a single deployed application on `121`, but the runtime is split into three layers:

### Web/API Service

Provides:

- admin authentication
- UI data endpoints
- project configuration APIs
- content generation APIs
- draft CRUD APIs
- monitoring and inbox APIs
- job orchestration endpoints

Recommended stack:

- `Node.js 20`
- `TypeScript`
- `Express 5`

### Worker and Scheduler Runtime

Responsible for executing queued jobs such as:

- source fetches
- AI summaries
- draft generation
- sentiment analysis
- scheduled publish jobs
- reply suggestion jobs

The initial implementation uses one SQLite-backed job table plus an in-process scheduler loop. Redis is intentionally omitted in the first release because the system is single-host and single-operator.

### Browser Automation Lane

Responsible for all platforms that need simulated browser interaction:

- Facebook Group
- Xiaohongshu
- Weibo
- X fallback
- manual takeover helpers for V2EX or unstable flows

Recommended stack:

- `Playwright`
- local persistent storage under `data/sessions/`

## Frontend Shape

The frontend is a desktop-first admin console served on the LAN. It is optimized for direct operator actions and dense controls rather than presentation-heavy dashboards.

Recommended stack:

- `React`
- `Vite`
- `Tailwind CSS`

### Final navigation structure

- Dashboard
- Projects
- Discovery Pool
- Generate Center
- Drafts
- Review Queue
- Publish Calendar
- Social Inbox
- Competitor Monitor
- Reputation
- Channel Accounts
- Settings

## Core Data Model

The current draft schema must be upgraded from single-project tables to a multi-project model. The following entities are required.

### Project

Represents one brand or operating context.

Fields:

- `id`
- `name`
- `site_name`
- `site_url`
- `site_description`
- `selling_points`
- `brand_voice`
- `cta_templates`
- `banned_phrases`
- `default_language_policy`
- `risk_policy`
- timestamps

### ChannelAccount

Represents API credentials or browser session metadata bound to one project and one platform.

Fields:

- `id`
- `project_id`
- `platform`
- `auth_type` (`api`, `browser_session`, `manual`)
- `credential_blob` or references
- `session_path`
- `status`
- `last_tested_at`
- `last_error`
- timestamps

### SourceConfig

Represents one monitoring source bound to one project.

Fields:

- `id`
- `project_id`
- `source_type` (`keyword`, `rss`, `subreddit`, `x_list`, `facebook_group`, `competitor_account`, `v2ex_search`)
- `platform`
- `label`
- `config_json`
- `enabled`
- `poll_interval_minutes`
- timestamps

### ContentItem

Represents one candidate content item in the unified discovery pool.

Fields:

- `id`
- `project_id`
- `origin_type` (`manual`, `monitor`, `inbox`, `rss`, `search`)
- `platform`
- `source_config_id`
- `external_id`
- `author`
- `title`
- `content`
- `summary`
- `url`
- `matched_keywords_json`
- `metadata_json`
- `risk_score`
- `risk_reasons_json`
- `status` (`new`, `reviewed`, `ignored`, `drafted`)
- `published_at`
- timestamps

### Draft

Represents one publishable draft for one platform and one project.

Fields:

- `id`
- `project_id`
- `content_item_id` nullable
- `platform`
- `title`
- `content`
- `hashtags_json`
- `status` (`draft`, `approved`, `scheduled`, `queued`, `published`, `failed`)
- `review_required`
- `scheduled_at`
- `published_at`
- `publish_url`
- `generation_context_json`
- timestamps

### DraftVariant

Represents alternate generated versions of the same draft target.

Fields:

- `id`
- `draft_id`
- `variant_label`
- `title`
- `content`
- `hashtags_json`
- `selected`
- timestamps

### InboxItem

Represents one matched post in Social Inbox.

Fields:

- `id`
- `project_id`
- `platform`
- `source_config_id`
- `external_id`
- `author`
- `author_url`
- `content`
- `context`
- `post_url`
- `matched_keywords_json`
- `status` (`new`, `read`, `replied`, `ignored`, `snoozed`)
- `ai_reply_suggestion`
- `reply_content`
- `reply_mode` (`api`, `browser`, `manual`)
- `replied_at`
- `snoozed_until`
- `published_at`
- timestamps

### ReputationItem

Represents one brand mention or sentiment-candidate item.

Fields:

- `id`
- `project_id`
- `platform`
- `author`
- `content`
- `url`
- `sentiment` (`positive`, `neutral`, `negative`)
- `score`
- `reason`
- `status` (`new`, `processed`, `handled`)
- `published_at`
- timestamps

### Job

Represents all deferred work.

Fields:

- `id`
- `project_id`
- `type`
- `payload_json`
- `run_at`
- `status` (`pending`, `running`, `done`, `failed`)
- `attempts`
- `last_error`
- timestamps

### PublishLog

Tracks publish execution results.

Fields:

- `id`
- `project_id`
- `draft_id`
- `platform`
- `mode` (`api`, `browser`, `manual`)
- `success`
- `response`
- timestamps

### AuditLog

Tracks operator actions and important system mutations.

Fields:

- `id`
- `project_id` nullable
- `actor` (`admin` or `system`)
- `action`
- `target_type`
- `target_id`
- `payload_json`
- timestamps

## Primary Workflows

### Workflow A: Discovery to Published Content

1. A project source fetch creates `ContentItem` records.
2. The operator reviews items in the Discovery Pool.
3. The operator triggers generation for one or more target platforms.
4. The backend calls the AI service on `121` using the project's site context and brand rules.
5. One `Draft` plus optional `DraftVariant` records are created.
6. Risk scoring marks the draft as auto-queue eligible or review-required.
7. Approved drafts enter the job queue or immediate publish path.
8. A platform publisher executes the publish.
9. `PublishLog` is stored and the draft status is updated.

### Workflow B: Social Inbox Response

1. Platform listeners collect posts matching project keywords.
2. Matching results are saved as `InboxItem`.
3. The operator opens an inbox item and requests an AI reply suggestion.
4. The backend generates a natural-language response in the platform's expected language and style.
5. The operator edits the suggestion if needed.
6. The system executes an API reply or opens a browser/manual takeover path.
7. The inbox item is marked with its final handling status.

### Workflow C: Competitor Monitoring to Follow-Up Draft

1. RSS/search jobs ingest competitor or industry content.
2. The system summarizes and tags the content.
3. The operator chooses one monitor item and clicks "generate follow-up".
4. The system creates one or more drafts for selected platforms.
5. The draft re-enters the standard review and publish workflow.

### Workflow D: Reputation Tracking

1. The system searches for project-brand mentions on supported platforms.
2. Mentions are stored as `ReputationItem`.
3. Sentiment jobs analyze items in batches.
4. Dashboard and Reputation views aggregate the results.
5. Negative or important items can be marked handled or moved into Social Inbox follow-up flow.

## Platform-Specific Rules

### X / Twitter

- Generate concise English posts, hooks first.
- Support single post and thread generation.
- Publish through API if credentials are valid.
- Allow browser fallback for unstable or missing API coverage.

### Reddit

- Generate technical English titles and Markdown bodies.
- Prefer self-post format.
- Include transparent self-disclosure when required by strategy.
- Publish through API first.

### Facebook Group

- Use browser automation as the default publication path.
- Support source monitoring at the group level where feasible.
- Store browser session state locally on `121`.

### Xiaohongshu

- Generate Chinese seed-style content and tag bundles.
- Publish through browser automation only.
- Keep selectors isolated in dedicated files because DOM changes are expected.

### Weibo

- Generate short Chinese posts with topic formatting.
- Publish through browser automation only.

### V2EX

- Treat as listening and manual/assisted interaction first.
- Browser-open and copy-ready reply actions are sufficient in the initial full product design.

### Blog

- Generate long-form SEO content.
- Output to files or publish to WordPress/Ghost.

## AI Integration

All AI generation happens on the backend on `121`.

### Rules

- The frontend does not expose a model-routing control surface.
- Runtime configuration lives in environment/config storage on `121`.
- The UI may expose masked status, last test result, and a lightweight connectivity test.
- The default AI protocol is OpenAI-compatible HTTP.

### AI use cases

- multi-platform draft generation
- rewrite and tone adjustment
- content summarization
- keyword-aware follow-up generation
- reply suggestion generation
- sentiment classification

## UI Requirements

### Dashboard

Must show:

- today's generated drafts
- today's published items
- queued/review-required counts
- new monitor items
- inbox unread count
- reputation trend summary

### Projects

Must support:

- create/edit/archive project
- edit site context
- edit brand voice and CTAs
- bind channel accounts
- manage source configs
- configure risk policy

### Discovery Pool

Must support:

- project filter
- source/platform filters
- immediate fetch
- item ignore/save actions
- one-click generate actions per platform
- batch-generate from selected items

### Generate Center

Must support:

- manual topic input
- platform multi-select
- tone selection
- streaming generation progress
- save as draft
- send to review
- immediate publish
- scheduled publish

### Drafts

Must support:

- inline editing
- batch approval
- batch scheduling
- batch publish
- status filtering

### Review Queue

Must support:

- approve and publish
- approve and schedule
- send back for rewrite
- discard
- change publish route where needed

### Publish Calendar

Must support:

- list view and calendar view
- schedule editing
- job status inspection
- retry failed publish jobs

### Social Inbox

Must support:

- platform/status filters
- unread counts
- open original post
- AI reply suggestion
- editable reply box
- send reply
- snooze/ignore actions

### Competitor Monitor

Must support:

- feed display
- unread indicator
- source filters
- one-click follow-up draft generation

### Reputation

Must support:

- sentiment summary
- trend charts
- negative-item emphasis
- handled-state marking

### Channel Accounts

Must support:

- credential/session status view
- connection test
- session invalidation signal
- re-login trigger for browser-based channels

### Settings

Must support:

- global masked configuration display
- LAN access/IP allowlist management
- scheduler interval management
- RSS/source defaults

## Security and Access Model

- Bind the service for LAN access only.
- Apply IP allowlisting for approved local subnets or specific LAN IPs.
- Require a simple admin password login.
- Never expose raw API keys back to the UI.
- Store browser session files under a gitignored local directory.
- Keep the system off the public internet.

## Storage and Deployment

### Storage

- database: `SQLite`
- browser sessions: local filesystem
- blog file output: local filesystem
- logs: local filesystem plus normalized DB records where needed

### Deployment

- build frontend and serve it from the backend
- run the production service under `PM2`
- keep one deployable app on `121`

## Error Handling

- Publisher failures must update draft/job state and write a `PublishLog`.
- Browser session expiry must surface clearly in Channel Accounts and job errors.
- Failed scheduled jobs must remain inspectable and retryable.
- Monitor/listening fetch errors must not block unrelated jobs.
- AI failures must not corrupt drafts; partial streaming output should only become saved content when explicitly accepted.

## Testing Strategy

The implementation plan must include tests for:

- schema initialization and migrations
- project-scoped data isolation
- draft CRUD and state transitions
- job scheduler state transitions
- AI client adapters with mocked HTTP responses
- publisher adapters with platform-specific contract tests
- API routes for content, drafts, inbox, monitor, reputation, and settings
- UI flows for draft generation, approval, scheduling, inbox reply suggestion, and publish retry
- browser automation smoke tests for browser-only channels

## Delivery Strategy

PromoBot is designed as one full product, but implementation still proceeds in internal batches:

1. foundation and shared data model
2. content operations and publishing
3. inbox and monitoring
4. reputation and analytics
5. browser-heavy platform hardening

This is an implementation sequencing rule, not a scope reduction. The final product remains the full platform defined in this spec.

## Design Acceptance Criteria

The design is considered satisfied when the built system:

- runs on `121`
- is accessible from the LAN in a browser
- supports multiple projects
- generates and publishes content across the required platform set
- centralizes inbox, monitor, and reputation data in one UI
- uses backend-only AI access on `121`
- enforces LAN/IP/password restrictions
- preserves browser session state for browser-based channels
