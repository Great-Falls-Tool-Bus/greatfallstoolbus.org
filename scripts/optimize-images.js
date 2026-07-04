#!/usr/bin/env node
// greatfallstoolbus.org responsive image + SVG optimizer (TIN-2224, Wave-2.5).
//
// Backfeed of MassageIthaca's proven web-perf craft, adapted to the
// scaffold's static-spoke context. Two pipelines:
//   sharp: rasters (jpg/jpeg/png/webp) -> webp + avif at responsive
//          widths, plus an optimized original-size pair.
//   svgo:  vector assets (svg) -> minified copies under optimized/.
// Both feed a single manifest at static/image-manifest.json (a committed
// empty fallback carries zero-photo builds) so callers can resolve the
// best candidate without re-scanning the filesystem. Each raster entry
// also records intrinsic width/height so Picture.svelte can reserve the
// layout box and prevent CLS.
//
// Source assets in static/ are never mutated; every artifact lands under
// static/optimized/ (gitignored). Run via `just optimize-images`, or let
// `just build` chain it automatically when static/photos exists.
import sharp from 'sharp';
import { optimize as svgoOptimize } from 'svgo';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATIC_DIR = path.join(__dirname, '..', 'static');
const OUTPUT_DIR = path.join(STATIC_DIR, 'optimized');
const MANIFEST_PATH = path.join(STATIC_DIR, 'image-manifest.json');

// Responsive widths (mirrors MassageIthaca/scripts/optimize-images.js).
const SIZES = {
	thumbnail: 150,
	small: 400,
	medium: 800,
	large: 1200,
	xlarge: 1920,
};

const FORMATS = ['webp', 'avif'];

async function ensureDir(dirPath) {
	try {
		await fs.mkdir(dirPath, { recursive: true });
	} catch (err) {
		console.error(`Failed to create directory ${dirPath}:`, err);
	}
}

async function getAssetFiles(dir) {
	const raster = [];
	const vector = [];
	let items;
	try {
		items = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return { raster, vector };
	}

	for (const item of items) {
		const fullPath = path.join(dir, item.name);
		if (item.isDirectory() && !item.name.startsWith('optimized')) {
			const nested = await getAssetFiles(fullPath);
			raster.push(...nested.raster);
			vector.push(...nested.vector);
		} else if (item.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(item.name)) {
			raster.push(fullPath);
		} else if (item.isFile() && /\.svg$/i.test(item.name)) {
			vector.push(fullPath);
		}
	}

	return { raster, vector };
}

async function optimizeRaster(inputPath) {
	const relativePath = path.relative(STATIC_DIR, inputPath);
	const parsed = path.parse(relativePath);
	const outputBase = path.join(OUTPUT_DIR, parsed.dir);

	await ensureDir(outputBase);

	const metadata = await sharp(inputPath).metadata();

	console.log(`Optimizing raster: ${relativePath}`);

	const operations = [];

	for (const [sizeName, width] of Object.entries(SIZES)) {
		// Skip if original is smaller than the target width.
		if (metadata.width && metadata.width < width) continue;

		for (const format of FORMATS) {
			const outputPath = path.join(outputBase, `${parsed.name}-${sizeName}.${format}`);

			operations.push(
				sharp(inputPath)
					.resize(width, null, { withoutEnlargement: true, fit: 'inside' })
					[format]({
						quality: format === 'webp' ? 85 : 80,
						effort: format === 'avif' ? 4 : 6,
					})
					.toFile(outputPath)
					.then(() => console.log(`  ✓ ${sizeName} ${format}`))
					.catch((err) => console.error(`  ✗ ${sizeName} ${format}:`, err.message)),
			);
		}
	}

	// Optimized original-size pair.
	for (const format of FORMATS) {
		const outputPath = path.join(outputBase, `${parsed.name}.${format}`);
		operations.push(
			sharp(inputPath)
				[format]({
					quality: format === 'webp' ? 90 : 85,
					effort: format === 'avif' ? 4 : 6,
				})
				.toFile(outputPath)
				.then(() => console.log(`  ✓ original ${format}`))
				.catch((err) => console.error(`  ✗ original ${format}:`, err.message)),
		);
	}

	await Promise.all(operations);
}

