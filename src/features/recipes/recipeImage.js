export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const isRecipeImage = (url) =>
  typeof url === 'string' &&
  url.length <= 1400000 &&
  /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url);

export async function readRecipeImage(file) {
  if (
    !/\.(jpe?g|png|webp)$/i.test(file.name) ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  )
    throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error('Choose an image smaller than 5 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, index) => bytes[index] === byte,
  );
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!{ 'image/jpeg': jpeg, 'image/png': png, 'image/webp': webp }[file.type])
    throw new Error('The image contents do not match its file type.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 40000000)
      throw new Error('Choose an image under 40 megapixels.');
    const scale = Math.min(
      1,
      1400 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.82);
    if (!isRecipeImage(result))
      throw new Error(
        'This image is too large after resizing. Try a smaller image.',
      );
    return result;
  } catch (error) {
    throw new Error(
      error.message || 'This image could not be opened. Try another file.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
