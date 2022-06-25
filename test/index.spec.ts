import * as redis from 'redis';
import * as session from 'express-session';
import { promisify } from 'util';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { RedisStore, RedisStoreAdapter, RedisStoreOptions, SessionDataDict, SessionComparison } from '../lib';
import serializer from '../lib/serializer';

const REDIS_PORT = 6379;

const mockDate = {
	time: 0,
	now() {
		return this.time;
	},
	update(time?: number) {
		this.time = time ?? 0;
	},
};

const createFakeSession = (data: object, expires?: number, lastModified?: number) => {
	return {
		...data,
		cookie: {
			originalMaxAge: 0,
			expires: expires === undefined ? undefined : new Date(expires),
		},
		lastModified: lastModified === undefined ? undefined : new Date(lastModified),
	} as unknown as session.SessionData;
};

/* eslint-disable func-names */
describe('connect-redis-session:', function () {
	let container: StartedTestContainer;
	let redisClient: ReturnType<typeof redis.createClient>;

	before('create Redis container', async function () {
		this.timeout(20000);
		container = await new GenericContainer('redis').withExposedPorts(REDIS_PORT).start();
	});

	before('create Redis client', async function () {
		redisClient = redis.createClient({
			url: `redis://${container.getHost()}:${container.getMappedPort(REDIS_PORT)}`,
		});
		await redisClient.connect();
	});

	after('disconnect client and stop container', async function () {
		if (redisClient) await redisClient.quit();
		if (container) await container.stop();
	});

	describe('RedisStore', function () {
		describe('RedisStore:constructor', function () {
			describe('Should properly initialize', function () {
				it('Should properly handle options (1)', function () {
					const store = new RedisStore({ client: redisClient });

					assert.strictEqual(store.disableTouch, false);

					assert.instanceOf(store.access, RedisStoreAdapter);
					assert.isObject(store.access.client);
					assert.strictEqual(store.access.prefix, 'sessions:');
					assert.isNumber(store.access.ttlSeconds);
					assert.isAbove(store.access.ttlSeconds || 0, 0);
					assert.isAbove(store.access.concurrencyGraceSeconds, 0);
					assert.isAbove(store.access.scanCount, 0);
				});

				it('Should properly handle options (2)', function () {
					const store = new RedisStore({
						client: redisClient,
						prefix: 'sess:',
						scanCount: 1000,
						ttlSeconds: false,
						disableTouch: true,
						concurrencyGraceSeconds: 100,
					});

					assert.strictEqual(store.disableTouch, true);

					assert.strictEqual(store.access.prefix, 'sess:');
					assert.strictEqual(store.access.scanCount, 1000);
					assert.strictEqual(store.access.ttlSeconds, false);
					assert.strictEqual(store.access.concurrencyGraceSeconds, 100);
				});
			});

			it('Should raise an exception when client is not provided', function () {
				assert.throw(() => new RedisStore({} as RedisStoreOptions), Error);
			});
		});

		describe('RedisStore:methods', function () {
			const sid = '1234';
			let store: RedisStore;
			let dateNow: () => number;

			before('create Redis store', function () {
				store = new RedisStore({ client: redisClient, serializer });
			});

			before('replace `Date.now()` with a mock function', function () {
				dateNow = Date.now;
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				Date.now = mockDate.now.bind(mockDate);
				mockDate.update(0);
			});

			after('restore `Date.now()`', function () {
				Date.now = dateNow;
			});

			describe('Suite: missing session cookie `expires`', function () {
				let session: session.SessionData;
				let sessionExpect: session.SessionData;

				before('reset the database', async function () {
					await redisClient.flushDb();
				});

				before('configure session objects', function () {
					session = createFakeSession({ user: { id: 'abcd' }, foo: 'bar' });
					sessionExpect = createFakeSession({ user: { id: 'abcd' }, foo: 'bar' }, undefined, mockDate.now());
				});

				it('Should set the session to its expected value', async function () {
					const result = await promisify(store.set.bind(store))(sid, session);
					assert.deepEqual(result, sessionExpect);
				});

				it('Should set the session with ttl based on `ttlSeconds` option', async function () {
					const ttl = await redisClient.ttl(store.access.key(sid));
					assert.closeTo(ttl, store.access.ttlSeconds || 0, 5);
				});

				it('Should get the previously set session', async function () {
					const result = await promisify(store.get.bind(store))(sid);
					assert.deepEqual(result, sessionExpect);
				});

				it('Should destroy the previously set session', async function () {
					const result = await promisify(store.destroy.bind(store))(sid);
					assert.strictEqual(result, true);
				});

				it('Should return null when getting a destroyed session', async function () {
					const result = await promisify(store.get.bind(store))(sid);
					assert.strictEqual(result, null);
				});
			});

			// TODO: expires with date

			describe('Suite: with session cookie `expires`', function () {
				let expires: number;
				let session: session.SessionData;
				let sessionExpect: session.SessionData;

				before('reset the database', async function () {
					await redisClient.flushDb();
				});

				before('configure session objects', function () {
					expires = mockDate.now() + 36e5;
					session = createFakeSession({ user: { id: 'abcd' } }, expires);
					sessionExpect = createFakeSession({ user: { id: 'abcd' } }, expires, mockDate.now());
				});

				it('Should set the session to its expected value', async function () {
					const result = await promisify(store.set.bind(store))(sid, session);
					assert.deepEqual(result, sessionExpect);
				});

				it('Should set the session with ttl based on cookie `expires`', async function () {
					const ttl = await redisClient.ttl(store.access.key(sid));
					assert.closeTo(ttl, 36e2, 5);
				});

				it('Should get the previously set session', async function () {
					const result = await promisify(store.get.bind(store))(sid);
					assert.deepEqual(result, sessionExpect);
					session = result as session.SessionData;
				});

				it('Should touch the previously set session', async function () {
					const result = await promisify(store.touch.bind(store))('1234', session);
					assert.closeTo(Number(result), Number(session?.cookie?.expires ?? 0), 5e3);
				});

				it('Should fail to touch the previously set session with `disableTouch`', async function () {
					const _store = new RedisStore({ client: redisClient, disableTouch: true });
					const result = await promisify(_store.touch.bind(_store))('1234', session);
					assert.strictEqual(result, null);
				});
			});

			describe('Suite: batch operations`', function () {
				const sessions: SessionDataDict = {};

				before('reset the database', async function () {
					await redisClient.flushDb();
				});

				beforeEach('configure and set session objects', async function () {
					sessions['1234'] = createFakeSession({ user: { id: 'abcd' } });
					sessions['2345'] = createFakeSession({ user: { id: 'bcde' } });
					sessions['3456'] = createFakeSession({ user: { id: 'cdef' } });
					sessions['4567'] = createFakeSession({ user: { id: 'defg' } });

					await Promise.all(
						Object.entries(sessions).map(([sessionId, sessionData]) =>
							promisify(store.set.bind(store))(sessionId, sessionData),
						),
					);
				});

				it('Should count all sessions', async function () {
					const result = await promisify(store.length.bind(store))();
					assert.strictEqual(result, Object.keys(sessions).length);
				});

				it('Should return all sessions', async function () {
					const result = await promisify(store.all.bind(store))();
					const expected = Object.entries(sessions).reduce((acc, [sessionId, sessionData]) => {
						acc[sessionId] = createFakeSession(sessionData, undefined, mockDate.now());
						return acc;
					}, {} as SessionDataDict);
					assert.deepEqual(result, expected);
				});

				it('Should clear all sessions', async function () {
					const result = await promisify(store.clear.bind(store))();
					assert.strictEqual(result, Object.keys(sessions).length);

					await Promise.all(
						Object.keys(sessions).map(key => {
							return promisify(store.get.bind(store))(key).then(key => key === null);
						}),
					);
				});
			});

			describe('Suite: noop callbacks', function () {
				const session = null as unknown as session.SessionData;

				before('reset the database', async function () {
					await redisClient.flushDb();
				});

				// TODO: need to find a more reliable solution
				it('Should handle noop defaults', function (done) {
					assert.doesNotThrow(() => store.get(sid));
					assert.doesNotThrow(() => store.set(sid, session));
					assert.doesNotThrow(() => store.touch(sid, session));
					assert.doesNotThrow(() => store.destroy(sid));
					assert.doesNotThrow(() => store.clear());
					assert.doesNotThrow(() => store.length());
					assert.doesNotThrow(() => store.all());

					setTimeout(() => {
						done();
					}, 1.5e3);
				});
			});

			describe('Suite: callback errors', function () {
				const session = null as unknown as session.SessionData;
				const sentinelError = 'StubError';
				let stubStore: RedisStore;

				before('configure the stub', function () {
					stubStore = new RedisStore({ client: redisClient });

					/*
					eslint-disable
					@typescript-eslint/no-unsafe-assignment,
					@typescript-eslint/no-unsafe-call,
					@typescript-eslint/no-unsafe-member-access
					*/
					stubStore.access.get = sinon.stub().rejects(sentinelError);
					stubStore.access.set = sinon.stub().rejects(sentinelError);
					stubStore.access.touch = sinon.stub().rejects(sentinelError);
					stubStore.access.destroy = sinon.stub().rejects(sentinelError);
					stubStore.access.clear = sinon.stub().rejects(sentinelError);
					stubStore.access.length = sinon.stub().rejects(sentinelError);
					stubStore.access.all = sinon.stub().rejects(sentinelError);
					/*
					eslint-enable
					@typescript-eslint/no-unsafe-assignment,
					@typescript-eslint/no-unsafe-call,
					@typescript-eslint/no-unsafe-member-access
					*/
				});

				it('Should properly pass error to `get` callback', function (done) {
					stubStore.get(sid, (error, result) => {
						assert.strictEqual((error as Error).name, sentinelError);
						assert.strictEqual(result, null);
						done();
					});
				});

				it('Should properly pass error to `set` callback', function (done) {
					stubStore.set(sid, session, (error, result) => {
						assert.strictEqual((error as Error).name, sentinelError);
						assert.strictEqual(result, null);
						done();
					});
				});

				it('Should properly pass error to `touch` callback', function (done) {
					stubStore.touch(sid, session, (error, result) => {
						assert.strictEqual((error as Error).name, sentinelError);
						assert.strictEqual(result, null);
						done();
					});
				});

				it('Should properly pass error to `destroy` callback', function (done) {
					stubStore.destroy(sid, (error, result) => {
						assert.strictEqual((error as Error).name, sentinelError);
						assert.strictEqual(result, false);
						done();
					});
				});

				it('Should properly pass error to `clear` callback', function (done) {
					stubStore.clear((error, result) => {
						assert.strictEqual((error as Error).name, sentinelError);
						assert.strictEqual(result, 0);
						done();
					});
				});

				it('Should properly pass error to `length` callback', function (done) {
					stubStore.length((error, result) => {
						assert.strictEqual((error as Error).name, sentinelError);
						assert.strictEqual(result, 0);
						done();
					});
				});

				it('Should properly pass error to `all` callback', function (done) {
					stubStore.all((error, result) => {
						assert.strictEqual((error as Error).name, sentinelError);
						assert.strictEqual(result, null);
						done();
					});
				});
			});
		});
	});

	describe('RedisStoreAdapter', function () {
		describe('RedisStoreAdapter:methods', function () {
			const sid = '1234';
			let dateNow: () => number;

			before('replace `Date.now()` with a mock function', function () {
				dateNow = Date.now;
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				Date.now = mockDate.now.bind(mockDate);
				mockDate.update(0);
			});

			after('restore `Date.now()`', function () {
				Date.now = dateNow;
			});

			describe('Suite: tombstones', function () {
				let access: RedisStoreAdapter;
				let session: session.SessionData;

				before('reset the database', async function () {
					await redisClient.flushDb();
				});

				before('create Redis store adapter', function () {
					access = new RedisStoreAdapter({ client: redisClient });
				});

				beforeEach('configure and set session object', async function () {
					session = createFakeSession({ user: { id: 'abcd' } }, mockDate.now());
					await access.set(sid, session);
				});

				it('Should get a null value', async function () {
					const result = await access.get(sid);
					assert.strictEqual(result, null);
				});

				it('Should count the tombstone value', async function () {
					const result = await access.length(true);
					assert.strictEqual(result, 1);
				});

				it('Should delete the session tombstone', async function () {
					const result = await access.destroy(sid, false);
					assert.strictEqual(result, true);

					const value = await redisClient.get(sid);
					assert.strictEqual(value, null);
				});

				it('Should clear the session tombstone', async function () {
					const result = await access.clear(false);
					assert.strictEqual(result, 1);

					const value = await redisClient.get(sid);
					assert.strictEqual(value, null);

					const count = await access.length();
					assert.strictEqual(count, 0);
				});

				it('Should not set', async function () {
					const result = await access.set(sid, createFakeSession(session, mockDate.now() + 36e5));
					assert.strictEqual(result, null);
				});

				it('Should not renew on touch', async function () {
					const result = await access.touch(sid, 36e2);
					assert.strictEqual(result, null);
				});
			});

			describe('Suite: edges', function () {
				let access: RedisStoreAdapter;
				let session: session.SessionData;

				before('create Redis store adapter', function () {
					access = new RedisStoreAdapter({ client: redisClient });
				});

				beforeEach('reset the database', async function () {
					await redisClient.flushDb();
				});

				beforeEach('configure and set session object', async function () {
					session = createFakeSession({ user: { id: 'abcd' } }, mockDate.now() + 36e5, mockDate.now());
					await access.set(sid, session);
				});

				it('Should destroy the session with an expired touch session (1)', async function () {
					const result = await access.touch(sid, 0);
					assert.strictEqual(result, null);
				});

				it('Should destroy the session with an expired touch session (2)', async function () {
					const _access = new RedisStoreAdapter({ client: redisClient, ttlSeconds: 0 });
					const result = await _access.touch(sid, createFakeSession({}));
					assert.strictEqual(result, null);
				});

				it('Should compare the session (concurrent)', async function () {
					const result = await access.compare(sid, {
						...session,
						lastModified: new Date(mockDate.now() + 1),
					});
					const expected: SessionComparison = {
						existing: { ...session, lastModified: new Date(mockDate.now()) },
						concurrent: true,
						consistent: true,
					};
					assert.deepEqual(result, expected);
				});

				it('Should compare the session (concurrent, undefined `lastModified`)', async function () {
					const result = await access.compare(sid, { ...session, lastModified: undefined });
					const expected: SessionComparison = {
						existing: { ...session, lastModified: new Date(mockDate.now()) },
						concurrent: true,
						consistent: true,
					};
					assert.deepEqual(result, expected);
				});

				it('Should compare the session (not concurrent)', async function () {
					const result = await access.compare(sid, session);
					const expected: SessionComparison = {
						existing: { ...session, lastModified: new Date(mockDate.now()) },
						concurrent: false,
						consistent: true,
					};
					assert.deepEqual(result, expected);
				});

				it('Should compare the session (not concurrent, undefined `lastModified`)', async function () {
					await access.set(sid, { ...session, lastModified: undefined });
					const result = await access.compare(sid, { ...session, lastModified: new Date(mockDate.now()) });
					const expected: SessionComparison = {
						existing: { ...session, lastModified: new Date(mockDate.now()) },
						concurrent: false,
						consistent: true,
					};
					assert.deepEqual(result, expected);
				});
			});
		});
	});
});
/* eslint-enable func-names */
