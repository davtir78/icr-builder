// Starter prompts for each section, and what choosing a pattern fills in.
//
// A scaffold is a few short lines in the specification's "statements, not prose" style, with
// <angle-bracket> placeholders where the author's facts go. Scaffolds are put into a section only
// when the author asks (the "Insert prompts" button) or, for a pattern, into sections that are still
// empty. The builder reports any placeholder left in the record as advice, because a prompt that was
// never replaced is not a statement a reviewer can test.

import { patternById, componentBySlug } from './data/patterns.js';
import { getSection, setSection, sectionIndex } from './model.js';
import { blank, fences } from './lint.js';
import { buildFlow, defaultFlowOptions } from './flow.js';

const ph = (s) => `<${s}>`;

/** Context for a scaffold: the pattern, the interaction and the front matter. */
function ctxOf(model) {
  const fm = model.fm ?? {};
  const pattern = typeof fm.pattern?.id === 'string' ? patternById(fm.pattern.id) : null;
  return { fm, pattern, interaction: fm.interaction, component: pattern?.component, boundary: pattern?.boundary };
}

const link = (p) => `[${p.title}](${p.url})`;

function partiesTable(fm) {
  const provider = (typeof fm.provider?.system === 'string' && fm.provider.system) || ph('provider system');
  const consumers = (Array.isArray(fm.consumers) ? fm.consumers : []).map((c) => c?.system).filter((s) => typeof s === 'string' && s) ;
  const rows = [['Provider', provider], ...(consumers.length ? consumers : [ph('consumer system')]).map((c) => ['Consumer', c])];
  return ['| Party | System | Responsible for |', '|---|---|---|', ...rows.map(([r, s]) => `| ${r} | ${s} | ${ph('building, operating, monitoring, paying for, changing')} |`)].join('\n');
}

const INTERACTION_BULLETS = {
  'sync-request-response': [
    `- Direction and trigger: ${ph('consumer to provider')}, on ${ph('each user action | each call from system X')}.`,
    `- Volume: typical ${ph('n')} requests per second, peak ${ph('n')} requests per second (${ph('when')}).`,
    '- Ordering: not applicable; each request stands alone, and concurrent changes to one record are resolved by the provider.',
  ],
  'async-event': [
    `- Direction and trigger: provider publishes an event when ${ph('something happens')}; each consumer subscribes.`,
    `- Volume: typical ${ph('n')} events per hour, peak ${ph('n')} events per minute (${ph('when')}).`,
    `- Ordering: ${ph('not required | guaranteed per key, by partition key X')}; consumers ${ph('tolerate duplicates | de-duplicate by event id')}.`,
  ],
  'async-message': [
    `- Direction and trigger: ${ph('sender')} sends a message to ${ph('receiver')} when ${ph('a business event occurs')}.`,
    `- Volume: typical ${ph('n')} messages per hour, peak ${ph('n')} messages per minute (${ph('when')}).`,
    `- Ordering: ${ph('not required | first-in-first-out per group id')}.`,
  ],
  stream: [
    `- Direction and trigger: provider appends a record for every ${ph('change in the source')}; consumers read continuously.`,
    `- Volume: typical ${ph('n')} records per second, peak ${ph('n')} records per second; ${ph('n')} MB per hour.`,
    `- Ordering: ${ph('guaranteed per key within a partition')}; consumers track their own offset.`,
  ],
  'batch-file': [
    `- Direction and trigger: ${ph('sender')} sends a file to ${ph('receiver')} on a schedule: ${ph('every night by 02:00')}.`,
    `- Volume: typical ${ph('n')} files per day of ${ph('n')} MB each (${ph('n')} records); peak ${ph('n')} files (${ph('when')}).`,
    `- Ordering: ${ph('files are independent | files must be applied in sequence number order')}.`,
  ],
};

