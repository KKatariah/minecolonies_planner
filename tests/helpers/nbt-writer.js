// Minimal NBT *encoder*, test-only - the app itself only ever reads NBT. Lets
// tests build exact byte sequences (including deliberately malformed ones)
// instead of depending on opaque binary fixtures.
//
// Values are described with explicit tags so every NBT type can be produced:
//   compound({ name: str("Bob"), age: int(3) })
//   list(TAG.Int, [1, 2, 3])

const TAG = {
	End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
	ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
};

const tagged = (type, value) => ({ type, value });
const byte = (v) => tagged(TAG.Byte, v);
const short = (v) => tagged(TAG.Short, v);
const int = (v) => tagged(TAG.Int, v);
const long = (v) => tagged(TAG.Long, BigInt(v));
const float = (v) => tagged(TAG.Float, v);
const double = (v) => tagged(TAG.Double, v);
const byteArray = (v) => tagged(TAG.ByteArray, v);
const str = (v) => tagged(TAG.String, v);
const intArray = (v) => tagged(TAG.IntArray, v);
const longArray = (v) => tagged(TAG.LongArray, v.map(BigInt));
// list items are raw values (not tagged) - the element type is shared.
const list = (elementType, items) => tagged(TAG.List, { elementType, items });
// entries: object or array of [name, taggedValue] pairs (the array form
// allows names like "__proto__" that an object literal would swallow).
const compound = (entries) =>
	tagged(TAG.Compound, Array.isArray(entries) ? entries : Object.entries(entries));

class ByteWriter {
	constructor() {
		this.chunks = [];
	}
	push(size, write) {
		const buf = new DataView(new ArrayBuffer(size));
		write(buf);
		this.chunks.push(new Uint8Array(buf.buffer));
	}
	u8(v) { this.push(1, (d) => d.setUint8(0, v)); }
	i8(v) { this.push(1, (d) => d.setInt8(0, v)); }
	i16(v) { this.push(2, (d) => d.setInt16(0, v)); }
	u16(v) { this.push(2, (d) => d.setUint16(0, v)); }
	i32(v) { this.push(4, (d) => d.setInt32(0, v)); }
	i64(v) { this.push(8, (d) => d.setBigInt64(0, v)); }
	f32(v) { this.push(4, (d) => d.setFloat32(0, v)); }
	f64(v) { this.push(8, (d) => d.setFloat64(0, v)); }
	raw(bytes) { this.chunks.push(Uint8Array.from(bytes)); }
	string(s) {
		const bytes = new TextEncoder().encode(s);
		this.u16(bytes.length);
		this.chunks.push(bytes);
	}
	toArrayBuffer() {
		const total = this.chunks.reduce((n, c) => n + c.length, 0);
		const out = new Uint8Array(total);
		let offset = 0;
		for (const c of this.chunks) {
			out.set(c, offset);
			offset += c.length;
		}
		return out.buffer;
	}
}

function writePayload(w, type, value) {
	switch (type) {
		case TAG.Byte: return w.i8(value);
		case TAG.Short: return w.i16(value);
		case TAG.Int: return w.i32(value);
		case TAG.Long: return w.i64(BigInt(value));
		case TAG.Float: return w.f32(value);
		case TAG.Double: return w.f64(value);
		case TAG.String: return w.string(value);
		case TAG.ByteArray:
			w.i32(value.length);
			return value.forEach((v) => w.i8(v));
		case TAG.IntArray:
			w.i32(value.length);
			return value.forEach((v) => w.i32(v));
		case TAG.LongArray:
			w.i32(value.length);
			return value.forEach((v) => w.i64(BigInt(v)));
		case TAG.List:
			w.u8(value.elementType);
			w.i32(value.items.length);
			return value.items.forEach((item) => writePayload(w, value.elementType, item));
		case TAG.Compound:
			for (const [name, child] of value) {
				w.u8(child.type);
				w.string(name);
				writePayload(w, child.type, child.value);
			}
			return w.u8(TAG.End);
		default:
			throw new Error(`nbt-writer: unknown tag ${type}`);
	}
}

// Encodes a full NBT file: root compound tag + name + payload.
function encodeNbt(rootCompound, rootName = "") {
	const w = new ByteWriter();
	w.u8(TAG.Compound);
	w.string(rootName);
	writePayload(w, TAG.Compound, rootCompound.value);
	return w.toArrayBuffer();
}

// Encodes just a payload (for building compound/list *contents* by hand).
function encodePayload(type, value) {
	const w = new ByteWriter();
	writePayload(w, type, value);
	return w.toArrayBuffer();
}

module.exports = {
	TAG, ByteWriter, encodeNbt, encodePayload,
	byte, short, int, long, float, double, byteArray, str, intArray, longArray, list, compound,
};
