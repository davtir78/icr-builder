// The integration patterns of IT Architecture Patterns (https://www.itarchitecturepatterns.net/patterns),
// as a static list, so the builder needs no network to offer them.
//
// Source:    the site's sitemap (https://www.itarchitecturepatterns.net/sitemap.xml) lists 33 pages whose id
//            starts "int-"; each title below was read from the page's <title> and is built, as the site
//            builds it, from the framework's two axes: "Integration <platform component> (<boundary>)".
// Retrieved: 2026-10-08
//
// The `interaction` of a pattern is this tool's suggestion, not something the pattern pages state: the
// patterns are chosen by boundary and platform component, and one component can carry more than one
// style of interaction (middleware carries both sync and async). `alsoFits` lists the other ICR
// `interaction` values that are reasonable for the component; the builder offers them and lets the
// author override. tests/patterns.test.js checks this list against the titles read on the retrieval date.

export const PATTERNS_SOURCE = {
  sitemap: 'https://www.itarchitecturepatterns.net/sitemap.xml',
  retrieved: '2026-10-08',
  baseUrl: 'https://www.itarchitecturepatterns.net/patterns/',
};

export const BOUNDARIES = [
  { id: 'internal', label: 'Internal', description: 'Both systems sit inside the organisation’s private network.' },
  { id: 'external', label: 'External', description: 'The integration crosses a trust boundary to a partner or third party.' },
  { id: 'cloud', label: 'Cloud', description: 'The counterparty is a SaaS or managed cloud service outside the network.' },
];

// Components in the order the site lists them. `slug` is the middle of the pattern id: int-<slug>-<boundary>.
export const COMPONENTS = [
  { slug: 'api', name: 'API Management', interaction: 'sync-request-response', alsoFits: [], summary: 'Request and response through an API gateway.' },
  { slug: 'middleware', name: 'Middleware Services', interaction: 'async-message', alsoFits: ['sync-request-response'], summary: 'An integration platform or service bus between the systems.' },
  { slug: 'esp', name: 'Event Streaming', interaction: 'async-event', alsoFits: ['stream'], summary: 'Events published to a broker and consumed by subscribers.' },
  { slug: 'etl', name: 'ETL / Batch Processing', interaction: 'batch-file', alsoFits: [], summary: 'Scheduled extract, transform and load jobs.' },
  { slug: 'filetransfer', name: 'Secure File Transfer', interaction: 'batch-file', alsoFits: [], summary: 'Files moved by SFTP or managed file transfer.' },
  { slug: 'cdc', name: 'Change Data Capture', interaction: 'stream', alsoFits: ['async-event', 'batch-file'], summary: 'Changes in a source database streamed to consumers.' },
  { slug: 'mdm', name: 'Master Data Management', interaction: 'async-event', alsoFits: ['sync-request-response', 'batch-file'], summary: 'Master data distributed from a golden source.' },
  { slug: 'workflow', name: 'Workflow & Orchestration', interaction: 'async-message', alsoFits: ['sync-request-response'], summary: 'A coordinator drives a multi-step process across systems.' },
  { slug: 'aiml', name: 'AI / ML Services', interaction: 'sync-request-response', alsoFits: ['batch-file'], summary: 'Calls to a model or AI service.' },
  { slug: 'native', name: 'Native Connectors', interaction: 'async-event', alsoFits: ['sync-request-response'], summary: 'A product’s own connector or webhook between two systems.' },
  { slug: 'manual', name: 'Manual / Ad-hoc Transfer', interaction: 'batch-file', alsoFits: [], summary: 'A person moves the data, for example by upload or e-mail.' },
];

export const PATTERNS = COMPONENTS.flatMap((c) => BOUNDARIES.map((b) => ({
  id: `int-${c.slug}-${b.id}`,
  title: `Integration ${c.name} (${b.label})`,
  component: c.slug,
  componentName: c.name,
  boundary: b.id,
  interaction: c.interaction,
  alsoFits: c.alsoFits,
  url: `${PATTERNS_SOURCE.baseUrl}int-${c.slug}-${b.id}`,
})));

export const patternById = (id) => PATTERNS.find((p) => p.id === id) ?? null;
export const componentBySlug = (slug) => COMPONENTS.find((c) => c.slug === slug) ?? null;
export const boundaryById = (id) => BOUNDARIES.find((b) => b.id === id) ?? null;

/** The patterns that suit an interaction value, best fit first. */
export function patternsFor(interaction) {
  const rank = (p) => (p.interaction === interaction ? 0 : p.alsoFits.includes(interaction) ? 1 : 2);
  return PATTERNS.filter((p) => rank(p) < 2).sort((a, b) => rank(a) - rank(b));
}
