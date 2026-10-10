// Guidance for each part of an ICR, taken from the Integration Contract Record specification v0.2 (DRAFT):
// the "why this matters" line, what the section must hold, and the specification's "common failure".
// The wording is short on purpose; the specification is the authority.

export const INTERACTIONS = [
  {
    id: 'sync-request-response',
    label: 'Synchronous request and response',
    text: 'The caller waits for the answer. A REST, SOAP or gRPC call, usually through an API gateway.',
    examples: 'Look up a booking, create an order, validate an address.',
  },
  {
    id: 'async-event',
    label: 'Asynchronous event',
    text: 'The provider announces that something happened; any number of consumers react in their own time.',
    examples: 'A meter reading is published, a payment is settled, a webhook fires.',
  },
  {
    id: 'async-message',
    label: 'Asynchronous message',
    text: 'One system sends a message for another to process later, usually through a queue. The sender does not wait for the result.',
    examples: 'Send a notification, submit a job, hand a command to a back-office system.',
  },
  {
    id: 'stream',
    label: 'Event stream',
    text: 'A continuous, ordered flow of records that consumers read from an offset and can replay.',
    examples: 'Change data capture, telemetry, a Kafka topic feeding several systems.',
  },
  {
    id: 'batch-file',
    label: 'Batch or file transfer',
    text: 'Files or bulk extracts move on a schedule or on demand, and are checked before they are accepted.',
    examples: 'A nightly SFTP drop, an ETL load, a monthly regulatory return.',
  },
];

export const STATUSES = [
  { id: 'draft', text: 'being written' },
  { id: 'proposed', text: 'under review by the parties' },
  { id: 'agreed', text: 'signed off, not yet live (no open issues allowed)' },
  { id: 'active', text: 'live (no open issues allowed)' },
  { id: 'deprecated', text: 'live, being replaced; the replacement and date are in Change and versioning' },
  { id: 'retired', text: 'no longer live' },
];

export const INTERFACE_TYPES = [
  { id: 'openapi', text: 'OpenAPI: the shape of a REST API' },
  { id: 'asyncapi', text: 'AsyncAPI: the shape of an event-driven or message API' },
  { id: 'odcs', text: 'Open Data Contract Standard: a data product' },
  { id: 'cloudevents', text: 'CloudEvents: the envelope of an event' },
  { id: 'wsdl', text: 'WSDL: a SOAP service' },
  { id: 'json-schema', text: 'JSON Schema: the shape of a message or file record' },
  { id: 'other', text: 'Something else, described by its link' },
];

/** Help for each front matter field: what it is, and a short example. */
export const FIELD_HELP = {
  id: { hint: 'A unique, stable identifier that starts with ICR-. It does not change when the contract does.', example: 'ICR-0001, or ICR-AB-0001', why: 'Other records and tools link to the contract by this id.' },
  title: { hint: 'The short name of the integration.', example: 'Partner booking API', why: 'It is the heading readers see first.' },
  status: { hint: 'Where the contract is in its life.', why: 'Agreed and active contracts must have no open issues.' },
  version: { hint: 'The version of this contract (not of the interface), as a semantic version.', example: '1.0.0', why: 'Consumers can tell which wording they agreed to.' },
  date: { hint: 'The date of this version, as year-month-day.', example: '2026-09-19', why: 'It shows how current the agreement is.' },
  pattern: { hint: 'The integration pattern this follows. Choosing one on the first step fills these in.', example: 'int-api-external', why: 'The pattern carries the architecture and security controls this contract inherits instead of restating.' },
  interaction: { hint: 'The dominant style of exchange. A contract does not mix styles: split it instead.', why: 'It sets which questions the later sections must answer.' },
  provider: { hint: 'The system that offers the interface, the team accountable for it, and how to reach them.', example: 'Reservations Service · Guest Platforms team · guest-platforms@example.org', why: 'An integration with no accountable team has no one to fix it.' },
  consumers: { hint: 'The systems that use the interface. At least one.', why: 'The provider needs to know whom a change affects.' },
  interfaces: { hint: 'The machine-readable specifications. They are authoritative for the shape of messages, so the contract points to them and does not restate them. May be empty for a file exchange with no schema.', why: 'Where the contract and a specification disagree about shape, the specification wins.' },
  classification: { hint: 'How sensitive the data is, under your organisation’s own scheme: a level such as OFFICIAL, not a kind of data. Whether personal information crosses is the next question.', example: 'OFFICIAL, or Commercial-in-confidence', why: 'It decides who may see the data and where it may be kept.' },
  personalInformation: { hint: 'Does personal information cross this interface?', why: 'It brings in privacy duties for both parties.' },
  decisions: { hint: 'Architecture decision records that explain why the integration takes this form. Optional.', example: 'ADR-0012', why: 'A reader can follow the reasoning.' },
  supersedes: { hint: 'The id of the contract this one replaces. Optional.', example: 'ICR-0007', why: 'It keeps the history of a replaced integration.' },
  reviewBy: { hint: 'The date by which the contract must next be reviewed. Optional.', example: '2027-03-31', why: 'Agreements drift unless someone is asked to look again.' },
};

