import Mapbox, { Camera, LocationPuck, MapView, MarkerView } from '@rnmapbox/maps';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { CDS_LOCATION, MAPBOX_TOKEN } from '@/constants/hazards';
import { BU, Spacing } from '@/constants/theme';

import { ThemedText } from './themed-text';

Mapbox.setAccessToken(MAPBOX_TOKEN);

type CampusMapProps = {
  hazards: Hazard[];
  onSelectBuilding: () => void;
  onSelectHazard: (hazard: Hazard) => void;
};

/** Below this zoom the CDS chip hides (so it never mis-marks when zoomed out). */
const CHIP_MIN_ZOOM = 15.5;

/**
 * Real 3D campus map (Mapbox GL). A CDS hazard-count chip is shown as a marker
 * only when zoomed in past CHIP_MIN_ZOOM and hidden as you zoom out — no stem
 * or floating pin that mis-marks at distance. Individual hazard pins drill into
 * the 2D floor plan when tapped.
 */
export function CampusMap({ hazards, onSelectBuilding, onSelectHazard }: CampusMapProps) {
  const insideHazards = hazards.filter((h) => h.location === 'inside');
  const count = insideHazards.length;
  const [zoom, setZoom] = useState(16.8);
  const showChip = zoom >= CHIP_MIN_ZOOM;

  useEffect(() => {
    Mapbox.setTelemetryEnabled(false);
    // Request location so the live-location puck can render.
    Mapbox.requestAndroidLocationPermissions?.();
  }, []);

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

const styles = StyleSheet.create({
  container: { flex: 1 },
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
