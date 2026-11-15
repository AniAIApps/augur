import { digest } from './grafana';
import { fakeHttp } from './testUtils';
import { dataDigest, verificationMarkdown, verifyEvidence } from './verify';
import { EvidenceRecord } from './types';
import { iso } from './time';

const frame = (labels: Record<string, string>, values: number[], meta: Record<string, unknown> = {}) => ({
  schema: { name: '', meta, fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number', labels }] },
  data: { values: [values.map((_, i) => 1000 * i), values] },
});
const resp = (...frames: any[]) => ({ results: { A: { frames } } });

const rec = async (id: string, r: any, extra: Partial<EvidenceRecord> = {}): Promise<EvidenceRecord> => ({
  id,
  tool: 'query_prometheus',
  datasource: { uid: 'mimir', type: 'prometheus', name: 'Mimir' },
  query: { expr: `rate(x_${id}[5m])`, range: true },
  from: '2026-11-15T08:00:00Z',
  to: '2026-11-15T09:00:00Z',
  digest: await digest(JSON.stringify(r)),
  dataDigest: await dataDigest(r),
  frames: r.results.A.frames.length,
  rows: r.results.A.frames.reduce((n: number, f: any) => n + f.data.values[0].length, 0),
  at: 1,
  ...extra,
});

describe('data digest', () => {
  it('ignores metadata such as execution stats and the order series come back in', async () => {
    const a = resp(frame({ pod: 'a' }, [1, 2], { stats: [{ displayName: 'exec time', value: 0.012 }] }), frame({ pod: 'b' }, [3, 4]));
    const b = resp(frame({ pod: 'b' }, [3, 4]), frame({ pod: 'a' }, [1, 2], { stats: [{ displayName: 'exec time', value: 0.371 }] }));
    expect(await dataDigest(a)).toBe(await dataDigest(b));
    expect(await digest(JSON.stringify(a))).not.toBe(await digest(JSON.stringify(b)));
  });

  it('changes when any value or label changes', async () => {
    const base = await dataDigest(resp(frame({ pod: 'a' }, [1, 2])));
    expect(await dataDigest(resp(frame({ pod: 'a' }, [1, 3])))).not.toBe(base);
    expect(await dataDigest(resp(frame({ pod: 'z' }, [1, 2])))).not.toBe(base);
    expect(await dataDigest(resp(frame({ pod: 'a' }, [1, 2]), frame({ pod: 'b' }, [])))).not.toBe(base);
  });
});

describe('verifyEvidence', () => {
  it('re-runs each query exactly as recorded and classifies the result', async () => {
    const now = {
      E1: resp(frame({ pod: 'a' }, [1, 2], { stats: [{ value: 0.5 }] })), // same data, different stats
      E2: resp(frame({ pod: 'a' }, [1, 2, 9])), // a late sample arrived
    };
    const ledger = [
      await rec('E1', resp(frame({ pod: 'a' }, [1, 2], { stats: [{ value: 0.01 }] }))),
      await rec('E2', resp(frame({ pod: 'a' }, [1, 2]))),
      await rec('E3', resp(frame({ pod: 'a' }, [5]))),
      { ...(await rec('E4', resp(frame({ pod: 'a' }, [7])))), datasource: { uid: 'gone', type: 'loki', name: 'Old Loki' } },
    ];
    const http = fakeHttp(({ body }: any) => {
      const id = /x_(E\d)/.exec(body.queries[0].expr)?.[1] as string;
      if (body.queries[0].datasource.uid === 'gone') {
        throw Object.assign(new Error('not found'), { status: 404, data: { message: 'Data source not found' } });
      }
      if (id === 'E3') {
        return { results: { A: { error: 'query out of retention' } } };
      }
      return (now as any)[id];
    });
    const r = await verifyEvidence(http, ledger, {
      findings: [
        { title: 'Error rate tripled', detail: 'see E2', severity: 'high', at: 1 },
        { title: 'Latency normal', detail: 'flat', severity: 'info', evidence: 'E1', at: 2 },
      ],
      hypotheses: [{ id: 'h', statement: 'Deploy caused it', status: 'confirmed', confidence: 0.9, evidence: 'E3, E1', updatedAt: 1 }],
      now: () => Date.UTC(2026, 10, 16),
    });
    expect(r.checks.map((c) => `${c.id}:${c.status}`)).toEqual(['E1:identical', 'E2:changed', 'E3:unavailable', 'E4:unavailable']);
    expect(r.checks[1]).toMatchObject({ before: { frames: 1, rows: 2 }, after: { frames: 1, rows: 3 } });
    expect(r.checks[2].note).toBe('query out of retention');
    expect(r.checks[3].note).toBe('HTTP 404: Data source not found');
    expect(r.counts).toEqual({ identical: 1, changed: 1, unavailable: 2, inconclusive: 0 });
    expect(r.affected).toEqual({ findings: ['Error rate tripled'], hypotheses: ['Deploy caused it'] });
    // Exactly the recorded datasource, query and absolute range.
    expect(http.calls[0].body).toEqual({
      queries: [{ refId: 'A', datasource: { uid: 'mimir', type: 'prometheus' }, expr: 'rate(x_E1[5m])', range: true }],
      from: String(Date.parse('2026-11-15T08:00:00Z')),
      to: String(Date.parse('2026-11-15T09:00:00Z')),
    });
    const md = verificationMarkdown(r, iso);
    expect(md).toMatch(/^Verified 2026-11-16T00:00:00Z: 1 identical, 1 changed, 2 unavailable/);
    expect(md).toContain('| E2 | changed | Mimir |');
    expect(md).toContain('- Finding: Error rate tripled');
    expect(md).toContain('- Hypothesis: Deploy caused it');
    expect(md).not.toContain('| E1 |');
  });

  it('records from before data digests are identical, changed, or inconclusive', async () => {
    const old = resp(frame({ pod: 'a' }, [1, 2], { stats: [{ value: 0.01 }] }));
    const legacy = { ...(await rec('E1', old)), dataDigest: undefined };
    const same = await verifyEvidence(fakeHttp(() => old), [legacy]);
    expect(same.checks[0].status).toBe('identical');
    const statsOnly = await verifyEvidence(fakeHttp(() => resp(frame({ pod: 'a' }, [1, 2], { stats: [{ value: 0.9 }] }))), [legacy]);
    expect(statsOnly.checks[0]).toMatchObject({ status: 'inconclusive' });
    const more = await verifyEvidence(fakeHttp(() => resp(frame({ pod: 'a' }, [1, 2, 3]))), [legacy]);
    expect(more.checks[0].status).toBe('changed');
  });

  it('new evidence is recorded with a data digest', async () => {
    const { dsQuery } = jest.requireActual('./grafana');
    const recorded: any[] = [];
    const r = resp(frame({ pod: 'a' }, [1]));
    await dsQuery(
      { http: fakeHttp(() => r), signal: undefined, recordEvidence: (e: any) => recorded.push(e), now: () => 1 } as any,
      { uid: 'mimir', type: 'prometheus', name: 'Mimir' },
      { expr: 'up' },
      { from: 0, to: 1000 }
    );
    expect(recorded[0].dataDigest).toBe(await dataDigest(r));
  });
});

describe('saved investigations', () => {
  const { buildInvestigationDashboard, extractLedger } = jest.requireActual('./investigations');
  const { verifyPastInvestigation, readPastInvestigation } = jest.requireActual('./tools/knowledge');
  const { ctxWith } = jest.requireActual('./testUtils');

  const saved = async (extra: object = {}) => {
    const data = resp(frame({ pod: 'a' }, [1, 2]));
    const ledger = [await rec('E1', data)];
    const dashboard = buildInvestigationDashboard(
      {
        title: 'Investigation: checkout errors',
        question: 'q',
        report: 'Root cause: deploy (E1).',
        findings: [{ title: 'Errors rose', detail: 'see E1', severity: 'high', at: 1 }],
        hypotheses: [],
        evidence: [],
        ledger,
        range: { from: 0, to: 1 },
        ...extra,
      },
      []
    );
    return { dashboard, data };
  };

  it('embed the structured ledger, which survives a round trip and is hidden from readers', async () => {
    const { dashboard } = await saved();
    const data = extractLedger(JSON.parse(JSON.stringify(dashboard)));
    expect(data.ledger[0]).toMatchObject({ id: 'E1', datasource: { uid: 'mimir' }, query: { expr: 'rate(x_E1[5m])' } });
    expect(data.findings[0].title).toBe('Errors rose');
    const http = fakeHttp(() => ({ dashboard }));
    const text = await readPastInvestigation.run({ uid: 'inv-1' }, ctxWith(http));
    expect(text).toContain('Root cause: deploy');
    expect(text).not.toContain('augur-ledger');
  });

  it('verify_past_investigation re-runs the saved evidence and names what to re-examine', async () => {
    const { dashboard } = await saved();
    const http = fakeHttp(({ url }: any) => (url.startsWith('/api/dashboards/uid/') ? { dashboard } : resp(frame({ pod: 'a' }, [1, 2, 3]))));
    const out = await verifyPastInvestigation.run({ uid: 'inv-1' }, ctxWith(http));
    expect(out).toContain('Evidence verification for "Investigation: checkout errors" (1 queries)');
    expect(out).toContain('1 changed');
    expect(out).toContain('- Finding: Errors rose');
  });

  it('explains when a dashboard has no structured ledger', async () => {
    const http = fakeHttp(() => ({ dashboard: { title: 'Old investigation', panels: [{ type: 'text', options: { content: 'report' } }] } }));
    expect(await verifyPastInvestigation.run({ uid: 'x' }, ctxWith(http))).toMatch(/no structured evidence ledger/);
  });
});

describe('headless --verify', () => {
  const { verifyLedgerFile } = jest.requireActual('../headless/run');
  const fs = jest.requireActual('node:fs');
  const os = jest.requireActual('node:os');
  const path = jest.requireActual('node:path');

  it('re-runs a ledger file, writes the result, and exits 3 when evidence changed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augur-verify-'));
    const r0 = resp(frame({ pod: 'a' }, [1, 2]));
    const file = path.join(dir, 'evidence.json');
    fs.writeFileSync(file, JSON.stringify({ ledger: [await rec('E1', r0)], findings: [{ title: 'Spike', detail: 'E1', severity: 'high', at: 1 }], hypotheses: [] }));
    const out = path.join(dir, 'verification.json');
    const same = await verifyLedgerFile({ AUGUR_VERIFICATION: out }, file, fakeHttp(() => r0));
    expect(same.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).counts.identical).toBe(1);
    const changed = await verifyLedgerFile({}, file, fakeHttp(() => resp(frame({ pod: 'a' }, [1]))));
    expect(changed.code).toBe(3);
    expect(changed.text).toContain('- Finding: Spike');
  });
});
