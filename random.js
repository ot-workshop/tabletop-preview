export const randomUUID = () => crypto.randomUUID();
export function randomInt(max) {
  const bound = Math.floor(0x100000000 / max) * max;
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= bound);
  return value % max;
}
