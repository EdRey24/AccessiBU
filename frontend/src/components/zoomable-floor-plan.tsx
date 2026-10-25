import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    HostInstance,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    ScrollView,
    ScrollViewInstance,
    StyleSheet,
    View,
} from 'react-native';

import { clampZoom, MIN_ZOOM } from '@/constants/plan-marker';
import { Spacing } from '@/constants/theme';

import { FloorPlan, planAspect, type FloorPlanProps } from './floor-plan';
import { ThemedText } from './themed-text';

/** Largest zoom the plan opens at when it fills the screen. */
const FILL_MAX_ZOOM = 3;
/** Mouse drags shorter than this many pixels are clicks, not a pan. */
const PAN_SLOP = 8;
/** How fast the mouse wheel zooms. One notch of a typical wheel is about 15%. */
const WHEEL_SPEED = 0.0015;
/** Two taps this close in time and place zoom in or back out. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;
/** A double-click this soon after a touch came from the touch screen, not a mouse. */
const TOUCH_DOUBLE_CLICK_MS = 1000;

type Touch = { pageX: number; pageY: number };
type TouchEvent = {
  nativeEvent: { touches: readonly Touch[]; changedTouches: readonly Touch[] };
};

/** The DOM element that really scrolls for a ScrollView, on web. */
function scrollNode(ref: { current: ScrollViewInstance | null }): HTMLElement | null {
  const instance = ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null;
  return instance?.getScrollableNode?.() ?? null;
}

type ZoomableFloorPlanProps = Omit<FloorPlanProps, 'zoom' | 'tapToPlace'> & {
  /**
   * Fill the space the parent gives it, and open zoomed in so a wide plan is
   * big enough to read on a narrow screen. Otherwise the plan is fitted to the
   * width and sized by its aspect ratio.
   */
  fill?: boolean;
};

/**
 * A floor plan you zoom the way you zoom any map: pinch, scroll the mouse
 * wheel, or double-tap. Drag to move around once it is zoomed in.
 *
 * Placing a pin: at the fitted size the pin is dragged. While zoomed in a tap
 * places it, so a drag is free to move the plan. The pin shrinks as you zoom in
 * so the exact spot stays visible.
 */
