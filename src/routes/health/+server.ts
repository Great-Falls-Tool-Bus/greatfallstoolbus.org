// On-cluster readiness/liveness probe (TIN-2543, ADR 0010). It is prerendered
// into the sole adapter-node product build.
// The great-falls-tool-bus-infra web Deployment probes GET /health on the
// container port (k8s/web/greatfallstoolbus-org-production/deployment.yaml).
//
// `sha` is the served-commit provenance the converge-agent's real-edge assert
// reads (site.scaffold modules/converge_agent, served_sha_field default `.sha`):
// the carrier resolves this repo's main head with `git ls-remote` and compares
// it to this field, so convergence is only "ok" when the edge serves the commit
// it just applied. The value is the existing build-info constant — inlined at
// build time from PUBLIC_BUILD_SHA when the qualified build action supplies the
// exact source commit. Builds without that authority carry no
// provenance, so `sha` degrades to '' — which correctly FAILS
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
