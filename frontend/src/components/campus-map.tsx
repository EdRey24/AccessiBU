import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { CDS_LOCATION, MAPBOX_TOKEN, storedHazardLabel } from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';

type MapboxModule = typeof import('@rnmapbox/maps');

/**
 * @rnmapbox/maps needs custom native code. Expo Go does not include it, and
 * importing the package there throws. Load it defensively so the app still
 * opens in Expo Go and shows a fallback instead of crashing at startup.
 */
function loadMapbox(): MapboxModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@rnmapbox/maps') as MapboxModule;
    loaded.default.setAccessToken(MAPBOX_TOKEN);
    return loaded;
  } catch {
    return null;
  }
}

const mapbox = loadMapbox();

type CampusMapProps = {
  hazards: Hazard[];
  onSelectBuilding: () => void;
  onSelectHazard: (hazard: Hazard) => void;
};

/** Below this zoom the CDS chip hides (so it never mis-marks when zoomed out). */
const CHIP_MIN_ZOOM = 15.5;

/**
 * The campus map. Uses the real 3D Mapbox map in a development build, and a
 * plain list in Expo Go where the native map is not available.
 */
export function CampusMap(props: CampusMapProps) {
  if (!mapbox) return <MapUnavailable {...props} />;
  return <NativeCampusMap {...props} mapbox={mapbox} />;
}

/**
 * Real 3D campus map (Mapbox GL). A CDS hazard-count chip is shown as a marker
 * only when zoomed in past CHIP_MIN_ZOOM and hidden as you zoom out — no stem
 * or floating pin that mis-marks at distance. Individual hazard pins drill into
 * the 2D floor plan when tapped.
 */
function NativeCampusMap({
  hazards,
  onSelectBuilding,
  mapbox: { default: Mapbox, Camera, LocationPuck, MapView, MarkerView },
}: CampusMapProps & { mapbox: MapboxModule }) {
  const insideHazards = hazards.filter((h) => h.location === 'inside');
  const count = insideHazards.length;
  const [zoom, setZoom] = useState(16.8);
  const showChip = zoom >= CHIP_MIN_ZOOM;

  useEffect(() => {
    Mapbox.setTelemetryEnabled(false);
    // Request location so the live-location puck can render.
    Mapbox.requestAndroidLocationPermissions?.();
  }, [Mapbox]);

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL="mapbox://styles/mapbox/standard"
        scaleBarEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        pitchEnabled
        rotateEnabled
        onCameraChanged={(e) => setZoom(e.properties.zoom)}>
        <Camera
          defaultSettings={{
            centerCoordinate: [CDS_LOCATION.longitude, CDS_LOCATION.latitude],
            zoomLevel: 16.8,
            pitch: 60,
            heading: 20,
          }}
        />

        {/* Live "you are here" location puck */}
        <LocationPuck puckBearingEnabled puckBearing="heading" pulsing={{ isEnabled: true }} />

        {/* CDS hazard-count chip — only while zoomed in */}
        {showChip && (
          <MarkerView
            coordinate={[CDS_LOCATION.longitude, CDS_LOCATION.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Data Sciences Center, ${count} active hazard${count === 1 ? '' : 's'}. Tap to browse floors.`}
              onPress={onSelectBuilding}
              style={styles.chip}>
              <ThemedText type="smallBold" style={styles.chipTitle}>
                CDS
              </ThemedText>
              <ThemedText type="small" style={styles.chipCount}>
                {count} {count === 1 ? 'hazard' : 'hazards'}
              </ThemedText>
            </Pressable>
          </MarkerView>
        )}

      </MapView>
    </View>
  );
}

/** Stand-in for the map when the native Mapbox module is not available. */
function MapUnavailable({ hazards, onSelectBuilding, onSelectHazard }: CampusMapProps) {
  const theme = useTheme();
  const insideHazards = hazards.filter((h) => h.location === 'inside');
  const count = insideHazards.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.fallback}
      accessibilityLabel="Campus hazards">
      <View style={[styles.notice, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">The 3D campus map is not available here</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Expo Go does not include the map. Open a development build to see it. You can still view
          and report hazards on the floor plan.
        </ThemedText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Data Sciences Center, ${count} active hazard${count === 1 ? '' : 's'}. Open the floor plans.`}
        onPress={onSelectBuilding}
        style={styles.chip}>
        <ThemedText type="smallBold" style={styles.chipTitle}>
          CDS floor plans
        </ThemedText>
        <ThemedText type="small" style={styles.chipCount}>
          {count} {count === 1 ? 'hazard' : 'hazards'}
        </ThemedText>
      </Pressable>

      {insideHazards.map((hazard) => (
        <Pressable
          key={hazard.id}
          accessibilityRole="button"
          accessibilityLabel={`${hazard.hazardType ? storedHazardLabel(hazard.hazardType) : hazard.type}, severity ${hazard.severity} of 10`}
          onPress={() => onSelectHazard(hazard)}
          style={[styles.hazardRow, { borderColor: theme.border }]}>
          <View style={[styles.pin, { backgroundColor: severityColor(hazard.severity) }]}>
            <ThemedText type="smallBold" style={styles.pinText}>
              {hazard.severity}
            </ThemedText>
          </View>
          <View style={styles.hazardBody}>
            <ThemedText type="smallBold">
              {hazard.hazardType ? storedHazardLabel(hazard.hazardType) : hazard.type}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {hazard.description}
            </ThemedText>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fallback: { padding: Spacing.three, gap: Spacing.two },
  notice: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  chip: {
    backgroundColor: '#fff',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: BU.red,
    minWidth: 96,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  chipTitle: { color: BU.red },
  chipCount: { color: '#1A1A1A' },
  hazardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  hazardBody: { flex: 1, gap: 2 },
  pin: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: { color: '#fff', fontSize: 12 },
});
