import { useRef, useCallback, useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const width = useProjectStore((s) => s.width);
  const height = useProjectStore((s) => s.height);
  const zoom = useProjectStore((s) => s.canvasZoom);
  const panX = useProjectStore((s) => s.canvasPanX);
  const panY = useProjectStore((s) => s.canvasPanY);
  const compositedSvg = useProjectStore((s) => s.compositedSvg);
  const background = useProjectStore((s) => s.background);
  const setCanvasZoom = useProjectStore((s) => s.setCanvasZoom);
  const setCanvasPan = useProjectStore((s) => s.setCanvasPan);
  const setCanvasContainerSize = useProjectStore((s) => s.setCanvasContainerSize);
  const resetCanvasView = useProjectStore((s) => s.resetCanvasView);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width: cw, height: ch } = entries[0].contentRect;
      setCanvasContainerSize(cw, ch);
    });
    ro.observe(el);
    // Initial fit
    const { width: cw, height: ch } = el.getBoundingClientRect();
    setCanvasContainerSize(cw, ch);
    // Use a microtask so the container size is stored before we fit
    queueMicrotask(() => resetCanvasView());
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setCanvasZoom(zoom * delta);
    },
    [zoom, setCanvasZoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.shiftKey) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        setCanvasPan(panX + dx, panY + dy);
      }
    },
    [panX, panY, setCanvasPan]
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return (
    <div
      className="canvas-container"
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="canvas-transform"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
        }}
      >
        <svg
          className="canvas-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background */}
          {background.type === 'none' && (
            <rect width={width} height={height} fill="white" />
          )}
          {background.type === 'solid' && (
            <rect width={width} height={height} fill={background.color} />
          )}
          {background.type === 'image' && background.imageData && (
            <>
              <rect width={width} height={height} fill="white" />
              <image
                href={background.imageData}
                width={width}
                height={height}
              />
            </>
          )}
          {/* Render composited SVG content */}
          {compositedSvg && (
            <g dangerouslySetInnerHTML={{ __html: compositedSvg }} />
          )}
        </svg>
      </div>
    </div>
  );
}
