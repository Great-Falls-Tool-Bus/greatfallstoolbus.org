// On-cluster readiness/liveness probe (TIN-2543, ADR 0010). It is prerendered
// into the sole adapter-node product build.
// The great-falls-tool-bus-infra web Deployment probes GET /health on the
// container port (k8s/web/greatfallstoolbus-org-production/deployment.yaml).
//
// `sha` is the stable served-commit provenance surface for the GF-I09 owner
// convergence controller. Once GF-I07/GF-I09 supply a typed, authenticated
// source-revision carrier, it compares that intended revision to this field.
// The current v4 execution sandbox does not yet expose the authenticated source
// SHA to Vite as PUBLIC_BUILD_SHA, so `sha` degrades to ''. That correctly
// refuses a served-main proof rather than false-passing an image of unknown
// origin; this consumer owns no fallback provenance or apply mechanism.
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
