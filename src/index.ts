import * as session from 'express-session';
import { RedisStoreProxy, RedisStoreProxyOptions, SessionDataDict } from './proxy';

export * from './proxy';

const noop = () => {};

export type Callback<TResult = unknown | null, TError = unknown | null> = (error: TError, result: TResult) => void;

export interface RedisStoreOptions extends RedisStoreProxyOptions {
	/* {@see {@link events.EventEmitter}} */
	captureRejections?: boolean | undefined;
}

/**
 * A Redis session store for Express.
 */
export class RedisStore extends session.Store {
	/**
	 * A proxy exposing convenient access to {@link RedisStore} methods using Promises.
	 */
	access: RedisStoreProxy;

	constructor(options: Partial<RedisStoreOptions> = {}) {
		super(options);

		this.access = new RedisStoreProxy(options);
	}

	get(sid: string, callback: Callback<session.SessionData | null> = noop) {
		const key = this.access.key(sid);
		this.access
			.get(key)
			.then(result => callback(null, result))
			.catch(error => callback(error, null));
	}

	set(sid: string, sessionData: session.SessionData, callback: Callback<null> = noop) {
		const key = this.access.key(sid);
		this.access
			.set(key, sessionData)
			.then(() => callback(null, null))
			.catch(error => callback(error, null));
	}

	touch(sid: string, sessionData: session.SessionData, callback: Callback<null> = noop) {
		const key = this.access.key(sid);
		this.access
			.touch(key, sessionData)
			.then(() => callback(null, null))
			.catch(error => callback(error, null));
	}

	destroy(sid: string, callback: Callback<null> = noop) {
		const key = this.access.key(sid);
		this.access
			.destroy(key)
			.then(() => callback(null, null))
			.catch(error => callback(error, null));
	}

	clear(callback: Callback<null> = noop) {
		this.access
			.clear()
			.then(() => callback(null, null))
			.catch(error => callback(error, null));
	}

	// ids(callback: StoreCallback = noop) {}

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
