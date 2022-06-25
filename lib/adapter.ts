import * as session from 'express-session';
import * as fs from 'fs';
import * as path from 'path';
import type { createClient } from 'redis';
import { deepEqual } from './compare';
import serializer, { Serializer } from './serializer';

type Client = ReturnType<typeof createClient>;

const TOMBSTONE = 'TOMBSTONE';

const loadLuaScript = (fileName: string) => {
	const filePath = path.resolve(__dirname, `../lua/${fileName}.lua`);
	const file = fs.readFileSync(filePath, 'utf8');
	return file.trim();
};

/**
 * Configuration options for {@link RedisStoreAdapter}.
 */
export interface RedisStoreAdapterOptions {
	/* A V4 redis client. */
	client: Client;
	/* Prefix for stored session keys. */
	prefix?: string;
	/* The maximum number of keys to batch in Redis calls. */
	scanCount?: number;
	/* The duration in seconds renewed to session (only used if the session cookie is missing an `expires` date). */
	ttlSeconds?: number | false;
	/* The duration in seconds after tombstone records are removed from the store. */
	concurrencyGraceSeconds?: number;
	/* A custom serializer for encoding/decoding {@link session.SessionData} instances as Redis string values */
	serializer?: Serializer;
}

/**
 * A record of session ids mapped to session objects.
 */
export interface SessionDataDict {
	[id: string]: session.SessionData;
}

/**
 * A summary comparing session data to the session data currently stored.
 */
export interface SessionComparison {
	/* The existing session data pulled from the store. */
	existing: session.SessionData | null;
	/* Indicates whether {@link SessionComparison.existing} was updated during a concurrent request. */
	concurrent: boolean;
	/* Indicates deep equality with {@link SessionComparison.existing} (excluding `lastModified` and `cookie`) */
	consistent: boolean;
}

/**
 * A Promise-based implementation of a Redis session store.
 */
export class RedisStoreAdapter {
	readonly client: Client;
	readonly prefix: string;
	readonly scanCount: number;
	readonly ttlSeconds: number | false;
	readonly concurrencyGraceSeconds: number;
	readonly serializer: Serializer;
	protected readonly _scripts: { set: string; touch: string };

	constructor(options: RedisStoreAdapterOptions) {
		if (!options.client) {
			throw new Error('Missing mandatory `client` option for `RedisStore`');
		}

		this.client = options.client;
		this.prefix = options.prefix ?? 'sessions:';
		this.scanCount = options.scanCount ?? 100;
		this.ttlSeconds = options.ttlSeconds ?? 86400;
		this.concurrencyGraceSeconds = options.concurrencyGraceSeconds ?? 300;
		this.serializer = options.serializer ?? serializer;
		this._scripts = {
			set: loadLuaScript('set'),
			touch: loadLuaScript('touch'),
		};
	}

	/**
	 * Get the Redis key corresponding to a session id.
	 *
	 * @param sessionId
	 *
	 * @return the prefixed Redis key.
	 */
	key(sessionId: string) {
		return `${this.prefix}${sessionId}`;
	}

	/**
	 * Check the TTL in milliseconds of a provided session object.
	 *
	 * @remarks uses the session cookie `expires` field or falls back to {@link RedisStoreAdapter.ttlSeconds}.
	 *
	 * @param sessionData
	 *
	 * @return the duration in milliseconds after which the provided session should expire.
	 */
	checkTtlMilliseconds(sessionData: session.SessionData) {
		if (sessionData?.cookie?.expires !== undefined) {
			return sessionData.cookie.expires.getTime() - Date.now();
		}
		return (this.ttlSeconds || 0) * 1000;
	}

	/**
	 * Check whether the provided session is up-to-date with the existing session data in the store.
	 * This method may be used to check for and reconcile changes made to the session during a concurrent request.
	 *
	 * @param sessionId
	 * @param sessionData
	 *
	 * @return a comparison summary object.
	 */
	async compare(sessionId: string, sessionData: Partial<session.SessionData>): Promise<SessionComparison> {
		const existing = await this.get(sessionId);

		return {
			existing,
			concurrent: !!existing && sessionData.lastModified?.getTime() !== existing.lastModified?.getTime(),
			consistent:
				!!existing &&
				deepEqual(
					{ ...sessionData, lastModified: null, cookie: null },
					{ ...existing, lastModified: null, cookie: null },
				),
		};
	}

	/**
	 * Generate batches of keys with `SCAN` for multi-key operations or iteration.
	 *
	 * @param batch - whether to return the keys returned by each `SCAN` call in batches; this allows the consumer to
	 * make other async calls using each batch while waiting for the next one to arrive.
	 *
	 * @return an async generator for individual keys or batches of keys.
	 */
	generateKeys(batch: false): AsyncGenerator<string>;
	generateKeys(batch?: true): AsyncGenerator<string[]>;
	async *generateKeys(batch = true) {
		let cursor = 0;
		do {
			// eslint-disable-next-line no-await-in-loop
			const result: { cursor: number; keys: string[] } = await this.client.scan(cursor, {
				TYPE: 'string',
				MATCH: this.key('*'),
				COUNT: this.scanCount,
			});

			cursor = result.cursor;
			const { keys } = result;

			if (keys.length) {
				if (batch) {
					yield keys;
				} else {
					yield* keys;
				}
			}
		} while (cursor !== 0);
	}

	/**
	 * Get a session.
	 *
	 * @param sessionId
	 *
	 * @return the session object.
	 */
	async get(sessionId: string) {
		const key = this.key(sessionId);
		const result = await this.client.get(key);
		if (!result || result === TOMBSTONE) return null;

		return this.serializer.parse(result);
	}

