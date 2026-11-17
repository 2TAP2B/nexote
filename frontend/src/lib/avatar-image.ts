/** The picked photo as a centered square of `size` px (WebP, PNG where the
 *  browser can't encode WebP), so a phone photo uploads as a few KB. */
export async function squareImage(file: Blob, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't read the picture");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await encode("image/webp");
  if (webp?.type === "image/webp") return webp;
  const png = await encode("image/png");
  if (!png) throw new Error("Couldn't read the picture");
  return png;
}
