// On-cluster readiness/liveness probe (TIN-2543, ADR 0010). Kept dual-adapter-safe
// by prerender=true: under adapter-static it prerenders to build/health (a static
// file the in-cluster origin serves 200), and under adapter-node it serves live.
// The great-falls-tool-bus-infra web Deployment probes GET /health on the
// container port (k8s/web/greatfallstoolbus-org-production/deployment.yaml).
import type { RequestHandler } from './$types';

export const prerender = true;

export const GET: RequestHandler = () => {
	return new Response(JSON.stringify({ status: 'ok' }), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
		},
	});
};
