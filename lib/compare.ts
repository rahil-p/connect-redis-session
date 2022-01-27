interface Indexable {
	[key: string]: unknown;
}

const isIndexable = (value: unknown): value is Indexable => !!value && typeof value === 'object';

export const deepEqual = (a: unknown, b: unknown) => {
	if (a === b) return true;

	if (isIndexable(a) && isIndexable(b)) {
		if (Object.keys(a).length !== Object.keys(b).length) return false;

		// eslint-disable-next-line no-restricted-syntax
		for (const prop in a) {
			// eslint-disable-next-line no-prototype-builtins
			if (b.hasOwnProperty(prop)) {
				if (!deepEqual(a[prop], b[prop])) return false;
			} else return false;
		}

		return true;
	}

	return false;
};
