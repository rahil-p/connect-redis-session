declare module 'express-session' {
	export interface SessionData {
		/**
		 * The Unix timestamp in milliseconds when the session was last updated.
		 */
		lastModified: number;
	}
}

export {};
