import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const options = {
	entryPoints: ['src/activate.ts'],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'cjs',
	outfile: 'dist/extension.js',
	external: ['vscode'],
	sourcemap: true,
	minify: false,
	keepNames: true,
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log('[esbuild] watching for changes...');
} else {
	await esbuild.build(options);
	console.log('[esbuild] build complete');
}
