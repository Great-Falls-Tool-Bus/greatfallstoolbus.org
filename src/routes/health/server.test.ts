import { describe, expect, it, vi } from 'vitest';

// The /health body is the stable served-sha projection consumed by the GF-I09
// owner convergence controller once a typed GF-I07/GF-I09 source-provenance
// carrier exists.
// These tests are mutation-proven against the two historical defects:
//   1. the body serving no sha at all ({status:'ok'} — the blocker item), and
//   2. the sha field decoupling from the build-info constant (a hardcoded or
//      renamed field would pass a shape-only check).
// build-info is mocked so the assertion compares CONTENT: the handler must
// serve exactly the mocked constant, at exactly the field name `sha`.

const MOCK_SHA = '378508b4aa23185d19b6d250ce97f3a071b98807';

vi.mock('$lib/build-info', () => ({
	buildSha: MOCK_SHA,
	buildShaShort: MOCK_SHA.slice(0, 7),
}));

describe('GET /health', () => {
	it('serves status ok as JSON', async () => {
		const { GET } = await import('./+server');
		const response = GET({} as never) as Response;
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		const body = JSON.parse(await response.text());
		expect(body.status).toBe('ok');
	});

	it('serves the build-info commit sha at the stable `.sha` field', async () => {
		const { GET } = await import('./+server');
		const response = GET({} as never) as Response;
		const body = JSON.parse(await response.text());
		// Field must exist under the exact owner-controller contract name…
		expect(Object.keys(body)).toContain('sha');
		// …and carry the build-info constant, not a copy or a literal.
		expect(body.sha).toBe(MOCK_SHA);
	});
});
