// Evidence verification: re-run every query behind an investigation exactly as recorded (same
// datasource, query and absolute time range) and check that the data is still what the
// conclusions were based on. Data can legitimately change after the fact (late-arriving samples,
// backfills, retention, a deleted datasource); a finding resting on changed evidence should be
// re-examined rather than trusted.

import { digest } from './grafana';
import { DsQueryResponse, RawFrame } from './frames';
import { EvidenceRecord, Finding, GrafanaHttp, Hypothesis } from './types';

export type VerifyStatus = 'identical' | 'changed' | 'unavailable' | 'inconclusive';

export interface EvidenceCheck {
  id: string;
  status: VerifyStatus;
  datasource: string;
  query: string;
  before: { frames: number; rows: number };
  after?: { frames: number; rows: number };
  /** Why the query could not be re-run, or what "inconclusive" means for this record. */
  note?: string;
}

export interface VerificationResult {
  at: number;
  checks: EvidenceCheck[];
  counts: Record<VerifyStatus, number>;
  /** Findings and hypotheses citing evidence that changed or is no longer available. */
  affected: { findings: string[]; hypotheses: string[] };
}

/**
 * A digest of the data alone: frame names, fields, types, labels and values. Unlike the digest of
 * the raw response it ignores metadata that varies between identical queries (execution stats,
 * timings, notices) and the order in which series come back.
 */
export async function dataDigest(resp: DsQueryResponse | null | undefined, refId = 'A'): Promise<string> {
  const frames = resp?.results?.[refId]?.frames ?? [];
  const canonical = frames
    .map((f: RawFrame) => {
      const fields = f.schema?.fields ?? [];
      const values = f.data?.values ?? [];
      const extra = f.data as { entities?: unknown; nanos?: unknown } | undefined;
      return JSON.stringify({
        name: f.schema?.name ?? '',
        fields: fields.map((fd, i) => ({
          name: fd.name,
          type: fd.type ?? '',
          labels: fd.labels ? Object.fromEntries(Object.entries(fd.labels).sort(([a], [b]) => a.localeCompare(b))) : {},
          values: values[i] ?? [],
        })),
        entities: extra?.entities ?? null,
        nanos: extra?.nanos ?? null,
      });
    })
    .sort();
  return digest(`[${canonical.join(',')}]`);
}

export function frameCounts(resp: DsQueryResponse | null | undefined, refId = 'A') {
  const frames = resp?.results?.[refId]?.frames ?? [];
  return { frames: frames.length, rows: frames.reduce((n, f) => n + ((f.data?.values?.[0] as unknown[] | undefined)?.length ?? 0), 0) };
}

const queryText = (q: Record<string, unknown>) => String(q.expr ?? q.query ?? q.labelSelector ?? JSON.stringify(q)).slice(0, 300);

const errorText = (e: unknown) => {
  const a = e as { status?: number; data?: { message?: string; error?: string }; message?: string };
  const msg = a?.data?.message ?? a?.data?.error ?? a?.message ?? String(e);
  return `${a?.status ? `HTTP ${a.status}: ` : ''}${msg}`.slice(0, 300);
};

/** Re-runs one ledger entry and compares it with what was recorded. */
export async function checkEvidence(http: GrafanaHttp, e: EvidenceRecord, signal?: AbortSignal): Promise<EvidenceCheck> {
  const base = { id: e.id, datasource: e.datasource.name || e.datasource.uid, query: queryText(e.query), before: { frames: e.frames, rows: e.rows } };
  const from = Date.parse(e.from);
  const to = Date.parse(e.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { ...base, status: 'unavailable', note: 'the recorded time range is not valid' };
  }
  let resp: DsQueryResponse;
  try {
    resp = await http.post<DsQueryResponse>(
      '/api/ds/query',
      { queries: [{ refId: 'A', datasource: { uid: e.datasource.uid, type: e.datasource.type }, ...e.query }], from: String(from), to: String(to) },
      signal
    );
  } catch (err) {
    if (signal?.aborted) {
      throw err;
    }
    return { ...base, status: 'unavailable', note: errorText(err) };
  }
  const queryError = resp?.results?.A?.error;
  if (queryError) {
    return { ...base, status: 'unavailable', note: String(queryError).slice(0, 300) };
  }
  const after = frameCounts(resp);
  if (e.dataDigest) {
    return { ...base, after, status: (await dataDigest(resp)) === e.dataDigest ? 'identical' : 'changed' };
  }
  // Recorded before data digests existed: only the raw response digest is known.
  if ((await digest(JSON.stringify(resp ?? null))) === e.digest) {
    return { ...base, after, status: 'identical' };
  }
  if (after.frames !== e.frames || after.rows !== e.rows) {
    return { ...base, after, status: 'changed' };
  }
  return { ...base, after, status: 'inconclusive', note: 'recorded before Augur 1.9 (no data digest); the frame and row counts match' };
}