	/**
	 * Upsert a session (create or update).
	 *
	 * @param sessionId
	 * @param sessionData
	 *
	 * @return the serialized session that was set (or `null` if expired).
	 */
	async set(sessionId: string, sessionData: session.SessionData) {
		const ttlMilliseconds = this.checkTtlMilliseconds(sessionData);
		if (ttlMilliseconds <= 0) {
			await this.destroy(sessionId);
			return null;
		}

		const _sessionData = {
			...sessionData,
			lastModified: new Date(Date.now()), // verbose syntax, but simplifies testing
		};

		const key = this.key(sessionId);
		const value = this.serializer.stringify(_sessionData);

		const result = await this.client.eval(this._scripts.set, {
			keys: [key],
			arguments: [value, String(ttlMilliseconds)],
		});

		if (!result) return null;
		return _sessionData;
	}

	/**
	 * Touch an existing session (i.e. renew its expiration).
	 *
	 * @param sessionId
	 * @param ttlSeconds - the duration in seconds for renewal or a session object from which to determine expiration;
	 * if the determined value is non-positive, the session will be destroyed.
	 *
	 * @return the date when the session will expire (or `null` if expired).
	 */
	async touch(sessionId: string, ttlSeconds: session.SessionData | number) {
		const key = this.key(sessionId);
		const ttlMilliseconds =
			typeof ttlSeconds === 'number' ? ttlSeconds * 1000 : this.checkTtlMilliseconds(ttlSeconds);

		if (ttlMilliseconds <= 0) {
			await this.destroy(sessionId);
			return null;
		}

		return this.client
			.eval(this._scripts.touch, {
				keys: [key],
				arguments: [String(ttlMilliseconds)],
			})
			.then(result => {
				if (result) return new Date(ttlMilliseconds);
				return null;
			});
	}

	/**
	 * Destroy a session.
	 *
	 * @param sessionId
	 * @param useTombstone - use tombstone for concurrency safety.
	 *
	 * @return `true` if the session was successfully destroyed (or `false` if the provided session id does not exist).
	 */
	async destroy(sessionId: string, useTombstone = true) {
		const key = this.key(sessionId);
		if (useTombstone) {
			return this.client
				.set(key, TOMBSTONE, {
					EX: this.concurrencyGraceSeconds,
				})
				.then(result => !!result);
		}

		return this.client.del(key).then(result => result === 1);
	}

	/**
	 * Destroy all existing sessions (by either deleting or using tombstones).
	 *
	 * @remarks non-atomic operation
	 *
	 * @param useTombstones - use tombstones for concurrency safety.
	 *
	 * @return the number of sessions destroyed.
	 */
	async clear(useTombstones = true) {
		const generator = this.generateKeys();

		const batchPromises: Promise<number>[] = [];
		// eslint-disable-next-line no-restricted-syntax
		for await (const keysBatch of generator) {
			if (useTombstones) {
				const multi = this.client.multi();

				keysBatch.forEach(key => {
					multi.set(key, TOMBSTONE, {
						EX: this.concurrencyGraceSeconds,
					});
				});

				const batchPromise = multi.exec(true).then(results => results.filter(result => result !== null).length);
				batchPromises.push(batchPromise);
			} else {
				const batchPromise = this.client.del(keysBatch);
				batchPromises.push(batchPromise);
			}
		}

		return Promise.all(batchPromises).then(counts => counts.reduce((n, count) => n + count, 0));
	}

	/**
	 * Count the number of keys in the session store.
	 *
	 * @remarks non-atomic operation
	 *
	 * @params estimate - estimate the count by skipping tombstone checks.
	 *
	 * @return the number of keys in the session store.
	 */
	async length(estimate = false) {
		// Tombstones are allowed (more efficient)
		if (estimate) {
			let n = 0;
			// eslint-disable-next-line no-restricted-syntax,@typescript-eslint/no-unused-vars
			for await (const _ of this.generateKeys(false)) {
				n += 1;
			}

			return n;
		}

		// Tombstones are not allowed (must check values)
		const batchPromises: Promise<number>[] = [];
		// eslint-disable-next-line no-restricted-syntax
		for await (const keysBatch of this.generateKeys()) {
			const batchPromise = this.client.mGet(keysBatch).then(values => {
				return values.filter(value => value && value !== TOMBSTONE).length;
			});
			batchPromises.push(batchPromise);
		}

		return Promise.all(batchPromises).then(counts => counts.reduce((n, count) => n + count, 0));
	}

	/**
	 * Acquire all sessions from the store by calling `MGET` for batches of keys based on {@link RedisStore.scanCount}.
	 *
	 * @remarks non-atomic operation
	 *
	 * @return a record of session ids mapped to session objects.
	 */
	async all() {
		const generator = this.generateKeys();

		const batchPromises: Promise<SessionDataDict>[] = [];
		// eslint-disable-next-line no-restricted-syntax
		for await (const keysBatch of generator) {
			const batchPromise = this.client.mGet(keysBatch).then(values => {
				return values
					.filter(value => value && value !== TOMBSTONE)
					.reduce((acc, value, i) => {
						const id = keysBatch[i].substring(this.prefix.length);
						acc[id] = this.serializer.parse(value as string);
						return acc;
					}, {} as SessionDataDict);
			});
			batchPromises.push(batchPromise);
		}

		const batchResults = await Promise.all(batchPromises);
		return Object.assign({}, ...batchResults) as SessionDataDict;
	}
}
