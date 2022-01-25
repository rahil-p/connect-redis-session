const redis = require('redis');
const chai = require('chai');
const { promisify } = require('util');
const { GenericContainer } = require('testcontainers');
const { RedisStore, RedisStoreProxy } = require('..');

const { assert } = chai;

function MockDate(time) {
	this.update = t => {
		this.time = t || 0;
	};
	this.increment = (n = 1) => {
		this.time += n;
	};
	this.now = () => this.time;
	this.update(time);
}

const mockDate = new MockDate();

describe('RedisStore', function () {
	let container;
	let redisClient;

	before(async function () {
		container = await new GenericContainer('redis').withExposedPorts(6379).start();
		redisClient = redis.createClient({ url: `redis://${container.getHost()}:${container.getMappedPort(6379)}` });
		await redisClient.connect();
	});

	after(async function () {
		if (redisClient) await redisClient.quit();
		if (container) await container.stop();
	});

	describe('RedisStore:constructor', function () {
		it('Should properly initialize RedisStoreProxy', function () {
			const store = new RedisStore({ client: redisClient });
			assert.instanceOf(store.access, RedisStoreProxy);
			assert.equal(store.access.prefix, 'sessions:');
			assert.typeOf(store.access.scripts.set, 'string');
			assert.typeOf(store.access.scripts.setMerge, 'string');
			assert.isNotEmpty(store.access.scripts.set);
			assert.isNotEmpty(store.access.scripts.setMerge);
		});

		it('Should raise an exception when client is not provided', function () {
			assert.throw(() => new RedisStore(), Error);
		});
	});

	describe('RedisStore:set', function () {
		let store;
		let dateNow;

		before(function () {
			store = new RedisStore({ client: redisClient });
		});

		beforeEach(async function () {
			store.access.client.flushDb();

			dateNow = Date.now;
			Date.now = mockDate.now.bind(mockDate);
			mockDate.update(0);
		});

		afterEach(function () {
			Date.now = dateNow;
		});

		it('Should use `ttl` when session cookie `expires` is missing', async function () {
			const sid = '1234';
			const s1 = { user: { id: 'abcd' }, foo: 'bar' };
			await promisify(store.set).bind(store)(sid, s1);

			const ttl = await store.access.client.ttl(store.access.key(sid));
			assert.closeTo(ttl, store.access.ttl, 5);

			const s2 = await promisify(store.get).bind(store)(sid);
			assert.deepEqual({ ...s1, lastModified: mockDate.now() }, s2);
		});

		it('Should use session cookie `expires` when available', async function () {
			const sid = '1234';
			const expires = mockDate.now() + 36e5;
			const s1 = { user: { id: 'abcd' }, cookie: { expires } };
			await promisify(store.set).bind(store)(sid, s1);

			const ttl = await store.access.client.ttl(store.access.key(sid));
			assert.closeTo(ttl, 36e2, 5);

			const s2 = await promisify(store.get).bind(store)(sid);
			assert.deepEqual({ ...s1, lastModified: mockDate.now() }, s2);
		});
	});
});
