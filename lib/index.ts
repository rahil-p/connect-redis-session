import * as session from 'express-session';
import { RedisStoreAdapter, RedisStoreAdapterOptions, SessionDataDict } from './adapter';

export * from './adapter';

const noop = () => {};

declare module 'express-session' {
	interface SessionData {
		lastModified?: number;
	}
}

/**
 * A generic callback for integrating the {@link RedisStoreAdapter}'s Promise return types.
 */
export type Callback<TResult = unknown | null, TError = unknown | null> = (error: TError, result: TResult) => void;

/**
 * Configuration options for {@link RedisStore}.
 */
export interface RedisStoreOptions extends RedisStoreAdapterOptions {
	/* Disables renewing the session cookie's `expires` time when `touch` is called. */
	disableTouch?: boolean;
	/* {@see {@link events.EventEmitter}} */
	captureRejections?: boolean | undefined;
}

/**
 * A Redis session store for Express.
 */
export class RedisStore extends session.Store {
	/**
	 * A Promise-based adapter providing convenient access to the Redis session store.
	 */
	readonly access: RedisStoreAdapter;
	readonly disableTouch: boolean;

	constructor(options: RedisStoreOptions) {
		super(options);

		this.access = new RedisStoreAdapter(options);
		this.disableTouch = options.disableTouch ?? false;
	}

	get(sessionId: string, callback: Callback<session.SessionData | null> = noop) {
		this.access
			.get(sessionId)
			.then(result => callback(null, result))
			.catch(error => callback(error, null));
	}

	set(sessionId: string, sessionData: session.SessionData, callback: Callback<session.SessionData | null> = noop) {
		this.access
			.set(sessionId, sessionData)
			.then(result => callback(null, result))
			.catch(error => callback(error, null));
	}

	touch(sessionId: string, sessionData: session.SessionData, callback: Callback<Date | null> = noop) {
		if (this.disableTouch) {
			callback(null, null);
			return;
		}

		this.access
			.touch(sessionId, sessionData)
			.then(result => callback(null, result))
			.catch(error => callback(error, null));
	}

	destroy(sessionId: string, callback: Callback<boolean> = noop) {
		this.access
			.destroy(sessionId)
			.then(result => callback(null, result))
			.catch(error => callback(error, false));
	}

	clear(callback: Callback<number> = noop) {
		this.access
			.clear()
			.then(result => callback(null, result))
			.catch(error => callback(error, 0));
	}

	length(callback: Callback<number> = noop) {
		this.access
			.length()
			.then(result => callback(null, result))
			.catch(error => callback(error, 0));
	}

	all(callback: Callback<SessionDataDict | null> = noop) {
		this.access
			.all()
			.then(result => callback(null, result))
			.catch(error => callback(error, null));
	}
}
