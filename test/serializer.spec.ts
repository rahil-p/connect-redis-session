import { assert } from 'chai';
import session from 'express-session';
import serializer from '../lib/serializer';

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
const testSerialization = (data: session.SessionData, i: number) => {
	let serialized: string;
	let deserialized: session.SessionData;

	it(`Should serialize session data as expected (${i})`, function () {
		serialized = serializer.stringify(data);
		assert.isString(serialized);
	});

	it(`Should deserialize session data as expected (${i})`, function () {
		deserialized = serializer.parse(serialized);
		assert.deepEqual(data, deserialized);
	});
};

describe('serializer:', function () {
	/* eslint-disable mocha/no-setup-in-describe */
	const testCases: session.SessionData[] = [
		createFakeSession({}),
		createFakeSession({}, 0, 0),
		createFakeSession({ a: 'foo', b: 42, c: true, d: false, e: null }, 0, 0),
		createFakeSession({ a: { b: { c: 'd' } } }),
	];

	describe('serialize and deserialize', function () {
		testCases.forEach((testCase, i) => {
			testSerialization(testCase, i);
		});
	});
	/* eslint-enable mocha/no-setup-in-describe */
});
/* eslint-enable func-names */
