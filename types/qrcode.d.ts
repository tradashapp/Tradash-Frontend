// Minimal ambient types for the `qrcode` package (no bundled or @types typings).
// We only use the browser-safe toDataURL string form for the share-card QR.
declare module "qrcode" {
  interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
    scale?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }

  function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;

  const _default: { toDataURL: typeof toDataURL };
  export default _default;
  export { toDataURL };
}
