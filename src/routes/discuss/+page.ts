import type { PageLoad } from './$types';
import { discussFixtureSnapshot, type DiscussSnapshot } from '$lib/data/discuss-snapshot';

// Prerenderable today: the load body is a pure, synchronous function, so the
// route builds statically under adapter-static AND serves unchanged under
// adapter-node once the cluster cutover applies (TIN-2541/2543).
export const prerender = true;

// SINGLE SWAP POINT for the data plane. Today it returns the hand-authored
// fixture inline. A parallel workstream replaces ONLY this function body with a
// build-time / in-cluster SSR fetch from HyperKitty (adapter-node post-cutover)
// that returns the same `DiscussSnapshot` shape — the page and component never
// change. This supersedes the earlier committed-snapshot-JSON pipeline plan.
const loadDiscussSnapshot = (): DiscussSnapshot => discussFixtureSnapshot;

export const load: PageLoad = () => ({ snapshot: loadDiscussSnapshot() });