const SECURITY_BY_BOUNDARY = {
  internal: [
    `- Authentication: ${ph('mutual TLS | OAuth 2.0 client credentials | service account')} for each party.`,
    '- Credential issue and rotation: issued by <team>, held in <secret store>, rotated every <n> days.',
    `- Authorisation: ${ph('each consumer may only X; it may not Y')}.`,
    `- Transport: ${ph('protocol')}, TLS ${ph('1.2')} or later.`,
    `- Network path: private network; ${ph('segmentation or allow-listing')}.`,
  ],
  external: [
    `- Authentication: ${ph('OAuth 2.0 client credentials | mutual TLS | API key bound to the partner')} for each partner.`,
    '- Credential issue and rotation: issued by <team> when a partner is onboarded, rotated every <n> days.',
    `- Authorisation: ${ph('each partner may only X; it may not Y')}.`,
    `- Transport: ${ph('protocol')}, TLS ${ph('1.2')} or later.`,
    `- Network path: ${ph('public internet through the gateway | private link | dedicated connection')}; allow-listing: ${ph('IP ranges | none')}.`,
  ],
  cloud: [
    `- Authentication: ${ph('OAuth 2.0 client credentials | the service’s API key | mutual TLS')}; the SaaS provider authenticates ${ph('how')}.`,
    '- Credential issue and rotation: held in <secret store>, rotated every <n> days.',
    `- Authorisation: ${ph('the integration user has only the permissions X')}.`,
    `- Transport: ${ph('protocol')}, TLS ${ph('1.2')} or later.`,
    `- Network path: ${ph('public internet to the service endpoint | private connectivity')}; egress allow-list: ${ph('addresses | none')}.`,
  ],
};

const DEFAULT_SECURITY = SECURITY_BY_BOUNDARY.external;

function inheritedLine(pattern) {
  return pattern
    ? `- Pattern controls inherited: ${link(pattern)}; additional controls: ${ph('what this integration adds or changes')}`
    : `- Pattern controls inherited: ${ph('link to the pattern')}; additional controls: ${ph('what this integration adds or changes')}`;
}

const SERVICE_BY_INTERACTION = {
  'sync-request-response': [
    `- Availability: ${ph('99.9%')} per month, measured at ${ph('the API gateway')}.`,
    `- Latency: ${ph('p95')} ≤ ${ph('n')} ms, measured at ${ph('the gateway')}.`,
    `- Throughput: ${ph('n')} requests per second per consumer; beyond it, ${ph('HTTP 429 with Retry-After')}.`,
    '- Freshness: not applicable; each response is computed at the time of the request.',
  ],
  'async-event': [
    `- Availability: ${ph('99.9%')} per month, measured at ${ph('the broker')}.`,
    `- Latency: ${ph('p95')} of events delivered to a consumer within ${ph('n')} s of publication, measured at ${ph('the broker')}.`,
    `- Throughput: ${ph('n')} events per second per publisher; beyond it, ${ph('the publish call is throttled')}.`,
    `- Freshness: events are available to consumers within ${ph('n')} s of the source change.`,
  ],
  'async-message': [
    `- Availability: ${ph('99.9%')} per month, measured at ${ph('the queue')}.`,
    `- Latency: ${ph('p95')} of messages processed within ${ph('n')} s of being accepted, measured at ${ph('the queue')}.`,
    `- Throughput: ${ph('n')} messages per second; beyond it, ${ph('messages wait in the queue')}.`,
    `- Freshness: the receiving system reflects a message within ${ph('n')} s of its being accepted; an alert fires when the queue holds more than ${ph('n')} messages (a threshold for operators, not a promise to consumers).`,
  ],
  stream: [
    `- Availability: ${ph('99.9%')} per month, measured at ${ph('the stream endpoint')}.`,
    `- Latency: ${ph('p95')} end-to-end lag under ${ph('n')} s, measured at ${ph('the consumer offset')}.`,
    `- Throughput: ${ph('n')} records per second per partition.`,
    `- Freshness: records are available to consumers within ${ph('n')} s of the source change; retained for ${ph('n')} days for replay.`,
  ],
  'batch-file': [
    `- Availability: the receiving endpoint is available ${ph('99.5%')} of ${ph('the delivery window')}, measured at ${ph('the file transfer service')}.`,
    `- Latency: a file is validated and a receipt returned within ${ph('n')} minutes of arrival.`,
    `- Throughput: files up to ${ph('n')} MB and ${ph('n')} files per day; beyond it, ${ph('the file is rejected with the reason')}.`,
    `- Freshness: the file for ${ph('day D')} arrives by ${ph('time')} on ${ph('day D+1')}; data is available to consumers ${ph('n')} minutes later.`,
  ],
};

