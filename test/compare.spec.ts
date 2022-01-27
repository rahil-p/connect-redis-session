import { assert } from 'chai';
import { deepEqual } from '../lib/compare';

/* eslint-disable func-names */
const deepEqualTest = (expect: boolean, a: unknown, b: unknown) => {
	it(`${typeof a} vs ${typeof b} (${String(expect)})`, function () {
		const result = deepEqual(a, b);
		assert.strictEqual(result, expect);
	});
};

const clone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj)) as T;

describe('compare:', function () {
	describe('deepEqual', function () {
		const arr1 = [0, 1, 'foo'];
		const obj1 = { a: 1, b: ['x', 'y'] };
		const obj2 = { a: 1, b: { x: 'foo', y: [0, 1], z: { foo: 'bar' } } };

		/* eslint-disable mocha/no-setup-in-describe */
		deepEqualTest(true, 0, 0);
		deepEqualTest(false, 0, false);
		deepEqualTest(false, 1, true);
		deepEqualTest(true, 'foo', 'foo');
		deepEqualTest(false, 'foo', 'bar');
		deepEqualTest(true, arr1, arr1);
		deepEqualTest(true, arr1, clone(arr1));
		deepEqualTest(true, obj1, obj1);
		deepEqualTest(true, obj1, clone(obj1));
		deepEqualTest(false, obj1, { a: 1, c: obj1.b });
		deepEqualTest(false, obj1, { ...obj1, b: [...obj1.b, 1] });
		deepEqualTest(true, obj2, obj2);
		deepEqualTest(true, obj2, clone(obj2));
		deepEqualTest(false, obj2, { ...obj2, b: { ...obj2.b, y: [0] } });
		/* eslint-enable mocha/no-setup-in-describe */
	});
});
/* eslint-enable func-names */
