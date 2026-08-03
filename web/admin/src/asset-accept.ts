// Supported graphic-asset formats for file-picker `accept` filters.
// MUST stay in sync with the server MIME allow-list (server/src/routes/assets.ts).
// Extensions are listed alongside MIME types because some OSes report .ico/.bmp
// with inconsistent MIME, and the extension is the reliable filter.
export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/x-icon,image/vnd.microsoft.icon,.png,.jpg,.jpeg,.gif,.webp,.bmp,.ico';

// image + audio (audio left broad — out of scope of the graphics filter)
export const MEDIA_ACCEPT = `${IMAGE_ACCEPT},audio/*`;