const SERVICE_TAIL = [
  `- How a consumer learns its limit and use: ${ph('response headers | documentation | a usage report')}.`,
  `- Recovery: time ${ph('how long the integration may be down')}; point ${ph('how much data it may lose')}.`,
  `- Support hours for these objectives: ${ph('24x7 | business hours, time zone')}.`,
];

const ERRORS_BY_INTERACTION = {
  'sync-request-response': [
    `- Errors and their meaning: each error carries a stable code and says whether the consumer may retry it: ${ph('4xx: the request must change, except 429, where the consumer waits for Retry-After; 5xx: retry only a safe or idempotent request')}.`,
    `- Timeouts: the consumer waits ${ph('n')} seconds.`,
    `- Retries: the consumer retries only safe or idempotent requests, ${ph('n')} times, backoff ${ph('jittered, starting at n s')}.`,
    `- Idempotency: ${ph('requests that change state carry an Idempotency-Key')}; a repeated key within ${ph('24 hours')} returns the original result.`,
    '- Failed messages or files: not applicable; the interaction is synchronous.',
    `- Recovery after an outage: ${ph('the consumer re-sends requests that were not acknowledged')}.`,
  ],
  'async-event': [
    `- Errors and their meaning: ${ph('an event that fails validation is rejected with a reason')}.`,
    `- Timeouts: ${ph('the broker | the consumer')} waits ${ph('n')} seconds for a consumer acknowledgement.`,
    `- Retries: ${ph('the broker | the consumer')} retries ${ph('n')} times, backoff ${ph('exponential from n s')}, then moves the event to the dead-letter ${ph('queue | topic')}.`,
    `- Idempotency: every event carries a unique id; consumers ${ph('ignore an id they have already processed')}.`,
    `- Failed messages or files: dead-lettered events go to ${ph('queue or topic name')}; ${ph('team')} is alerted when it is not empty.`,
    `- Recovery after an outage: events are retained for ${ph('n')} days; a consumer replays from ${ph('its last acknowledged position')}.`,
  ],
  'async-message': [
    `- Errors and their meaning: ${ph('a message that fails validation is rejected with a reason')}.`,
    `- Timeouts: the receiver has ${ph('n')} seconds to acknowledge before the message becomes visible again.`,
    `- Retries: ${ph('n')} times, exponential backoff starting at ${ph('n')} s, then dead-letter to ${ph('queue name')}.`,
    `- Idempotency: every message carries a unique id; the receiver ${ph('ignores a repeated id')}.`,
    `- Failed messages or files: dead-lettered messages go to ${ph('queue name')}; ${ph('team')} is alerted within ${ph('n')} minutes.`,
    `- Recovery after an outage: ${ph('messages wait in the queue for up to n days')}.`,
  ],
  stream: null, // set below: a stream and the log-based event patterns share one set of prompts
  'batch-file': [
    `- Errors and their meaning: ${ph('a file is rejected with a reason code: bad name, bad checksum, bad format, duplicate')}.`,
    `- Timeouts: an upload that has not completed in ${ph('n')} minutes is discarded.`,
    `- Retries: the sender may re-send a rejected file after fixing it, ${ph('up to n times per day')}.`,
    `- Idempotency: a file is identified by ${ph('its name and checksum')}; a re-sent identical file is acknowledged and not processed twice.`,
    `- Failed messages or files: rejected files go to ${ph('a quarantine folder')}; ${ph('team')} and the sender are told within ${ph('n')} minutes.`,
    `- Recovery after an outage: the sender re-sends any file for which it holds no receipt; files are accepted for ${ph('n')} days after their business date.`,
  ],
};

