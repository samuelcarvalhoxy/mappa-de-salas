const UTF8_BOM = Uint8Array.of(0xef, 0xbb, 0xbf);

export function encodeCsvUtf8WithBom(content: string) {
  const encoded = new TextEncoder().encode(content);
  const output = new Uint8Array(UTF8_BOM.length + encoded.length);
  output.set(UTF8_BOM, 0);
  output.set(encoded, UTF8_BOM.length);
  return output;
}