export function ZoomableFloorPlan({ fill = false, ...props }: ZoomableFloorPlanProps) {
  // null until the member zooms, so the opening zoom follows the screen size.
  const [userZoom, setUserZoom] = useState<number | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const viewportRef = useRef<HostInstance>(null);
  const verticalRef = useRef<ScrollViewInstance>(null);
  const horizontalRef = useRef<ScrollViewInstance>(null);
  // The spot on the plan under the pointer when a zoom starts, so it stays put.
  const anchorRef = useRef<{ nx: number; ny: number; ox: number; oy: number } | null>(null);
  // Where the middle of the visible area sits on the plan, from 0 to 1. Kept
  // current while scrolling so a zoom change can stay centred on it.
  const centerRef = useRef({ x: 0.5, y: 0.5 });
  const lastZoomRef = useRef(1);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastTouchRef = useRef(0);

  const viewport = box.w;
  const aspect = planAspect(props.floor ?? 0);
  // Zoom that makes the plan as tall as the space it is given, up to a limit.
  const fillZoom =
    fill && box.w > 0 && box.h > 0
      ? Math.min(FILL_MAX_ZOOM, Math.max(MIN_ZOOM, (box.h * aspect) / box.w))
      : MIN_ZOOM;
  const zoom = clampZoom(userZoom ?? fillZoom);
  const width = viewport * zoom;
  const height = width / aspect;
  const viewportHeight = fill ? box.h : viewport / aspect;
  // True when part of the plan is off screen, so dragging should move it.
  const zoomed = width > viewport + 1 || height > viewportHeight + 1;
  const placeable = !!props.onPlace;
  // Pins are sized for the opening view and shrink only as you zoom in further.
  const markerZoom = zoom / fillZoom;
  const ready = viewport > 0 && (!fill || box.h > 0);

  const setZoom = (next: number) => setUserZoom(clampZoom(next));
  /** Double-tap: zoom in from the opening view, or go back to it. */
  const toggleZoom = () => {
    if (zoom > fillZoom * 1.25) setUserZoom(null);
    else setZoom(fillZoom * 2);
  };

  // After the plan changes size, bring the same part of it back into view.
  useLayoutEffect(() => {
    if (lastZoomRef.current === zoom) return;
    lastZoomRef.current = zoom;
    if (viewport <= 0) return;

    // Zooming at the pointer on web keeps the spot under it where it was. The
    // DOM has already resized, so this happens at once without a flicker.
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (anchor && Platform.OS === 'web') {
      const newWidth = viewport * zoom;
      const newHeight = newWidth / aspect;
      const newOffsetY = Math.max(0, (viewportHeight - newHeight) / 2);
      const horizontal = scrollNode(horizontalRef);
      const vertical = scrollNode(verticalRef);
      if (horizontal) horizontal.scrollLeft = Math.max(0, anchor.nx * newWidth - anchor.ox);
      if (vertical) vertical.scrollTop = Math.max(0, anchor.ny * newHeight + newOffsetY - anchor.oy);
      return;
    }

    const timer = setTimeout(() => {
      const center = centerRef.current;
      const newWidth = viewport * zoom;
      horizontalRef.current?.scrollTo({
        x: Math.max(0, center.x * newWidth - viewport / 2),
        animated: false,
      });
      verticalRef.current?.scrollTo({
        y: Math.max(0, center.y * (newWidth / aspect) - viewportHeight / 2),
        animated: false,
      });
    }, 30);
    return () => clearTimeout(timer);
  }, [zoom, viewport, aspect, viewportHeight]);

  // Web only: zoom with the mouse wheel or a double-click, and pan by dragging
  // with the mouse. These are native listeners because the wheel one must be
  // non-passive to stop the page from scrolling while the plan zooms. Touch
  // screens use the pinch, double-tap, and native scrolling below.
  useEffect(() => {
    if (Platform.OS !== 'web' || viewport <= 0) return;
    const element = viewportRef.current as unknown as HTMLElement | null;
    if (!element) return;

    /** Remembers the plan spot under the pointer so a zoom keeps it in place. */
    const anchorAt = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      const ox = clientX - rect.left;
      const oy = clientY - rect.top;
      const offsetY = Math.max(0, (viewportHeight - height) / 2);
      anchorRef.current = {
        nx: ((scrollNode(horizontalRef)?.scrollLeft ?? 0) + ox) / (viewport * zoom),
        ny: ((scrollNode(verticalRef)?.scrollTop ?? 0) + oy - offsetY) / height,
        ox,
        oy,
      };
    };

    const onWheel = (event: WheelEvent) => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const next = clampZoom(zoom * Math.exp(-event.deltaY * unit * WHEEL_SPEED));
      // At a limit (for example scrolling down at the smallest size) let the page scroll.
      if (Math.abs(next - zoom) < 0.001) return;
      event.preventDefault();
      anchorAt(event.clientX, event.clientY);
      setUserZoom(next);
    };

    const onDoubleClick = (event: MouseEvent) => {
      // Placing a pin uses clicks, so a double-click only zooms a plan you are viewing.
      if (placeable) return;
      // A touch screen also sends a double-click after a double-tap. The touch
      // handler has already zoomed, so zooming again would undo it.
      if (Date.now() - lastTouchRef.current < TOUCH_DOUBLE_CLICK_MS) return;
      event.preventDefault();
      anchorAt(event.clientX, event.clientY);
      if (zoom > fillZoom * 1.25) setUserZoom(null);
      else setUserZoom(clampZoom(fillZoom * 2));
    };

    let pan: { startX: number; startY: number; x: number; y: number; moving: boolean } | null = null;
    const onPanMove = (event: PointerEvent) => {
      if (!pan) return;
      if (!pan.moving) {
        if (Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) <= PAN_SLOP) return;
        pan.moving = true;
        element.style.cursor = 'grabbing';
      }
      const horizontal = scrollNode(horizontalRef);
      const vertical = scrollNode(verticalRef);
      if (horizontal) horizontal.scrollLeft -= event.clientX - pan.x;
      if (vertical) vertical.scrollTop -= event.clientY - pan.y;
      pan.x = event.clientX;
      pan.y = event.clientY;
    };
    const endPan = () => {
      pan = null;
      element.style.cursor = '';
      element.style.userSelect = '';
      window.removeEventListener('pointermove', onPanMove);
      window.removeEventListener('pointerup', endPan);
      window.removeEventListener('pointercancel', endPan);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !zoomed) return;
      if (event.button !== 0 && event.button !== 1) return;
      pan = {
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        moving: false,
      };
      element.style.userSelect = 'none';
      window.addEventListener('pointermove', onPanMove);
      window.addEventListener('pointerup', endPan);
      window.addEventListener('pointercancel', endPan);
    };
    // A middle-button press would start the browser's own autoscroll.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1 && zoomed) event.preventDefault();
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('pointerdown', onPointerDown, true);
    element.addEventListener('mousedown', onMouseDown);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('pointerdown', onPointerDown, true);
      element.removeEventListener('mousedown', onMouseDown);
      endPan();
    };
  }, [zoom, zoomed, viewport, height, viewportHeight, fillZoom, placeable]);

  const onHorizontalScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!zoomed || viewport <= 0) return;
    const x = (e.nativeEvent.contentOffset.x + viewport / 2) / (viewport * zoom);
    centerRef.current.x = Math.min(1, Math.max(0, x));
  };
  const onVerticalScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!zoomed || viewport <= 0) return;
    const y = (e.nativeEvent.contentOffset.y + viewportHeight / 2) / height;
    centerRef.current.y = Math.min(1, Math.max(0, y));
  };

  // Touch: pinch with two fingers, double-tap to zoom. One finger still scrolls
  // or places the pin.
  const distance = (touches: readonly Touch[]) =>
    Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
  const onTouchStart = (e: TouchEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 2) {
      // Zooming in from the fitted view centres on the pin the member placed.
      if (!zoomed && props.draftPin) centerRef.current = { ...props.draftPin };
      pinchRef.current = { distance: distance(touches), zoom };
      tapStartRef.current = null;
      lastTapRef.current = null;
    } else if (touches.length === 1) {
      tapStartRef.current = { x: touches[0].pageX, y: touches[0].pageY };
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    const touches = e.nativeEvent.touches;
    const start = pinchRef.current;
    if (touches.length === 1 && tapStartRef.current) {
      const moved = Math.hypot(
        touches[0].pageX - tapStartRef.current.x,
        touches[0].pageY - tapStartRef.current.y
      );
      if (moved > DOUBLE_TAP_SLOP) tapStartRef.current = null;
    }
    if (touches.length !== 2 || !start || start.distance < 1) return;
    setZoom(start.zoom * (distance(touches) / start.distance));
  };
  const onTouchEnd = (e: TouchEvent) => {
    lastTouchRef.current = Date.now();
    const wasPinch = pinchRef.current !== null;
    if (e.nativeEvent.touches.length < 2) pinchRef.current = null;
    if (e.nativeEvent.touches.length > 0) return;
    const start = tapStartRef.current;
    tapStartRef.current = null;
    // A quick second tap on a plan being viewed zooms it. Placing a pin uses taps.
    if (!start || wasPinch || placeable) return;
    const now = Date.now();
    const previous = lastTapRef.current;
    if (
      previous &&
      now - previous.time < DOUBLE_TAP_MS &&
      Math.hypot(start.x - previous.x, start.y - previous.y) < DOUBLE_TAP_SLOP
    ) {
      lastTapRef.current = null;
      toggleZoom();
    } else {
      lastTapRef.current = { time: now, x: start.x, y: start.y };
    }
  };

  // A phone browser is "web" too but has no mouse. Only a fine pointer (a mouse
  // or trackpad) gets wheel and click wording.
  const hasMouse =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: fine)').matches === true;

  return (
    <View style={[styles.container, fill && styles.fill]}>
      {placeable ? (
        <ThemedText type="small" themeColor="textSecondary">
          {zoomed
            ? `Drag to move around. ${hasMouse ? 'Click' : 'Tap'} to place the pin.`
            : hasMouse
              ? 'Scroll to zoom in for a precise spot, then click to place the pin.'
              : 'Pinch to zoom in for a precise spot, then tap to place the pin.'}
        </ThemedText>
      ) : null}

      <View
        ref={viewportRef}
        style={fill ? styles.fill : undefined}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}>
        {ready ? (
          <ScrollView
            ref={verticalRef}
            nestedScrollEnabled
            scrollEnabled={zoomed}
            bounces={false}
            showsVerticalScrollIndicator={zoomed}
            scrollEventThrottle={16}
            onScroll={onVerticalScroll}
            // A plan shorter than the space it fills sits in the middle.
            contentContainerStyle={fill ? styles.centered : undefined}
            style={{ width: viewport, height: viewportHeight }}>
            <ScrollView
              ref={horizontalRef}
              horizontal
              nestedScrollEnabled
              scrollEnabled={zoomed}
              bounces={false}
              showsHorizontalScrollIndicator={zoomed}
              scrollEventThrottle={16}
              onScroll={onHorizontalScroll}>
              <View style={{ width, height }}>
                <FloorPlan {...props} zoom={markerZoom} tapToPlace={zoomed} />
              </View>
            </ScrollView>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: Spacing.two },
  fill: { flex: 1 },
  centered: { flexGrow: 1, justifyContent: 'center' },
});
