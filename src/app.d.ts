// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/**
			 * The live session behind this request's cookie, or `null` for
			 * anonymous / unconfigured / failed-lookup — all three read the same
			 * on purpose (TIN-3817 slice S2; see resolveAuthSession in
			 * hooks.server.ts). A guard that REQUIRES auth calls requireSession
			 * and throws its own 401; nothing may treat this null as an error.
			 */
			authSession: import('$lib/server/auth').AuthSession | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
