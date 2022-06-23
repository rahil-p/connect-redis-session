const path = require('path');
const { promises: fs } = require('fs');
const luamin = require('luamin');

const inDir = path.join(__dirname, 'lua');
const outDir = path.join(__dirname, 'build', 'lua');

const build = async () => {
	const [files] = await Promise.all([
		await fs.readdir(inDir),
		await fs.mkdir(outDir, { recursive: true }),
	]);

	const buildPromises = files.map(async file => {
		const script = await fs.readFile(path.join(inDir, file));
		const minScript = luamin.minify(script.toString());
		const dest = path.join(outDir, file);
		await fs.writeFile(dest, minScript);
	});

	await Promise.all(buildPromises);
}

build().catch(error => {
	console.error(error);
	process.exit(1);
});
