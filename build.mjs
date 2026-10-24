import * as esbuild from 'esbuild';

const serve = process.argv.includes('--serve');

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  outfile: 'wallpaper/app.js',
  legalComments: 'none',
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'wallpaper', port: 8080 });
  console.log(`Dev server: http://localhost:${port}/?weather=storm&time=night`);
} else {
  await esbuild.build(options);
}
