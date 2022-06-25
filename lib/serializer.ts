import * as session from 'express-session';

/**
 * A serializer for encoding/decoding {@link session.SessionData} instances to/from strings.
 */
export interface Serializer {
	/* Decode a string-encoded session (e.g. {@link JSON.parse}). */
	parse: (text: string) => session.SessionData;
	/* Encode a session into a string (e.g. {@link JSON.stringify}). */
	stringify: (value: session.SessionData) => string;
}

/**
 * Custom serializer for converting session data to/from strings.
 */
const serializer: Serializer = {
	parse(text) {
		const value = JSON.parse(text) as Omit<session.SessionData, 'lastModified'> & {
			cookie: Omit<session.Cookie, 'expires'> & { expires?: number };
			lastModified?: number;
		};
		const { cookie, lastModified, ...rest } = value;

		return {
			cookie: {
				...cookie,
				expires: cookie.expires === undefined ? undefined : new Date(cookie.expires),
			},
			lastModified: lastModified === undefined ? undefined : new Date(lastModified),
			...rest,
		};
	},
	stringify(value) {
		const { cookie, lastModified, ...rest } = value;
		const data = {
			cookie: {
				...cookie,
				expires: cookie.expires?.getTime(),
			},
			lastModified: lastModified?.getTime(),
			...rest,
		};

		return JSON.stringify(data);
	},
};

export default serializer;
