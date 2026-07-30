export function validMp3Bytes(seed = 0): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  frame[4] = seed & 0xff;
  return frame;
}

export function validMp3DataUrl(seed = 0): string {
  return `data:audio/mpeg;base64,${Buffer.from(validMp3Bytes(seed)).toString("base64")}`;
}