// A log-based stream (event streaming, change data capture): consumers pull from an offset, so retries and the
// dead-letter topic belong to the consumer, and the broker does not redeliver.
const ERRORS_LOG_BASED = [
  `- Errors and their meaning: ${ph('a record that fails validation is rejected by the producer with a reason')}; a record a consumer cannot process is that consumer's to handle.`,
  `- Timeouts: a consumer that has not committed an offset for ${ph('n')} minutes is considered stalled.`,
  `- Retries: the consumer owns retries, ${ph('n')} times with backoff ${ph('exponential from n s')}; the broker does not redeliver a record the consumer has read.`,
  `- Idempotency: every record has a key and a sequence; consumers ${ph('de-duplicate on them, because a consumer may read a record again after a restart')}.`,
  `- Failed messages or files: the consumer writes a record it cannot process to ${ph('dead-letter topic name')} and ${ph('team')} is alerted when it receives one.`,
  `- Recovery after an outage: records are retained for ${ph('n')} days; a consumer resumes from its last committed offset or replays from ${ph('a timestamp')}.`,
];
ERRORS_BY_INTERACTION.stream = ERRORS_LOG_BASED;

const EXAMPLE_FENCES = {
  'sync-request-response': ['The main exchange:', '```http\nPOST /v1/<resource>\nContent-Type: application/json\n\n{ <request body> }\n```\n\n```http\nHTTP/1.1 201 Created\nContent-Type: application/json\n\n{ <response body> }\n```', 'The main error, as the consumer receives it:', '```http\nHTTP/1.1 409 Conflict\nContent-Type: application/problem+json\n\n{ <problem document> }\n```'],
  'async-event': ['The main event, with its envelope:', '```json\n{\n  "specversion": "1.0",\n  "type": "<event type>",\n  "source": "<source>",\n  "id": "<unique id>",\n  "time": "<ISO 8601 instant>",\n  "data": { <payload> }\n}\n```', 'The main failure, as the consumer or the operator sees it:', '```json\n{ <dead-letter record: event id, reason, attempts> }\n```'],
  'async-message': ['The main message:', '```json\n{\n  "messageId": "<unique id>",\n  "type": "<message type>",\n  "body": { <payload> }\n}\n```', 'The main failure, as the sender or the operator sees it:', '```json\n{ <rejection or dead-letter record: message id, reason, attempts> }\n```'],
  stream: ['The main record, with its key and offset:', '```json\n{\n  "key": "<key>",\n  "offset": <n>,\n  "value": { <payload> }\n}\n```', 'The main failure, as the consumer or the operator sees it:', '```json\n{ <dead-letter record: key, offset, reason> }\n```'],
  'batch-file': ['The main file, with its name and an excerpt:', '```csv\n# <file name, for example production_20261008_001.csv>\n<header row>\n<one example row, with no real personal data>\n```', 'The main rejection, as the sender receives it:', '```json\n{ <receipt: file name, status, reason code, reason text> }\n```'],
};

const ACCEPTANCE_BY_INTERACTION = {
  'sync-request-response': [
    `1. A request that is valid against the specification returns ${ph('the documented response')} in under ${ph('n')} ms at p95. Proved by: ${ph('contract test | synthetic check')}.`,
    `2. A repeated state-changing request with the same idempotency key creates nothing new and returns the original result. Proved by: ${ph('test name')}.`,
    `3. Beyond ${ph('n')} requests per second a consumer receives ${ph('HTTP 429 with Retry-After')}. Proved by: ${ph('load test')}.`,
  ],
  'async-event': [
    `1. An event that is valid against the specification is delivered to every subscribed consumer within ${ph('n')} s. Proved by: ${ph('synthetic check')}.`,
    `2. An event redelivered after a failure is processed once. Proved by: ${ph('test name')}.`,
    `3. An event that fails ${ph('n')} times is moved to the dead-letter queue and ${ph('team')} is alerted. Proved by: ${ph('alert test')}.`,
  ],
  'async-message': [
    `1. A message that is valid against the specification is accepted and processed within ${ph('n')} s. Proved by: ${ph('synthetic check')}.`,
    `2. A message sent twice with the same id is processed once. Proved by: ${ph('test name')}.`,
    `3. A message that fails ${ph('n')} times is moved to the dead-letter queue and ${ph('team')} is alerted. Proved by: ${ph('alert test')}.`,
  ],
  stream: [
    `1. A record appended to the stream is readable by every consumer within ${ph('n')} s. Proved by: ${ph('synthetic check')}.`,
    `2. A consumer that restarts resumes from its last committed offset and loses no record. Proved by: ${ph('test name')}.`,
    `3. Records for one key are delivered in the order they were appended. Proved by: ${ph('test name')}.`,
  ],
  'batch-file': [
    `1. A file that is valid against the specification is accepted and a receipt is returned within ${ph('n')} minutes. Proved by: ${ph('test name')}.`,
    `2. A file with a bad checksum is rejected with the reason code ${ph('code')} and quarantined. Proved by: ${ph('test name')}.`,
    `3. The same file sent twice is processed once. Proved by: ${ph('test name')}.`,
  ],
};

