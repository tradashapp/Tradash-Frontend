// Profile avatars. A photo the user picked from their device, stored as a
// data-URL. Older accounts may still hold an emoji here — the leaderboard's
// Avatar still renders those — but the picker that set them is gone: the
// account sheet now takes a photo or falls back to the handle's initials.

/** True when the stored avatar is a device photo rather than a legacy emoji. */
export function isPhotoAvatar(avatar: string): boolean {
  return avatar.startsWith("data:");
}

/** Longest side of a stored avatar photo, in px. */
const AVATAR_PX = 256;

/**
 * Read an image File and return a square, downscaled JPEG data-URL. Photos go
 * into the persisted settings blob, so they're cropped to a centre square and
 * re-encoded rather than stored at their original (multi-MB) size.
 */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Centre-crop to a square, then scale that square down to AVATAR_PX.
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_PX;
      canvas.height = AVATAR_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable"));
        return;
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}
