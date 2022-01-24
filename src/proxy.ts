import * as session from 'express-session';
import * as fs from 'fs';
import * as path from 'path';
import type { createClient } from 'redis';

const TOMBSTONE = 'TOMBSTONE';

export type Client = ReturnType<typeof createClient>;

export interface RedisStoreProxyOptions {
	/* A V4 redis client. */
	client: Client;
	/* Prefix for stored session keys. */
	prefix: string;
	/* The maximum number of keys to batch in Redis calls. */
	scanCount: number;
	/* The default time in seconds renewed to session (only used if the session cookie is missing an `expires` date). */
	ttl: number;
	/* Disables renewing the session cookie's `expires` time when `touch` is called. */
	disableTouch: boolean;
	/* Determines whether session updates during concurrent requests should be merged or overridden. */
	concurrencyMerge: boolean;
}

export interface SessionDataDict {
	[id: string]: session.SessionData;
}

export class RedisStoreProxy {
	readonly client: Client;
	readonly prefix: string;
	readonly scanCount: number;
	readonly ttl: number;
	readonly disableTouch: boolean;
	readonly concurrencyMerge: boolean;
	private readonly scripts: { set: string; setMerge: string };

	constructor(options: Partial<RedisStoreProxyOptions> = {}) {
		if (!options.client) {
			throw new Error('Missing mandatory `client` option for `RedisStore`');
		}

		this.client = options.client;
		this.prefix = options.prefix ?? 'sessions:';
		this.scanCount = options.scanCount ?? 100;
		this.ttl = options.ttl ?? 86400;
		this.disableTouch = options.disableTouch ?? false;
		this.concurrencyMerge = options.concurrencyMerge ?? false;
		this.scripts = {
			set: fs.readFileSync(path.resolve(__dirname, '../lua/set.lua'), 'utf8').trim(),
			setMerge: fs.readFileSync(path.resolve(__dirname, '../lua/set_merge.lua'), 'utf8').trim(),
		};
	}

	key(sid: string) {
		return `${this.prefix}${sid}`;
	}

	get(key: string, allowTombstones: true): Promise<session.SessionData | typeof TOMBSTONE>;
	get(key: string, allowTombstones?: false): Promise<session.SessionData>;
	async get(key: string, allowTombstones = false) {
		const result = await this.client.get(key);
		if (!result || (!allowTombstones && result === TOMBSTONE)) return null;
		if (result === TOMBSTONE) {
			if (allowTombstones) return null;
			return result;
		}

		return JSON.parse(result) as session.SessionData;
	}

	// TODO: return a value summarizing the result
	async set(key: string, sessionData: session.SessionData) {
		const ttl = this._getTtl(sessionData);

		if (ttl <= 0) {
			await this.destroy(key);
			return null;
		}

		const { lastModified } = sessionData;
		const value = JSON.stringify({
			...sessionData,
			lastModified: Date.now(),
		});

		if (this.concurrencyMerge) {
			await this.client.eval(this.scripts.setMerge, {
				keys: [key],
				arguments: [value, String(ttl), String(lastModified)],
			});
			return null;
		}

		await this.client.eval(this.scripts.set, {
			keys: [key],
			arguments: [value, String(ttl)],
		});
		return null;
	}

	async touch(key: string, sessionData: session.SessionData) {
		if (this.disableTouch) {
			return null;
		}

		const ttl = this._getTtl(sessionData);
		return this.client.pExpire(key, ttl);
	}

	async destroy(key: string) {
		return this.client.set(key, TOMBSTONE, {
			EX: 300,
		});
	}

	async clear() {
		const generator = this._generateKeys();

		const batchPromises: Promise<number>[] = [];
		// eslint-disable-next-line no-restricted-syntax
		for await (const keysBatch of generator) {
			const batchPromise = this.client.del(keysBatch);
			batchPromises.push(batchPromise);
		}

		return Promise.all(batchPromises);
	}

	async length(allowTombstones = false) {
		// Tombstones are allowed (this is more efficient)
		if (allowTombstones) {
			const generator = this._generateKeys(false);

			let n = 0;
			// eslint-disable-next-line no-restricted-syntax,@typescript-eslint/no-unused-vars
			for await (const _ of generator) {
				n += 1;
			}

			return n;
		}

		// Tombstones are not allowed (must get key values)
		const dict = this.all();
		return Object.keys(dict).length;
	}

	/**
	 * Acquire all sessions from the store by calling `MGET` for batches of keys based on {@link RedisStore.scanCount}.
	 */
	async all(allowTombstones = false) {
		const generator = this._generateKeys();

		const batchPromises: Promise<SessionDataDict>[] = [];
		// eslint-disable-next-line no-restricted-syntax
		for await (const keysBatch of generator) {
			const batchPromise = this.client.mGet(keysBatch).then(values => {
				return values.reduce((acc, value, i) => {
					if (!value || (!allowTombstones && value === TOMBSTONE)) return acc;
					const id = keysBatch[i].substring(this.prefix.length);
					acc[id] = JSON.parse(value) as session.SessionData;
					return acc;
				}, {} as SessionDataDict);
			});
			batchPromises.push(batchPromise);
		}

		const batchResults = await Promise.all(batchPromises);
		return Object.assign({}, ...batchResults) as SessionDataDict;
	}

	/**
	 * Generate batches of keys with `SCAN`.
	 * @param batch - toggle whether to return the keys returned by each `SCAN` call in batches; this allows the
	 * consumer to make other async calls using each batch while waiting for the next one to arrive.
	 */
	private _generateKeys(batch: false): AsyncGenerator<string>;
	private _generateKeys(batch?: true): AsyncGenerator<string[]>;
	private async *_generateKeys(batch = true) {
		let cursor: number | null = null;
		while (cursor !== 0) {
			// eslint-disable-next-line no-await-in-loop
			const result: { cursor: number; keys: string[] } = await this.client.scan(cursor ?? 0, {
				TYPE: 'string',
				MATCH: this.key('*'),
				COUNT: this.scanCount,
			});

			cursor = result.cursor;
			const { keys } = result;

			if (batch) {
				yield keys;
			} else {
				yield* keys;
			}
		}
	}

	/**
	 * Determines the time to live in milliseconds for the provided session; defaults to the existing session cookie
	 * `expires` field and falls back to {@link RedisStoreProxy.ttl}.
	 */
	private _getTtl(sess: session.SessionData) {
		const expires = sess?.cookie?.expires;
		return expires ? Number(new Date(expires)) - Date.now() : this.ttl * 1000;
	}
}