// A log-based stream (event streaming, change data capture): a consumer reads from an offset and the broker does not
// redeliver, so the criteria are about the offset, a re-read after a restart, and the consumer's own dead-letter topic.
const ACCEPTANCE_LOG_BASED = [
  `1. A record appended to the stream is readable by every consumer within ${ph('n')} s. Proved by: ${ph('synthetic check')}.`,
  `2. A consumer that restarts resumes from its last committed offset, loses no record, and processes a record it reads again once. Proved by: ${ph('test name')}.`,
  `3. A record a consumer cannot process after ${ph('n')} retries is written by that consumer to the dead-letter topic and ${ph('team')} is alerted. Proved by: ${ph('alert test')}.`,
];

/** A one-line note for the author about what this kind of pattern usually needs, shown beside the prompts. */
const COMPONENT_NOTES = {
  api: `Throughput is limited per consumer at the gateway (a rate limit), so say what a consumer sees at the limit.`,
  esp: 'Name the retention period: it sets how far back a consumer can replay.',
  cdc: 'Name the lag you accept between the source commit and the consumer.',
  etl: 'Say when the job runs, how long it may take, and what happens when it overruns.',
  filetransfer: 'Say how a file is named, checked and acknowledged.',
};

/** The starter text for a section, from the record so far. */
export function scaffoldFor(title, model) {
  const { fm, pattern, interaction } = ctxOf(model);
  const kind = interaction in INTERACTION_BULLETS ? interaction : 'sync-request-response';
  const boundary = pattern?.boundary;
  switch (title) {
    case 'Purpose':
      return `${ph('Why this integration exists in business terms: the capability it serves.')} If it stops, ${ph('what breaks for the business')}.`;
    case 'Parties and responsibilities':
      return partiesTable(fm);
    case 'Interaction':
      return [`- Pattern: ${pattern ? link(pattern) : ph('pattern')}, ${ph('any deliberate deviation from it, and why | no deviation')}.`, ...INTERACTION_BULLETS[kind]].join('\n');
    case 'Interface specification': {
      const list = Array.isArray(fm.interfaces) ? fm.interfaces : [];
      const lines = list.length
        ? list.map((i) => `- ${i?.type ?? ph('type')} \`${i?.ref ?? ph('ref')}\`${i?.version ? ` v${i.version}` : ''} — ${ph('what it covers')}; authoritative copy: ${ph('where')}`)
        : kind === 'batch-file'
          ? [`- File format: ${ph('CSV | JSON Lines')}; naming: ${ph('pattern')}; encoding: ${ph('UTF-8')}; structure: ${ph('columns or fields')}.`]
          : [`- No machine-readable specification is listed in the front matter. ${ph('Add one there (an AsyncAPI or CloudEvents document for events and messages, an OpenAPI document for a synchronous API) and describe it here, or say why there is none')}.`];
      return [...lines, `- Design standard followed: ${ph('standard, or none')}.`].join('\n');
    }
    case 'Examples': {
      const [a, f1, b, f2] = EXAMPLE_FENCES[kind];
      return `${a}\n\n${f1}\n\n${b}\n\n${f2}`;
    }
    case 'Environments and onboarding':
      return [`- Environments: ${ph('test and production: where each is, and how they differ')}.`, `- Test data or sandbox: ${ph('what exists, and what it does not simulate')}.`, `- Access: ${ph('how a new consumer asks, who approves, how long it takes')}.`, `- First call: ${ph('the smallest exchange that shows a new consumer is connected')}.`].join('\n');
    case 'Data':
      return [
        `- Entities: ${ph('the business entities that cross the interface')}.`,
        `- Classification: ${typeof fm.data?.classification === 'string' && fm.data.classification ? fm.data.classification : ph('classification')}; driven by: ${ph('the fields that set it')}.`,
        `- Personal information: ${fm.data?.['personal-information'] === false ? 'none.' : ph('none | which fields, and the basis for sharing')}.`,
        `- Residency: ${ph('where the data may be stored and processed')}.`,
        `- Retention: provider ${ph('period')}; consumer ${ph('period')}.`,
        ...(kind === 'batch-file' || kind === 'stream' ? [`- Data quality: ${ph('completeness, validity and uniqueness rules')}; ${ph('who is told when they are broken')}.`] : []),
      ].join('\n');
    case 'Security':
      return [...(SECURITY_BY_BOUNDARY[boundary] ?? DEFAULT_SECURITY), inheritedLine(pattern)].join('\n');
    case 'Service levels':
      return [...SERVICE_BY_INTERACTION[kind], ...SERVICE_TAIL].join('\n');
    case 'Error handling': {
      // Event streaming and change data capture are log-based: consumers pull from an offset, so retries and the
      // dead-letter topic are the consumer's, not the broker's.
      const logBased = kind === 'stream' || ['esp', 'cdc'].includes(pattern?.component);
      return (logBased ? ERRORS_LOG_BASED : ERRORS_BY_INTERACTION[kind]).join('\n');
    }
    case 'Change and versioning':
      return [`- Interface versioning: ${ph('major version in the path | header | schema registry compatibility mode')}.`, `- Breaking change means: ${ph('removing or renaming a field or operation, changing a type, tightening validation')}.`, `- Notice before a breaking change or deprecation: ${ph('n')} days, via ${ph('channel')}.`, `- What each consumer relies on: ${ph('fields, behaviours and timings, or a link to its contract tests')}.`, `- Changing this ICR: ${ph('who approves')}.`].join('\n');
    case 'Observability':
      return [`- Correlation identifier: ${ph('traceparent (W3C Trace Context)')}, created by ${ph('the sender')} and carried on every ${ph('message')}.`, `- Logs: each side logs ${ph('the identifier and the outcome')}, never ${ph('classified payloads')}.`, `- Metrics and alerts: ${ph('metric')} ${ph('threshold')} pages ${ph('team')}.`].join('\n');
    case 'Support and escalation':
      return [`| Party | Contact | Hours | Escalation |`, '|---|---|---|---|', `| ${typeof fm.provider?.owner === 'string' && fm.provider.owner ? fm.provider.owner : ph('provider team')} | ${typeof fm.provider?.contact === 'string' && fm.provider.contact ? fm.provider.contact : ph('contact')} | ${ph('hours')} | ${ph('next level')} |`, ...(Array.isArray(fm.consumers) ? fm.consumers : []).filter((c) => c && (c.owner || c.system)).map((c) => `| ${c.owner || c.system} | ${c.contact || ph('contact')} | ${ph('hours')} | ${ph('next level')} |`), '', `Severity levels and response targets: ${ph('Sev 1 (no exchange possible) n minutes; Sev 2 n hours; Sev 3 next business day')}.`].join('\n');
    case 'Acceptance criteria':
      return (['esp', 'cdc'].includes(pattern?.component) ? ACCEPTANCE_LOG_BASED : ACCEPTANCE_BY_INTERACTION[kind]).join('\n');
    case 'Related records':
      return [`- Pattern: ${pattern ? link(pattern) : ph('link to the pattern')}`, `- Decisions: ${ph('ADR ids and titles')}`].join('\n');
    case 'Open issues':
      return `- ${ph('question')} — owner: ${ph('name')}, by: ${ph('date')}`;
    default:
      return '';
  }
}

