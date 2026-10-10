// The interaction-flow helper: builds a starter Mermaid sequenceDiagram (with accTitle and accDescr)
// and the same sequence as numbered steps, from the parties entered in the front matter.
//
// The diagram is a starting point, not a finished flow: it draws the main exchange and the main
// failure for the chosen interaction, using the party names and the message names given. The author
// then edits it to match the operations, events and errors in the other sections.

import { fences, firstDiagramLine } from './lint.js';

export const MAX_PARTICIPANTS = 7;

/** Text that is safe in a Mermaid message or label: no ";" "#" or "%%", one line. */
export function clean(text) {
  return String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/[;#]/g, ',').replace(/%%/g, '%').replace(/\s+/g, ' ').trim();
}
const nameOf = (text, fallback) => clean(text).replace(/:/g, ' -') || fallback;

/** Labels and defaults for each interaction: what the three message fields mean. */
export const FLOW_KINDS = {
  'sync-request-response': { via: 'API gateway', main: ['Request', 'request (credentials, identifiers)'], ok: ['Success reply', '200 OK with the result'], fail: ['Failure reply', 'error response (4xx or 5xx)'] },
  'async-event': { via: 'Event broker', main: ['Event', 'event'], ok: ['Acknowledgement', 'acknowledge'], fail: ['Rejection', 'reject'] },
  'async-message': { via: 'Message queue', main: ['Message', 'message'], ok: ['Acknowledgement', 'acknowledge'], fail: ['Rejection', 'reject'] },
  stream: { via: 'Event stream', main: ['Record', 'record'], ok: ['Read result', 'records, in order'], fail: ['Recovery', 'replay from the last committed offset'] },
  'batch-file': { via: 'File transfer service', main: ['File', 'file with its checksum'], ok: ['Receipt', 'receipt (accepted)'], fail: ['Rejection', 'rejection with the reason'] },
};

/** Options for a fresh flow, from the front matter. */
export function defaultFlowOptions(fm, interaction) {
  const kind = FLOW_KINDS[interaction] ?? FLOW_KINDS['sync-request-response'];
  const consumers = (Array.isArray(fm?.consumers) ? fm.consumers : []).map((c) => c?.system).filter((s) => typeof s === 'string' && s.trim());
  return {
    interaction: FLOW_KINDS[interaction] ? interaction : 'sync-request-response',
    provider: (typeof fm?.provider?.system === 'string' && fm.provider.system.trim()) || 'Provider',
    consumers: consumers.length ? consumers.slice(0, 3) : ['Consumer'],
    useVia: true,
    via: kind.via,
    sender: interaction === 'async-event' || interaction === 'stream' ? 'provider' : 'consumer',
    main: kind.main[1],
    ok: kind.ok[1],
    fail: kind.fail[1],
    failure: true,
    // Event streaming and change data capture are log-based: consumers pull from an offset and own retries.
    logBased: /^int-(esp|cdc)-/.test(typeof fm?.pattern?.id === 'string' ? fm.pattern.id : ''),
  };
}

/** Aliases for the participants: C, C2, C3 for consumers, V for the intermediary, P for the provider. */
function participantsOf(o) {
  const list = [];
  const used = new Set();
  const take = (want) => { let a = want; let n = 2; while (used.has(a)) a = `${want}${n++}`; used.add(a); return a; };
  o.consumers.forEach((name) => list.push({ role: 'consumer', alias: take('C'), name: nameOf(name, 'Consumer') }));
  if (o.useVia || o.interaction === 'stream') list.push({ role: 'via', alias: take('V'), name: nameOf(o.via, 'Intermediary') });
  list.push({ role: 'provider', alias: take('P'), name: nameOf(o.provider, 'Provider') });
  return list;
}

/**
 * Builds the flow. Returns { mermaid, steps, accTitle, accDescr, participants, markdown, warnings }.
 * `markdown` is the fenced diagram followed by the numbered steps, ready to put in the section.
 */
export function buildFlow(options) {
  const o = { ...options };
  const warnings = [];
  // Only the kinds of exchange that fan out to every consumer (an event, a stream) draw them all. A request, a message
  // or a file is drawn for the first consumer, so that no participant is declared that takes no part in a message.
  if (!['async-event', 'stream'].includes(o.interaction) && o.consumers.length > 1) {
    o.consumers = o.consumers.slice(0, 1);
    warnings.push('This kind of exchange is drawn for the first consumer only; any other consumer takes part in the same way.');
  }
  if (o.interaction === 'async-event' && o.logBased && !o.useVia) {
    o.logBased = false;
    warnings.push('A log-based stream needs the intermediary (the broker or stream) to be drawn, so the log-based option is ignored while it is off.');
  }
  let parts = participantsOf(o);
  if (parts.length > MAX_PARTICIPANTS) {
    o.consumers = o.consumers.slice(0, MAX_PARTICIPANTS - parts.filter((p) => p.role !== 'consumer').length);
    parts = participantsOf(o);
    warnings.push(`A diagram holds at most ${MAX_PARTICIPANTS} participants, so only the first consumers are drawn.`);
  }
  const by = (role) => parts.filter((p) => p.role === role);
  const C = by('consumer')[0];
  const P = by('provider')[0];
  const V = by('via')[0];
  const main = clean(o.main) || 'message';
  const ok = clean(o.ok) || 'acknowledge';
  const fail = clean(o.fail) || 'reject';
  const lines = [];
  const steps = [];
  const call = (a, b, text) => lines.push(`${a.alias}->>${b.alias}: ${text}`);
  const reply = (a, b, text) => lines.push(`${a.alias}-->>${b.alias}: ${text}`);
  const self = (a, text) => lines.push(`${a.alias}->>${a.alias}: ${text}`);
  const indentFrom = (n) => { for (let i = n; i < lines.length; i++) lines[i] = `  ${lines[i]}`; };
  /** alt <a> ... else <b> ... end, with each branch indented one level. */
  const alt = (a, fnA, b, fnB) => {
    lines.push(`alt ${a}`);
    let n = lines.length; fnA(); indentFrom(n);
    lines.push(`else ${b}`);
    n = lines.length; fnB(); indentFrom(n);
    lines.push('end');
  };
  const opt = (a, fn) => { lines.push(`opt ${a}`); const n = lines.length; fn(); indentFrom(n); lines.push('end'); };
  const names = (list) => list.map((p) => p.name).join(' and ');

  let accTitle;
  let accDescr;

  switch (o.interaction) {
    case 'async-event': {
      const all = by('consumer');
      accTitle = `${P.name} publishes an event to ${names(all)}`;
      if (o.logBased && V) {
        // A log-based stream (event streaming, change data capture): consumers pull from an offset, so the consumer
        // owns retries and the dead-letter topic. The broker does not redeliver to a consumer. Every consumer
        // reads, and commits, so the text says only what the lines draw.
        const one = all.length === 1;
        call(P, V, `append ${main}`);
        reply(V, P, 'acknowledge');
        steps.push(`${P.name} appends the ${main} to ${V.name}, which acknowledges it.`);
        steps.push(one ? `${C.name} reads from the last offset it committed, and ${V.name} returns the ${main}.` : `${names(all)} each read from the last offset they committed, and ${V.name} returns the ${main} to each, in order.`);
        for (const c of all) {
          call(c, V, 'read from the last committed offset');
          reply(V, c, `${main}, in order`);
          if (o.failure) alt('processed', () => call(c, V, 'commit the offset'), 'processing fails', () => { self(c, 'retry with backoff'); call(c, V, 'write to the dead-letter topic, then commit the offset'); });
          else call(c, V, 'commit the offset');
        }
        const who = one ? C.name : 'a consumer';
        if (o.failure) {
          steps.push(`If ${who} processes the ${main}, it commits the offset.`);
          steps.push(`If processing fails, ${who} retries with backoff, then writes the ${main} to the dead-letter topic itself and commits the offset: ${V.name} does not redeliver.`);
        } else steps.push(one ? `${C.name} commits the offset.` : 'Each consumer commits its offset.');
        accTitle = `${names(all)} read events that ${P.name} appends to ${V.name}`;
        accDescr = `${P.name} appends the ${main} to ${V.name}. ${one ? `${C.name} reads it from its last committed offset` : `${names(all)} read it from their last committed offset`}. ${o.failure ? `${one ? 'The consumer commits' : 'Each consumer commits'} its offset once it has processed the record. If processing fails it retries with backoff, writes the record to a dead-letter topic itself and then commits.` : `${one ? 'The consumer commits' : 'Each consumer commits'} its offset.`}`;
        break;
      }
      // Not log-based: the intermediary (when drawn) delivers to every consumer, and without one the provider
      // publishes to every consumer itself. Every consumer then answers, so every participant takes part.
      const one = all.length === 1;
      if (V) {
        call(P, V, `publish ${main}`);
        steps.push(`${P.name} sends the ${main} to ${V.name}.`);
        reply(V, P, 'acknowledge');
        steps.push(`${V.name} acknowledges it to ${P.name}.`);
        for (const c of all) call(V, c, `deliver ${main}`);
        steps.push(`${V.name} delivers the ${main} to ${names(all)}.`);
      } else {
        for (const c of all) call(P, c, `publish ${main}`);
        steps.push(`${P.name} sends the ${main} to ${names(all)}.`);
      }
      const hub = V ?? P;
      for (const c of all) {
        if (o.failure) alt('processed', () => reply(c, hub, ok), 'processing fails', () => { reply(c, hub, fail); self(hub, 'retry with backoff, then dead-letter'); });
        else reply(c, hub, ok);
      }
      const who = one ? C.name : 'a consumer';
      if (o.failure) {
        steps.push(`If ${who} processes the ${main}, it replies "${ok}".`);
        steps.push(`If processing fails, ${who} replies "${fail}" and ${hub.name} retries with backoff, then moves the ${main} to the dead-letter queue.`);
      } else {
        steps.push(one ? `${C.name} replies "${ok}".` : `Each consumer replies "${ok}".`);
      }
      accDescr = `${P.name} publishes the ${main}${V ? ` to ${V.name}, which delivers it to ${names(all)}` : ` to ${names(all)}`}. ${o.failure ? 'If processing fails, it is retried with backoff and then moved to a dead-letter queue.' : `${one ? 'The consumer acknowledges' : 'Each consumer acknowledges'} it.`}`;
      break;
    }
    case 'async-message': {
      const [S, R] = o.sender === 'provider' ? [P, C] : [C, P];
      accTitle = `${S.name} sends a message to ${R.name}`;
      if (V) {
        call(S, V, `send ${main}`);
        reply(V, S, 'accepted');
        call(V, R, `deliver ${main}`);
        steps.push(`${S.name} sends the ${main} to ${V.name}, which confirms it has accepted it.`);
        steps.push(`${V.name} delivers the ${main} to ${R.name}.`);
      } else {
        call(S, R, `send ${main}`);
        steps.push(`${S.name} sends the ${main} to ${R.name}.`);
      }
      const hub = V ?? S;
      if (o.failure) {
        alt('processed', () => reply(R, hub, ok), 'processing fails', () => { reply(R, hub, fail); self(hub, 'retry with backoff, then dead-letter'); });
        steps.push(`If ${R.name} processes the ${main}, it replies "${ok}".`);
        steps.push(`If processing fails, ${R.name} replies "${fail}" and ${hub.name} retries with backoff, then moves the ${main} to the dead-letter queue.`);
      } else {
        reply(R, hub, ok);
        steps.push(`${R.name} replies "${ok}".`);
      }
      accDescr = `${S.name} sends the ${main}${V ? ` through ${V.name}` : ''} to ${R.name}. ${o.failure ? `If ${R.name} cannot process it, the ${main} is retried with backoff and then moved to a dead-letter queue.` : `${R.name} acknowledges it.`}`;
      break;
    }
    case 'stream': {
      const all = by('consumer');
      const one = all.length === 1;
      accTitle = `${names(all)} ${one ? 'reads' : 'read'} the stream written by ${P.name}`;
      call(P, V, `append ${main}`);
      steps.push(`${P.name} appends each ${main} to ${V.name}.`);
      steps.push(one ? `${C.name} reads from the last offset it committed, and ${V.name} returns "${ok}".` : `${names(all)} each read from the last offset they committed, and ${V.name} returns "${ok}" to each.`);
      // Every consumer is drawn doing what the text says: reading, and committing. Consumers pull from an offset, so a
      // failed record is the consumer's to retry and dead-letter; the stream does not redeliver.
      for (const c of all) {
        call(c, V, 'read from the last committed offset');
        reply(V, c, ok);
        if (o.failure) {
          alt('processed', () => call(c, V, 'commit the offset'), 'processing fails', () => { self(c, 'retry with backoff'); call(c, V, 'write to the dead-letter topic, then commit the offset'); });
          opt('the consumer falls behind or restarts', () => call(c, V, fail));
        } else call(c, V, 'commit the offset');
      }
      const who = one ? C.name : 'a consumer';
      if (o.failure) {
        steps.push(`If ${who} processes the ${main}, it commits the offset. If processing fails, it retries with backoff, writes the ${main} to the dead-letter topic itself and commits the offset: ${V.name} does not redeliver.`);
        steps.push(`If ${who} falls behind or restarts, it asks ${V.name} to "${fail}".`);
      } else steps.push(one ? `${C.name} commits the offset.` : 'Each consumer commits its offset.');
      accDescr = `${P.name} appends records to ${V.name} and ${one ? `${C.name} reads them in order from its last committed offset` : `${names(all)} read them in order from their last committed offset`}. ${o.failure ? `${one ? 'The consumer commits' : 'Each consumer commits'} its offset once it has processed a record. A record that fails is retried by the consumer and then written to a dead-letter topic, and a consumer that falls behind or restarts replays from its last committed offset.` : `${one ? 'The consumer commits' : 'Each consumer commits'} its offset.`}`;
      break;
    }
    case 'batch-file': {
      const [S, R] = o.sender === 'provider' ? [P, C] : [C, P];
      accTitle = `${S.name} sends a file to ${R.name}`;
      const hub = V ?? R;
      call(S, hub, `upload ${main}`);
      self(hub, 'check name, checksum and format');
      steps.push(`${S.name} uploads the ${main} to ${hub.name}.`);
      steps.push(`${hub.name} checks the file name, checksum and format.`);
      if (o.failure) {
        alt('checks pass', () => { if (V) call(V, R, 'make the file available'); reply(hub, S, ok); }, 'checks fail', () => { reply(hub, S, fail); self(hub, 'quarantine the file'); });
        steps.push(`If the checks pass, ${hub.name} ${V ? `makes the file available to ${R.name} and ` : ''}sends ${S.name} "${ok}".`);
        steps.push(`If they fail, ${hub.name} sends ${S.name} "${fail}" and quarantines the file.`);
      } else {
        if (V) call(V, R, 'make the file available');
        reply(hub, S, ok);
        steps.push(`${hub.name} ${V ? `makes the file available to ${R.name} and ` : ''}sends ${S.name} "${ok}".`);
      }
      accDescr = `${S.name} uploads the file to ${hub.name}, which checks its name, checksum and format. ${o.failure ? `If the checks pass ${V ? `the file is made available to ${R.name} and ` : ''}the sender receives a receipt; if they fail it receives a rejection with the reason and the file is quarantined.` : `${V ? `The file is made available to ${R.name} and the` : 'The'} sender receives a receipt.`}`;
      break;
    }
    default: {
      accTitle = `${C.name} calls ${P.name}`;
      const front = V ?? P;
      call(C, front, main);
      steps.push(`${C.name} sends the ${main} to ${front.name}.`);
      if (V) { call(V, P, main); steps.push(`${V.name} checks it and passes it to ${P.name}.`); }
      const answer = (text) => { reply(P, V ?? C, text); if (V) reply(V, C, text); };
      if (o.failure) {
        alt('the request is accepted', () => answer(ok), 'the request fails', () => answer(fail));
        steps.push(`If ${P.name} accepts it, it answers "${ok}"${V ? ` through ${V.name}` : ''}.`);
        steps.push(`If it cannot, it answers "${fail}", and ${C.name} handles the error as set out in Error handling.`);
      } else {
        answer(ok);
        steps.push(`${P.name} answers "${ok}"${V ? ` through ${V.name}` : ''}.`);
      }
      accDescr = `${C.name} sends the request${V ? ` through ${V.name}` : ''} to ${P.name}. ${o.failure ? `${P.name} answers with the result, or with an error that ${C.name} must handle.` : `${P.name} answers with the result.`}`;
    }
  }

  accTitle = clean(accTitle);
  accDescr = clean(accDescr);
  const mermaid = [
    'sequenceDiagram',
    `  accTitle: ${accTitle}`,
    `  accDescr: ${accDescr}`,
    '',
    ...parts.map((p) => `  participant ${p.alias} as ${p.name}`),
    ...lines.map((l) => `  ${l}`),
  ].join('\n');
  const markdown = '```mermaid\n' + mermaid + '\n```\n\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return { mermaid, steps, accTitle, accDescr, participants: parts, markdown, warnings };
}

// ---------- reading diagrams that are already written ----------

/** The Mermaid sequence diagrams in a section's text, as { source, participants, hasTitle, hasDescr }. */
export function diagramsIn(text) {
  return fences(text)
    .filter((b) => b.info.split(/\s+/)[0] === 'mermaid')
    .map((b) => b.body)
    .filter((d) => /^sequenceDiagram\b/.test(firstDiagramLine(d)))
    .map((source) => ({ source, participants: participantsIn(source) }));
}

/** The participants of a sequence diagram: declared ones, plus any named only in messages. */
export function participantsIn(source) {
  const names = new Set();
  for (const m of source.matchAll(/^[ \t]*(?:participant|actor)[ \t]+([^\s]+)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^[ \t]*([A-Za-z_]\w*)[ \t]*(?:-->>|->>|-->|->|--x|-x|--\)|-\))[+-]?[ \t]*([A-Za-z_]\w*)[ \t]*:/gm)) { names.add(m[1]); names.add(m[2]); }
  return [...names];
}