async function optimizeVector(inputPath) {
	const relativePath = path.relative(STATIC_DIR, inputPath);
	const parsed = path.parse(relativePath);
	const outputBase = path.join(OUTPUT_DIR, parsed.dir);

	await ensureDir(outputBase);

	console.log(`Optimizing vector: ${relativePath}`);

	const source = await fs.readFile(inputPath, 'utf8');
	const result = svgoOptimize(source, {
		path: inputPath,
		multipass: true,
	});

	const outputPath = path.join(outputBase, `${parsed.name}.svg`);
	await fs.writeFile(outputPath, result.data);

	const saved = source.length - result.data.length;
	console.log(`  ✓ svg (${saved >= 0 ? '-' : '+'}${Math.abs(saved)} bytes)`);
}

// Intrinsic pixel size, best effort. Rasters always resolve; vectors resolve
// when librsvg can rasterize them. Consumers (Picture.svelte) use these to
// set width/height + aspect-ratio and eliminate layout shift (CLS).
async function intrinsicSize(inputPath) {
	try {
		const metadata = await sharp(inputPath).metadata();
		if (typeof metadata.width === 'number' && typeof metadata.height === 'number') {
			return { width: metadata.width, height: metadata.height };
		}
	} catch {
		// Unreadable by sharp (unusual svg, etc.); entry ships without size.
	}
	return {};
}

async function generateManifest(raster, vector) {
	const manifest = {};

	for (const imagePath of raster) {
		const relativePath = path.relative(STATIC_DIR, imagePath);
		const parsed = path.parse(relativePath);
		const baseName = path.posix.join(parsed.dir.replace(/\\/g, '/'), parsed.name);

		manifest[baseName] = {
			type: 'raster',
			original: '/' + relativePath.replace(/\\/g, '/'),
			...(await intrinsicSize(imagePath)),
			optimized: {},
		};

		for (const [sizeName] of Object.entries(SIZES)) {
			for (const format of FORMATS) {
				const optimizedPath = path.join(OUTPUT_DIR, parsed.dir, `${parsed.name}-${sizeName}.${format}`);
				try {
					await fs.access(optimizedPath);
					if (!manifest[baseName].optimized[format]) {
						manifest[baseName].optimized[format] = {};
					}
					manifest[baseName].optimized[format][sizeName] = path.posix.join(
						'/optimized',
						parsed.dir.replace(/\\/g, '/'),
						`${parsed.name}-${sizeName}.${format}`,
					);
				} catch {
					// Candidate not generated (original smaller than this width).
				}
			}
		}
	}

	for (const svgPath of vector) {
		const relativePath = path.relative(STATIC_DIR, svgPath);
		const parsed = path.parse(relativePath);
		const baseName = path.posix.join(parsed.dir.replace(/\\/g, '/'), parsed.name);

		manifest[baseName] = {
			type: 'vector',
			original: '/' + relativePath.replace(/\\/g, '/'),
			...(await intrinsicSize(svgPath)),
			optimized: {
				svg: path.posix.join('/optimized', parsed.dir.replace(/\\/g, '/'), `${parsed.name}.svg`),
			},
		};
	}

	await ensureDir(path.dirname(MANIFEST_PATH));
	await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
	console.log(`\nManifest written: ${path.relative(process.cwd(), MANIFEST_PATH)}`);
}

async function main() {
	console.log('Starting image optimization...\n');

	await ensureDir(OUTPUT_DIR);

	const { raster, vector } = await getAssetFiles(STATIC_DIR);
	console.log(`Found ${raster.length} raster + ${vector.length} vector asset(s)\n`);

	for (const image of raster) await optimizeRaster(image);
	for (const svg of vector) await optimizeVector(svg);

	await generateManifest(raster, vector);

	console.log('\nImage optimization complete.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
