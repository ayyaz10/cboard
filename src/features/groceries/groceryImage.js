import { readRecipeImage } from "../recipes/recipeImage";

// Grocery rows only need thumbnails: keep account saves small and quick.
export async function readGroceryImage(file) {
  const validated = await readRecipeImage(file);
  return resizeGroceryImage(validated);
}

export async function resizeGroceryImage(source) {
  if (
    typeof source !== "string" ||
    source.length > 8 * 1024 * 1024 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(source)
  ) {
    throw new Error(
      "The photo could not be opened. Please retry or upload a photo.",
    );
  }
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error(
      "The photo could not be opened. Please retry or upload a photo.",
    );
  }
  if (image.naturalWidth * image.naturalHeight > 40000000)
    throw new Error("The photo is too large. Please upload a smaller image.");
  const scale = Math.min(
    1,
    256 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.8);
}