export const SECTION_GUIDE = [
  {
    title: 'Purpose', slug: 'purpose', required: true,
    summary: 'Why this integration exists, in business terms.',
    why: 'It tells a reviewer whether the integration earns its cost, and tells an operator what to protect when it fails.',
    points: ['The business capability it serves.', 'What breaks for the business if it stops.', 'Two to four sentences.'],
    failure: 'Describing the technology instead of the purpose.',
  },
  {
    title: 'Parties and responsibilities', slug: 'parties', required: true,
    summary: 'Who is responsible for what.',
    why: 'Naming who builds, runs, monitors, pays for and changes each end settles the question before an outage does.',
    points: ['A table with a row for the provider, each consumer, and any intermediary such as a gateway team.', 'For each: building, operating, monitoring, paying for, changing.'],
    failure: 'Naming systems but not the team accountable for each.',
  },
  {
    title: 'Interaction', slug: 'interaction', required: true,
    summary: 'The pattern, the trigger, the volume and the ordering.',
    why: 'Volume, frequency and ordering decide the design, and a number can be tested where "real-time" cannot.',
    points: ['The pattern, and any deliberate deviation from it with the reason.', 'Direction, and what triggers an exchange (a user action, an event, a schedule).', 'Volume and frequency, typical and peak, with units.', 'Ordering: whether it matters, and what guarantees it.'],
    failure: '"Real-time" without a number.',
  },
  {
    title: 'Interaction flows', slug: 'flows', required: true,
    summary: 'A Mermaid sequence diagram of the exchange, with the same steps in words.',
    why: 'A sequence over time shows the order of the calls and what happens on failure, so the retry and the dead letter are seen before production.',
    points: ['At least one diagram for the main exchange, and a failure drawn as an alt branch or a second diagram.', 'One participant for each party in Parties and responsibilities, plus any gateway or queue that matters. Seven or fewer.', 'Message and error names match the operations, events and errors in Interface specification and Error handling.', 'Every diagram has an accTitle and an accDescr, and numbered steps beneath say the same in words.', 'For a batch file: draw the upload, the checks, the receipt and the rejection.'],
    failure: 'Drawing only the happy path, so the retry and the dead letter appear nowhere until production.',
  },
  {
    title: 'Interface specification', slug: 'interface', required: true,
    summary: 'The machine-readable specifications, and where the authoritative copy lives.',
    why: 'The specification is the authority for the shape of messages; the contract points at it so the two cannot drift apart.',
    points: ['Each specification from the front matter, with a sentence on what it covers.', 'Where the authoritative copy lives.', 'The API design standard followed, if any.', 'For a file exchange with no schema: format, naming convention, encoding and structure.'],
  },
  {
    title: 'Examples', slug: 'examples', required: true,
    summary: 'One example of the main exchange and one of the main error.',
    why: 'The first consumer to copy an example finds out whether the specification would reject it; good examples are also the fixtures of the tests.',
    points: ['One example of the main exchange: a request and its response, an event with its envelope, or a file excerpt with its name.', 'One example of the main error, as the consumer receives it.', 'Each valid against the specification, and where a tool can check that, an acceptance criterion says it is checked.', 'No real personal data.'],
    failure: 'Examples written by hand that the specification would reject.',
  },
  {
    title: 'Environments and onboarding', slug: 'environments', required: false,
    summary: 'Where a new consumer can try the interface, and how it joins.',
    why: 'A new consumer needs somewhere safe to try the interface, and a smallest call that proves it is connected.',
    points: ['Each environment (test, production): where it is, and how it differs.', 'Test data or a sandbox, and what it does not simulate.', 'Access: how a new consumer asks, who approves, how long it takes.', 'First call: the smallest exchange that shows a new consumer is connected.'],
  },
  {
    title: 'Data', slug: 'data', required: true,
    summary: 'What data crosses, how it is classified, where it lives and for how long.',
    why: 'Classification and personal information decide who may see the data, where it may be stored and how long it may be kept.',
    points: ['The business entities that cross the interface.', 'Classification, and whether personal information is included; if so, which fields and the basis for sharing.', 'Data residency or hosting constraints.', 'Retention: how long each party keeps the data.', 'Data quality, for a batch file or a stream: the rules the data must meet and who is told when they are broken.'],
    failure: 'Classification recorded but not which fields drive it.',
  },
  {
    title: 'Security', slug: 'security', required: true,
    summary: 'Authentication, authorisation, transport, network path, and the controls inherited from the pattern.',
    why: 'Reference the pattern’s controls instead of restating them, so they cannot drift, and write down only what this integration adds.',
    points: ['Authentication of each party, and how credentials are issued and rotated.', 'Authorisation: what each consumer may and may not do.', 'Transport: protocol and minimum TLS version.', 'Network path: public internet, private link or dedicated connection; allow-listing.', 'Controls inherited from the pattern (reference them), and any extra controls this integration adds.'],
  },
  {
    title: 'Service levels', slug: 'service-levels', required: true,
    summary: 'Each promise as a measurable objective, and how it is measured.',
    why: 'A promise with no measurement point cannot be held to account.',
    points: ['Availability, for example 99.9% monthly, measured at the gateway.', 'Latency, for example p95 ≤ 300 ms at the gateway.', 'Throughput limits and what happens beyond them, for example 50 requests/s per consumer, then HTTP 429.', 'Freshness, for data, for example events available within 60 s of the source change.', 'How a consumer learns its limit and its use of it.', 'Recovery time and recovery point for the integration as a whole.', 'The support hours that apply to these promises.'],
    failure: 'Objectives with no measurement point.',
  },
  {
    title: 'Error handling', slug: 'errors', required: true,
    summary: 'Errors, timeouts, retries, idempotency, failed messages and recovery.',
    why: 'Retries without idempotency turn a transient failure into a duplicate.',
    points: ['The errors the provider returns or emits, and what each means to the consumer.', 'Timeouts on each side.', 'Retries: who retries, how many times, with what backoff.', 'Idempotency: how duplicates are recognised and made harmless.', 'Poison messages or failed files: where they go (dead-letter, quarantine) and who is alerted.', 'Partial failure and recovery: how a consumer catches up after an outage.'],
    failure: 'Retries specified without idempotency, which turns a transient failure into a duplicate.',
  },
  {
    title: 'Change and versioning', slug: 'change', required: true,
    summary: 'How the interface and this contract change.',
    why: 'Consumers rely on more than the schema; saying what they rely on tells the provider what it can change without notice.',
    points: ['The versioning scheme for the interface.', 'What counts as a breaking change.', 'Minimum notice before a breaking change or deprecation, and how consumers are told.', 'What each named consumer relies on (fields, behaviours, timings), or a link to its contract tests.', 'How this contract itself is changed and approved.', 'Optionally a change log, as a ### sub-heading of this section.'],
  },
  {
    title: 'Observability', slug: 'observability', required: true,
    summary: 'Correlation, logs, metrics and alerts on both sides.',
    why: 'A shared correlation identifier lets either side trace a failure through the other’s system.',
    points: ['The correlation identifier and how it propagates.', 'What each side logs (without logging classified payloads unnecessarily).', 'Metrics and alerts, with thresholds, and who receives them.'],
    failure: 'Logging and alerting on the provider only, so a consumer-side failure is invisible.',
  },
  {
    title: 'Support and escalation', slug: 'support', required: true,
    summary: 'Whom to call, when, and what happens next.',
    why: 'When it breaks at night, someone must know who to call, how fast they respond and who is next.',
    points: ['Contacts for each party.', 'Support hours.', 'Incident severity levels and response targets.', 'The escalation path.'],
  },
  {
    title: 'Acceptance criteria', slug: 'acceptance', required: true,
    summary: 'Numbered, testable statements that must hold before the integration is agreed.',
    why: 'This is the section a developer or an AI agent turns into tests; a criterion that cannot become a test is reworded.',
    points: ['A numbered list (1. 2. 3.), not bullets.', 'Each expressible as an automated test, a synthetic check or an alert.', 'Each says how it is proved ("Proved by: ...").'],
  },
  {
    title: 'Related records', slug: 'related', required: false,
    summary: 'Decisions, other contracts, risks and the pattern page.',
    why: 'It lets a reader follow the reasoning and see what else is affected.',
    points: ['Architecture decisions.', 'Other ICRs this depends on or affects.', 'Risk items, and the pattern page.'],
  },
  {
    title: 'Open issues', slug: 'open-issues', required: false,
    summary: 'Unresolved questions, each with an owner and a date.',
    why: 'An ICR with open issues must not be agreed or active, so the list has to be honest and kept short.',
    points: ['Each issue with an owner and a date.', 'Remove the section when nothing is open.'],
  },
];

export const sectionBySlug = (slug) => SECTION_GUIDE.find((s) => s.slug === slug) ?? null;
export const sectionByTitle = (title) => SECTION_GUIDE.find((s) => s.title === title) ?? null;