// ---------- choosing a pattern ----------

// A list line may begin with any bullet marker and any spacing: "- Pattern:", "*   Pattern:", "+ Pattern:".
const MARKER = '[ \\t]*(?:[-*+]|\\d+[.)])[ \\t]+';
const EMPH = '(?:\\*\\*|__|[*_])?'; // bold or italic around the label: "- **Pattern:**", "- **Pattern**:"
const CONTROLS_LINE = new RegExp(`^${MARKER}${EMPH}Pattern controls inherited${EMPH}:${EMPH}.*$`, 'mi');
const PATTERN_LINE = new RegExp(`^${MARKER}${EMPH}Pattern${EMPH}:${EMPH}.*$`, 'mi');

// The sections whose prompts depend on the pattern or the interaction.
const PROMPTED = ['Interaction', 'Interaction flows', 'Interface specification', 'Examples', 'Data', 'Security', 'Service levels', 'Error handling', 'Acceptance criteria'];

/** The prompts for a section, or the generated flow for Interaction flows. */
function promptsFor(title, model) {
  if (title === 'Interaction flows') return buildFlow(defaultFlowOptions(model.fm ?? {}, model.fm?.interaction)).markdown;
  return scaffoldFor(title, model);
}

const norm = (text) => text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
const linesOf = (text) => new Set(norm(text).split('\n').map((l) => l.trim()).filter(Boolean));

