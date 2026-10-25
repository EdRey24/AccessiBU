import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    HostInstance,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    ScrollView,
    ScrollViewInstance,
    StyleSheet,
    View
} from 'react-native';

import { clampZoom, MAX_ZOOM, MIN_ZOOM } from '@/constants/plan-marker';
import { BU, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { FloorPlan, planAspect, type FloorPlanProps } from './floor-plan';
import { ThemedText } from './themed-text';

/** Zoom levels the buttons step through. A pinch can land between them. */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

/** Mouse drags shorter than this many pixels are clicks, not a pan. */
const PAN_SLOP = 8;
/** How fast the mouse wheel zooms. One notch of a typical wheel is about 15%. */
const WHEEL_SPEED = 0.0015;

type Touch = { pageX: number; pageY: number };

/** The DOM element that really scrolls for a ScrollView, on web. */
function scrollNode(ref: { current: ScrollViewInstance | null }): HTMLElement | null {
  const instance = ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null;
  return instance?.getScrollableNode?.() ?? null;
}

/**
 * A floor plan with zoom controls, for picking an exact spot on a small screen.
 *
 * Zoom with the + and - buttons or by pinching. While zoomed, drag to move
 * around the plan and tap to place the pin. At the fitted size the pin is
 * dragged as before. The pin shrinks as you zoom in, so the spot stays visible.
 */
export function ZoomableFloorPlan(props: Omit<FloorPlanProps, 'zoom' | 'tapToPlace'>) {
  const theme = useTheme();
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState(0);

  const viewportRef = useRef<HostInstance>(null);
  const verticalRef = useRef<ScrollViewInstance>(null);
  const horizontalRef = useRef<ScrollViewInstance>(null);
  // The spot on the plan under the mouse when the wheel zooms, so it stays put.
  const anchorRef = useRef<{ nx: number; ny: number; ox: number; oy: number } | null>(null);
  // Where the middle of the visible area sits on the plan, from 0 to 1. Kept
  // current while scrolling so a zoom change can stay centred on it.
  const centerRef = useRef({ x: 0.5, y: 0.5 });
  const lastZoomRef = useRef(1);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  const aspect = planAspect(props.floor ?? 0);
  const width = viewport * zoom;
  const height = width / aspect;
  const viewportHeight = viewport / aspect;
  const zoomed = zoom > 1.001;
  const placeable = !!props.onPlace;

  // After the plan changes size, bring the same part of it back into view.
  useLayoutEffect(() => {
    if (lastZoomRef.current === zoom) return;
    lastZoomRef.current = zoom;
    if (viewport <= 0) return;

    // Wheel zoom on web keeps the spot under the mouse where it was. The DOM
    // has already resized, so this can happen at once without a flicker.
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (anchor && Platform.OS === 'web') {
      const newWidth = viewport * zoom;
      const horizontal = scrollNode(horizontalRef);
      const vertical = scrollNode(verticalRef);
      if (horizontal) horizontal.scrollLeft = Math.max(0, anchor.nx * newWidth - anchor.ox);
      if (vertical) vertical.scrollTop = Math.max(0, anchor.ny * (newWidth / aspect) - anchor.oy);
      return;
    }

    const timer = setTimeout(() => {
      const center = centerRef.current;
      horizontalRef.current?.scrollTo({
        x: Math.max(0, center.x * viewport * zoom - viewport / 2),
        animated: false,
      });
      verticalRef.current?.scrollTo({
        y: Math.max(0, center.y * ((viewport * zoom) / aspect) - viewportHeight / 2),
        animated: false,
      });
    }, 30);
    return () => clearTimeout(timer);
  }, [zoom, viewport, aspect, viewportHeight]);

  // Web only: zoom with the mouse wheel and pan by dragging with the mouse.
  // These are native listeners because the wheel one must be non-passive to
  // stop the page from scrolling while the plan zooms. Touch screens keep using
  // pinch and native scrolling.
  useEffect(() => {
    if (Platform.OS !== 'web' || viewport <= 0) return;
    const element = viewportRef.current as unknown as HTMLElement | null;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const next = clampZoom(zoom * Math.exp(-event.deltaY * unit * WHEEL_SPEED));
      // At a limit (for example scrolling down at the fitted size) let the page scroll.
      if (Math.abs(next - zoom) < 0.001) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const ox = event.clientX - rect.left;
      const oy = event.clientY - rect.top;
      anchorRef.current = {
        nx: ((scrollNode(horizontalRef)?.scrollLeft ?? 0) + ox) / (viewport * zoom),
        ny: ((scrollNode(verticalRef)?.scrollTop ?? 0) + oy) / height,
        ox,
        oy,
      };
      setZoom(next);
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
    element.addEventListener('pointerdown', onPointerDown, true);
    element.addEventListener('mousedown', onMouseDown);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown, true);
      element.removeEventListener('mousedown', onMouseDown);
      endPan();
    };
  }, [zoom, zoomed, viewport, height]);

  const changeZoom = (next: number) => {
    const target = clampZoom(next);
    // Zooming in from the fitted view centres on the pin the member placed.
    if (zoom <= 1.001 && props.draftPin) centerRef.current = { ...props.draftPin };
    setZoom(target);
  };
  const zoomIn = () => changeZoom(ZOOM_STEPS.find((step) => step > zoom + 0.01) ?? MAX_ZOOM);
  const zoomOut = () =>
    changeZoom([...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.01) ?? MIN_ZOOM);

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

  // Pinch with two fingers. One finger still scrolls or places the pin.
  const distance = (touches: readonly Touch[]) =>
    Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
  const onTouchStart = (e: { nativeEvent: { touches: readonly Touch[] } }) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 2) pinchRef.current = { distance: distance(touches), zoom };
  };
  const onTouchMove = (e: { nativeEvent: { touches: readonly Touch[] } }) => {
    const touches = e.nativeEvent.touches;
    const start = pinchRef.current;
    if (touches.length !== 2 || !start || start.distance < 1) return;
    setZoom(clampZoom(start.zoom * (distance(touches) / start.distance)));
  };
  const onTouchEnd = (e: { nativeEvent: { touches: readonly Touch[] } }) => {
    if (e.nativeEvent.touches.length < 2) pinchRef.current = null;
  };

  const percent = `${Math.round(zoom * 100)}%`;

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {zoomed
            ? placeable
              ? `Drag to move around. ${Platform.OS === 'web' ? 'Click' : 'Tap'} to place the pin.`
              : 'Drag to move around.'
            : Platform.OS === 'web'
              ? 'Scroll the mouse wheel over the plan to zoom in.'
              : 'Pinch or use + to zoom in.'}
        </ThemedText>
        <View style={styles.buttons}>
          <ZoomButton label="−" description="Zoom out" disabled={!zoomed} onPress={zoomOut} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fit the whole plan"
            disabled={!zoomed}
            onPress={() => changeZoom(MIN_ZOOM)}
            style={[styles.fit, { borderColor: theme.border, opacity: zoomed ? 1 : 0.5 }]}>
            <ThemedText type="smallBold">{zoomed ? percent : 'Fit'}</ThemedText>
          </Pressable>
          <ZoomButton
            label="+"
            description="Zoom in"
            disabled={zoom >= MAX_ZOOM - 0.01}
            onPress={zoomIn}
          />
        </View>
      </View>

      <View
        ref={viewportRef}
        onLayout={(e) => setViewport(e.nativeEvent.layout.width)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}>
        {viewport > 0 ? (
          <ScrollView
            ref={verticalRef}
            nestedScrollEnabled
            scrollEnabled={zoomed}
            bounces={false}
            showsVerticalScrollIndicator={zoomed}
            scrollEventThrottle={16}
            onScroll={onVerticalScroll}
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
                <FloorPlan {...props} zoom={zoom} tapToPlace={zoomed} />
              </View>
            </ScrollView>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

function ZoomButton({
  label,
  description,
  disabled,
  onPress,
}: {
  label: string;
  description: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={description}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.zoomButton, { borderColor: theme.border, opacity: disabled ? 0.5 : 1 }]}>
      <ThemedText type="subtitle" style={styles.zoomLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: Spacing.two },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  hint: { flex: 1 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  zoomButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: { fontSize: 24, lineHeight: 28, color: BU.red },
  fit: {
    minWidth: 56,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
