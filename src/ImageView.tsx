// src/ImageView.tsx
import { useCallback, useEffect, useState } from "react";
import { useL10n } from "./use-l10n.js";
import { initialZoom, setFitZoom, toggleZoom, zoomIn, zoomOut, type ZoomState } from "./image-view.js";

const TOO_LARGE_PIXELS = 40_000_000;

export interface ImageViewProps {
  src: string;
  onRetry: () => void;
}

export function ImageView({ src, onRetry }: ImageViewProps) {
  const { t } = useL10n();
  const [zoom, setZoom] = useState<ZoomState>(initialZoom);
  const [failed, setFailed] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setZoom(initialZoom);
    setFailed(false);
    setTooLarge(false);
    setDims(null);
  }, [src]);

  const handleLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setDims({ width: img.naturalWidth, height: img.naturalHeight });
    setTooLarge(img.naturalWidth * img.naturalHeight > TOO_LARGE_PIXELS);
    setFailed(false);
  }, []);

  // Zoom is controlled by the toolbar buttons and double-click only.
  // The wheel is deliberately NOT hijacked (no wheel zoom): plain wheel keeps
  // its native behavior (stage/page scroll, browser Ctrl+wheel zoom).

  const imgStyle: React.CSSProperties =
    zoom.mode === "custom"
      ? { transform: "scale(" + zoom.scale + ")", width: dims ? dims.width : undefined }
      : {};

  return (
    <div className="fm-image-view">
      <div className="fm-image-toolbar" role="toolbar" aria-label={t("imageToolbar")}>
        <button type="button" aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => setZoom(zoomOut)}>−</button>
        <button type="button" aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => setZoom(zoomIn)}>+</button>
        <button
          type="button"
          className={zoom.mode === "fit" ? "is-active" : ""}
          aria-pressed={zoom.mode === "fit"}
          onClick={() => setZoom(setFitZoom)}
        >
          {t("zoomFit")}
        </button>
        <button
          type="button"
          className={zoom.mode === "custom" && zoom.scale === 1 ? "is-active" : ""}
          aria-pressed={zoom.mode === "custom" && zoom.scale === 1}
          onClick={() => setZoom(toggleZoom)}
        >
          {t("zoomOriginal")}
        </button>
        <button type="button" onClick={() => window.open(src, "_blank", "noopener,noreferrer")}>
          {t("openOriginal")}
        </button>
        {dims && (
          <span className="fm-image-dims">{dims.width} × {dims.height}</span>
        )}
      </div>
      <div className="fm-image-stage" onDoubleClick={() => setZoom(toggleZoom)}>
        {failed ? (
          <div className="fm-image-error" role="alert">
            <span>{t("imageLoadFailed")}</span>
            <button type="button" onClick={onRetry}>{t("retry")}</button>
          </div>
        ) : (
          <img
            src={src}
            alt=""
            draggable={false}
            className={zoom.mode === "custom" ? "fm-image--custom" : undefined}
            style={imgStyle}
            onLoad={handleLoad}
            onError={() => setFailed(true)}
          />
        )}
        {!failed && tooLarge && (
          <div className="fm-preview-warning" role="status">{t("imageTooLarge")}</div>
        )}
      </div>
    </div>
  );
}