/**
 * Applies a pattern to the record: sets the pattern and, where the pattern implies one, the
 * interaction; then fills the sections that are still empty (Interaction, Security, Service levels,
 * Error handling) and keeps the pattern named in those that are not. Never overwrites text the author wrote.
 *
 * When the pattern changes what the prompts say (another interaction, boundary or kind of broker), a section that is
 * still exactly the prompt set that was inserted for the previous choice is replaced by the new one; a section the
 * author has started on is left alone, and is named in `stale` if it still holds prompt lines for the previous choice.
 * Returns what changed, for the status message.
 */
export function applyPattern(model, patternId) {
  const pattern = patternById(patternId);
  if (!pattern) return { changed: [], kept: [], stale: [] };
  const changed = [];
  const kept = [];
  const stale = [];
  // What each section's prompts were for the choice being replaced, to tell an untouched prompt set from the author's text.
  const before = Object.fromEntries(PROMPTED.map((t) => [t, promptsFor(t, model)]));
  const previousId = typeof model.fm.pattern?.id === 'string' ? model.fm.pattern.id : null;
  model.fm.pattern = { id: pattern.id, url: pattern.url };
  changed.push('pattern');
  // The interaction follows the pattern only if the one chosen does not already fit it: choosing a pattern from
  // the "suggested for ..." list must not quietly change what the author chose.
  const current = model.fm.interaction;
  if (current !== pattern.interaction && !pattern.alsoFits.includes(current)) { model.fm.interaction = pattern.interaction; changed.push('interaction'); }
  for (const title of ['Interaction', 'Security', 'Service levels', 'Error handling']) {
    const has = sectionIndex(model, title) >= 0 && getSection(model, title).trim();
    if (!has) {
      setSection(model, title, scaffoldFor(title, model));
      changed.push(`${title} (prompts)`);
    }
  }
  // A section that is exactly the old prompt set is refreshed; one the author has started is not, and is named when
  // it still holds a prompt line that the new choice no longer has.
  for (const title of PROMPTED) {
    const text = getSection(model, title);
    if (!text.trim() || sectionIndex(model, title) < 0) continue;
    const fresh = promptsFor(title, model);
    if (norm(fresh) === norm(before[title])) continue;
    if (norm(text) === norm(before[title])) {
      setSection(model, title, fresh);
      if (!changed.includes(`${title} (prompts)`)) changed.push(`${title} (prompts refreshed)`);
    } else {
      const now = linesOf(fresh);
      const old = [...linesOf(before[title])].filter((l) => !now.has(l) && !/^(?:[-*+]|\d+[.)])\s+[*_]{0,2}Pattern( controls inherited)?/i.test(l)); // the pattern lines are relinked below
      const have = linesOf(text);
      if (old.some((l) => have.has(l))) stale.push(title);
    }
  }
  // A line the author has already written keeps all of their words: only the pattern link in it is changed, and
  // only when it is a pattern link or the unreplaced prompt. A line worded some other way is left as it is, and reported.
  // Every matching line is relinked (a record may name the pattern twice), wherever it sits outside a code fence.
  const security = getSection(model, 'Security');
  if (security.trim()) {
    const r = relink(security, CONTROLS_LINE, pattern, '<link to the pattern>', previousId);
    if (!r.lines) {
      if (PATTERN_LINK.test(security)) kept.push('Security: a pattern is linked in text that is not a "Pattern controls inherited" list line, so no line was added and the link was left as you wrote it; check it');
      else {
        setSection(model, 'Security', `${security.trimEnd()}\n${inheritedLine(pattern)}`);
        changed.push('Security (controls inherited line added)');
      }
    } else {
      if (r.text !== security) { setSection(model, 'Security', r.text); changed.push('Security (pattern link)'); }
      if (r.unlinked) kept.push(`Security: ${r.unlinked === 1 ? 'a "Pattern controls inherited" line has' : `${r.unlinked} "Pattern controls inherited" lines have`} no pattern link to update, so ${r.unlinked === 1 ? 'it was' : 'they were'} left as you wrote ${r.unlinked === 1 ? 'it' : 'them'}`);
    }
  }
  for (const title of ['Interaction', 'Related records']) {
    const text = getSection(model, title);
    if (!text.trim()) continue;
    const r = relink(text, PATTERN_LINE, pattern, title === 'Interaction' ? '<pattern>' : '<link to the pattern>', previousId);
    if (!r.lines) {
      // Interaction is written for every record, so a missing line is worth saying; Related records is optional free text.
      if (PATTERN_LINK.test(text)) kept.push(`${title}: a pattern is linked in text that is not a "Pattern:" list line, so the link was left as you wrote it; check it`);
      else if (title === 'Interaction') kept.push('Interaction: it has no "- Pattern:" line, so the pattern is not named there; add one with the link');
      continue;
    }
    if (r.text !== text) { setSection(model, title, r.text); changed.push(`${title} (pattern link)`); }
    if (r.unlinked) kept.push(`${title}: ${r.unlinked === 1 ? 'the "Pattern" line has' : `${r.unlinked} "Pattern" lines have`} no pattern link to update, so ${r.unlinked === 1 ? 'it was' : 'they were'} left as you wrote ${r.unlinked === 1 ? 'it' : 'them'}`);
  }
  return { changed, kept, stale, pattern, component: componentBySlug(pattern.component) };
}