/**
 * Verifies a whole ledger, a few queries at a time, and lists the findings and hypotheses that
 * cite evidence (E#) which changed or is no longer available.
 */
export async function verifyEvidence(
  http: GrafanaHttp,
  ledger: EvidenceRecord[],
  opts: { signal?: AbortSignal; concurrency?: number; findings?: Finding[]; hypotheses?: Hypothesis[]; now?: () => number; onProgress?: (done: number, total: number) => void } = {}
): Promise<VerificationResult> {
  const checks: EvidenceCheck[] = new Array(ledger.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < ledger.length) {
      const i = next++;
      checks[i] = await checkEvidence(http, ledger[i], opts.signal);
      opts.onProgress?.(++done, ledger.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, ledger.length) }, worker));
  const counts: Record<VerifyStatus, number> = { identical: 0, changed: 0, unavailable: 0, inconclusive: 0 };
  checks.forEach((c) => counts[c.status]++);
  const bad = new Set(checks.filter((c) => c.status === 'changed' || c.status === 'unavailable').map((c) => c.id));
  const cites = (text?: string) => (text?.match(/\bE\d+\b/g) ?? []).some((id) => bad.has(id));
  return {
    at: (opts.now ?? Date.now)(),
    checks,
    counts,
    affected: {
      findings: (opts.findings ?? []).filter((f) => cites(f.evidence) || cites(f.detail)).map((f) => f.title),
      hypotheses: (opts.hypotheses ?? []).filter((h) => cites(h.evidence)).map((h) => h.statement),
    },
  };
}

/** One line for reports and the model: "12 identical, 1 changed, 1 unavailable". */
export function verificationSummary(r: VerificationResult): string {
  const parts = (['identical', 'changed', 'unavailable', 'inconclusive'] as const).filter((k) => r.counts[k]).map((k) => `${r.counts[k]} ${k}`);
  return parts.length ? parts.join(', ') : 'no evidence to verify';
}

/** Markdown section for reports and saved investigations. */
export function verificationMarkdown(r: VerificationResult, iso: (ms: number) => string): string {
  const lines = [`Verified ${iso(r.at)}: ${verificationSummary(r)} (each query re-run with its recorded datasource, query and time range).`, ''];
  const notable = r.checks.filter((c) => c.status !== 'identical');
  if (notable.length) {
    lines.push('| Evidence | Result | Datasource | Query | Recorded | Now | Note |', '|---|---|---|---|---|---|---|');
    for (const c of notable) {
      const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(
        `| ${c.id} | ${c.status} | ${cell(c.datasource)} | \`${cell(c.query).slice(0, 120)}\` | ${c.before.frames} frames, ${c.before.rows} rows | ${c.after ? `${c.after.frames} frames, ${c.after.rows} rows` : '–'} | ${cell(c.note ?? '')} |`
      );
    }
    lines.push('');
  }
  if (r.affected.findings.length || r.affected.hypotheses.length) {
    lines.push('**Re-examine** (cites evidence that changed or is unavailable):');
    r.affected.findings.forEach((t) => lines.push(`- Finding: ${t}`));
    r.affected.hypotheses.forEach((t) => lines.push(`- Hypothesis: ${t}`));
  }
  return lines.join('\n').trim();
}
