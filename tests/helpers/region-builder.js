// Builds synthetic Minecraft region (.mca) files for tests - lets a test
// control exactly what's in a chunk (e.g. a hostile biome name) instead of
// relying only on the opaque bundled sample.

const zlib = require("zlib");
const W = require("./nbt-writer.js");

// Packs 256 heightmap values the way the game does: 9 bits each, 7 per long,
// padded (never split across longs) - 37 longs total.
function packHeightmap(heights) {
	const bits = 9n;
	const perLong = 7;
	const longs = [];
	for (let i = 0; i < heights.length; i += perLong) {
		let value = 0n;
		for (let k = 0; k < perLong && i + k < heights.length; k++) {
			value |= BigInt(heights[i + k]) << (bits * BigInt(k));
		}
		longs.push(BigInt.asIntN(64, value));
	}
	return longs;
}

// A fully generated chunk whose surface is flat at `surfaceY`, made of
// `block`, in one single `biome`.
function makeChunkNbt({ biome = "minecraft:plains", surfaceY = 64, block = "minecraft:grass_block", status = "minecraft:full" } = {}) {
	const packed = surfaceY + 64; // WORLD_SURFACE stores height above y=-64
	const heightmap = packHeightmap(new Array(256).fill(packed));
	const biomeSection = Math.floor(surfaceY / 16);
	const blockSection = Math.floor((surfaceY - 1) / 16);
	const sectionEntries = (y) => {
		const entries = [["Y", W.byte(y)]];
		if (y === blockSection) {
			entries.push(["block_states", W.compound({ palette: W.list(W.TAG.Compound, [[["Name", W.str(block)]]]) })]);
		}
		if (y === biomeSection) {
			entries.push(["biomes", W.compound({ palette: W.list(W.TAG.String, [biome]) })]);
		}
		return entries;
	};
	const sectionYs = [...new Set([blockSection, biomeSection])];
	return W.encodeNbt(
		W.compound({
			Status: W.str(status),
			Heightmaps: W.compound({ WORLD_SURFACE: W.longArray(heightmap) }),
			sections: W.list(W.TAG.Compound, sectionYs.map(sectionEntries)),
		}),
	);
}

// chunks: [{ cx, cz, nbt: ArrayBuffer, compression?: 1 (gzip) | 2 (zlib) | 3 (none) }]
function buildRegion(chunks) {
	const sectors = [new Uint8Array(8192)];
	const header = sectors[0];
	let nextSector = 2;
	for (const { cx, cz, nbt, compression = 2 } of chunks) {
		const raw = Buffer.from(nbt);
		const payload = compression === 2 ? zlib.deflateSync(raw) : compression === 1 ? zlib.gzipSync(raw) : raw;
		const body = new Uint8Array(5 + payload.length);
		new DataView(body.buffer).setUint32(0, payload.length + 1);
		body[4] = compression;
		body.set(payload, 5);
		const sectorCount = Math.ceil(body.length / 4096);
		const padded = new Uint8Array(sectorCount * 4096);
		padded.set(body);
		const index = (cx + cz * 32) * 4;
		header[index] = (nextSector >> 16) & 0xff;
		header[index + 1] = (nextSector >> 8) & 0xff;
		header[index + 2] = nextSector & 0xff;
		header[index + 3] = sectorCount;
		sectors.push(padded);
		nextSector += sectorCount;
	}
	return Buffer.concat(sectors);
}

module.exports = { makeChunkNbt, buildRegion, packHeightmap };
