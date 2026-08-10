// On-cluster readiness/liveness probe (TIN-2543, ADR 0010). Kept dual-adapter-safe
// by prerender=true: under adapter-static it prerenders to build/health (a static
// file the in-cluster origin serves 200), and under adapter-node it serves live.
// The great-falls-tool-bus-infra web Deployment probes GET /health on the
// container port (k8s/web/greatfallstoolbus-org-production/deployment.yaml).
//
// `sha` is the served-commit provenance the converge-agent's real-edge assert
// reads (site.scaffold modules/converge_agent, served_sha_field default `.sha`):
// the carrier resolves this repo's main head with `git ls-remote` and compares
// it to this field, so convergence is only "ok" when the edge serves the commit
// it just applied. The value is the existing build-info constant — inlined at
// build time from PUBLIC_BUILD_SHA, which only the container image recipes set
// (from BUILD_COMMIT_SHA = the merged main commit). Local / adapter-static
// builds carry no provenance, so `sha` degrades to '' — which correctly FAILS
// a served-sha assert instead of false-passing on an image of unknown origin.
import type { RequestHandler } from './$types';
import { buildSha } from '$lib/build-info';

export const prerender = true;

export const GET: RequestHandler = () => {
	return new Response(JSON.stringify({ status: 'ok', sha: buildSha }), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
		},
	});
};