// A pattern link, on either address the site answers to.
const PATTERN_LINK = /\[[^\]\n]*\]\(https?:\/\/(?:www\.)?itarchitecturepatterns\.net\/patterns\/[A-Za-z0-9-]+\)/;
const PATTERN_LINK_G = new RegExp(PATTERN_LINK.source, 'g');

/**
 * Updates the pattern link (or the unreplaced prompt `placeholder`) in every line of `text` that matches `lineRe`, and
 * nothing else: on a line with several links, the one to the pattern chosen before (`previousId`), or the first. Lines inside a code fence are left alone. Returns the new text, how many lines matched, and how many of
 * those had neither a pattern link nor the prompt (and so were left as the author wrote them).
 */
function relink(text, lineRe, pattern, placeholder, previousId = null) {
  const masked = blank(text, fences(text).map((b) => [b.start, b.end]));
  const target = link(pattern);
  let out = '';
  let at = 0;
  let lines = 0;
  let unlinked = 0;
  for (const m of masked.matchAll(new RegExp(lineRe.source, 'gmi'))) {
    const line = text.slice(m.index, m.index + m[0].length);
    lines++;
    let next = line;
    const links = [...line.matchAll(PATTERN_LINK_G)];
    if (links.length) {
      // Only the link that names the pattern is changed: the ones to the pattern chosen before if the line has any,
      // otherwise the first. A line such as "Pattern: [A](...), with [B](...) feeding it" keeps its [B].
      const mine = previousId ? links.filter((l) => l[0].endsWith(`/patterns/${previousId})`)) : [];
      const chosen = new Set((mine.length ? mine : [links[0]]).map((l) => l.index));
      next = line.replace(PATTERN_LINK_G, (found, offset) => (chosen.has(offset) ? target : found));
    }
    else if (line.includes(placeholder)) next = line.replace(placeholder, () => target);
    else unlinked++;
    out += text.slice(at, m.index) + next;
    at = m.index + m[0].length;
  }
  return { text: out + text.slice(at), lines, unlinked };
}

export const patternNote = (patternId) => COMPONENT_NOTES[patternById(patternId)?.component] ?? '';
