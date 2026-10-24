import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
    buildSpatialContext,
    CDS_FLOORS,
    CDS_LOCATION,
    floorLabel,
    floorPlanImage,
    gpsToPlanXY,
    isAtCDS,
    type Location as HazardLocation,
    type HazardType,
    type ReportMethod,
    type StoredHazardType,
} from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useHazards } from '@/hooks/use-hazards';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/services/api';
import { classifyHazard } from '@/services/classifier';
import { resolveFloor2Location } from '@/services/floor-geo';
import { submitTextReport } from '@/services/hazards';
import { pinSeverity, submitPhotoReport } from '@/services/reports';

import { CameraCapture } from './camera-capture';
import { Dropdown } from './dropdown';
import { FloorPlan } from './floor-plan';
import { ThemedText } from './themed-text';

type ReportHazardModalProps = {
  visible: boolean;
  onClose: () => void;
};

type LocationStatus = 'idle' | 'detecting' | 'at-cds' | 'elsewhere' | 'denied';
type Coords = { latitude: number; longitude: number; accuracy: number | null };

export function ReportHazardModal({ visible, onClose }: ReportHazardModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { addHazard } = useHazards();

  const [method, setMethod] = useState<ReportMethod>('photo');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The model result (type, severity, description) — null until classified.
  const [result, setResult] = useState<{
    type: HazardType;
    severity: number;
    baseSeverity: number;
    locationBonus: number;
    description: string;
    reason: string;
    fromBackend: boolean;
  } | null>(null);

  // Manual-report fields (editable only when there's no photo/model result).
  const [manualType, setManualType] = useState<HazardType>('Spill');
  const [description, setDescription] = useState('');

  const [location, setLocation] = useState<HazardLocation>('inside');
  const [locStatus, setLocStatus] = useState<LocationStatus>('idle');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [floor, setFloor] = useState(12);
  // Start with a center pin so the user just drags it to the exact spot.
  const [position, setPosition] = useState<{ x: number; y: number } | null>({ x: 0.5, y: 0.5 });

  const isPhoto = method === 'photo';
  const effectiveType = result ? result.type : manualType;
  // "You are here" dot: project the user's GPS onto the floor plan (approximate
  // indoors, so the user still drags the pin to the exact spot).
  const userDot = coords ? gpsToPlanXY(coords) : null;

  const reset = () => {
    setMethod('photo');
    setPhotoUri(null);
    setAnalyzing(false);
    setSubmitting(false);
    setSubmitError(null);
    setResult(null);
    setManualType('Spill');
    setDescription('');
    setLocation('inside');
    setLocStatus('idle');
    setCoords(null);
    setFloor(12);
    setPosition({ x: 0.5, y: 0.5 });
  };

  const close = () => {
    reset();
    onClose();
  };

  // Detect the building from GPS; also keeps coords for the spatial context.
  const detectBuilding = async (): Promise<Coords | null> => {
    setLocStatus('detecting');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocStatus('denied');
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const c: Coords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      };
      setCoords(c);
      const atCDS = isAtCDS(c);
      setLocation(atCDS ? 'inside' : 'outside');
      setLocStatus(atCDS ? 'at-cds' : 'elsewhere');
      return c;
    } catch {
      setLocStatus('denied');
      return null;
    }
  };

  // Run the classifier whenever we have a photo + a pin (so spatial context is
  // available). Re-runs if the pin or floor changes materially.
  const runClassifier = async (uri: string | null, gps: Coords | null, nextFloor = floor) => {
    const inside = gps ? isAtCDS(gps) : location === 'inside';
    if (!position || (nextFloor === 2 && inside)) return;
    setAnalyzing(true);
    try {
      const ctx = buildSpatialContext(nextFloor, position, gps);
      setResult(await classifyHazard(uri, ctx));
    } catch {
      setResult(null);
    } finally {
      setAnalyzing(false);
    }
  };

  // Photo captured -> detect building. An inside Floor 2 photo is classified
  // when the report is stored. Anywhere else still uses the preview classifier.
  const handleCapture = async (uri: string) => {
    setPhotoUri(uri);
    setCameraOpen(false);
    const gps = await detectBuilding();
    const staysInside = gps ? isAtCDS(gps) : true;
    if (floor === 2 && staysInside) return;
    await runClassifier(uri, gps);
  };

  // Validation. Photo flow needs a model result; manual flow requires the
  // fields the backend needs (description, floor, pin) since there's no image.
  const manualValid =
    description.trim().length > 0 &&
    (location === 'outside' || (floor !== null && position !== null));
  const storesPhoto = isPhoto && location === 'inside' && floor === 2 && !!photoUri && !!position;
  const canSubmit =
    !analyzing &&
    !submitting &&
    (storesPhoto ||
      (isPhoto
        ? !!result && (location === 'outside' || position !== null)
        : manualValid));

  const submit = async () => {
    if (!canSubmit || submitting) return;
    const spatialContext =
      location === 'inside' && position ? buildSpatialContext(floor, position, coords) : null;

    // Resolve the pin to its room + real coordinate (Floor 2 is digitized).
    const resolved =
      location === 'inside' && position && floor === 2
        ? resolveFloor2Location(position)
        : null;

    if (isPhoto && photoUri && resolved) {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const stored = await submitPhotoReport({
          uri: photoUri,
          latitude: resolved.coordinate.latitude,
          longitude: resolved.coordinate.longitude,
        });
        addHazard({
          id: stored.hazardId,
          createdAt: stored.createdAt,
          type: clientHazardType(stored.hazardType),
          hazardType: stored.hazardType,
          severity: stored.severityScore == null ? 5 : pinSeverity(stored.severityScore),
          severityScore: stored.severityScore,
          description: stored.summary,
          location,
          floor,
          position,
          method,
          photoUri,
          spatialContext,
          room: resolved.room,
          coordinate: resolved.coordinate,
        });
        close();
      } catch (error) {
        setSubmitError(
          error instanceof ApiError ? error.message : 'The report could not be stored.',
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Manual (and non-Floor-2 photo) reports now persist to the backend so
    // other devices see them. Resolve a real coordinate: a digitized Floor 2
    // pin is exact; otherwise fall back to GPS, then the CDS building center.
    const severity = result ? result.severity : 5;
    const coordinate =
      resolved?.coordinate ??
      (coords
        ? { latitude: coords.latitude, longitude: coords.longitude }
        : { latitude: CDS_LOCATION.latitude, longitude: CDS_LOCATION.longitude });

    setSubmitting(true);
    setSubmitError(null);
    try {
      const stored = await submitTextReport({
        type: effectiveType,
        description: description.trim(),
        severity,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        floor: location === 'inside' ? floor : null,
        position: location === 'inside' ? position : null,
      });
      addHazard({
        id: stored.hazardId,
        createdAt: stored.createdAt,
        type: effectiveType,
        hazardType: stored.hazardType,
        severity,
        severityScore: stored.severityScore,
        description: description.trim(),
        location,
        floor: location === 'inside' ? floor : null,
        position: location === 'inside' ? position : null,
        method,
        photoUri,
        spatialContext,
        severityReason: result?.reason,
        room: resolved?.room ?? null,
        coordinate,
      });
      close();
    } catch (error) {
      setSubmitError(
        error instanceof ApiError ? error.message : 'The report could not be stored.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const missingManual: string[] = [];
  if (!isPhoto) {
    if (!description.trim()) missingManual.push('description');
    if (location === 'inside' && !position) missingManual.push('pin');
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.four },
          ]}>
          <View style={styles.header}>
            <ThemedText type="subtitle" style={styles.title}>
              Report a hazard
            </ThemedText>
            <Pressable onPress={close} accessibilityLabel="Close" style={styles.closeBtn}>
              <ThemedText type="subtitle" themeColor="textSecondary">
                ✕
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            {/* Method toggle */}
            <View style={styles.methodRow}>
              <MethodButton
                label="Take a photo"
                icon="📷"
                active={method === 'photo'}
                onPress={() => {
                  setMethod('photo');
                  setResult(null);
                  setCameraOpen(true);
                }}
              />
              <MethodButton
                label="Manual report"
                icon="📋"
                active={method === 'manual'}
                onPress={() => {
                  setMethod('manual');
                  setPhotoUri(null);
                  setResult(null);
                  detectBuilding();
                }}
              />
            </View>

            {photoUri && (
              <Image source={{ uri: photoUri }} style={styles.preview} contentFit="cover" />
            )}

            {/* AI analysis status */}
            {analyzing && (
              <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
                <ActivityIndicator color={BU.red} />
                <ThemedText type="small">Classifying hazard & scoring severity…</ThemedText>
              </View>
            )}

            {/* Hazard type */}
            <ThemedText type="smallBold" style={styles.label}>
              Hazard type
            </ThemedText>
            {isPhoto ? (
              <View style={[styles.readonlyField, { borderColor: theme.border }]}>
                <ThemedText type="default" themeColor={result ? 'text' : 'textSecondary'}>
                  {storesPhoto
                    ? 'Classified when you submit.'
                    : result
                      ? result.type
                      : 'Take a photo to classify…'}
                </ThemedText>
              </View>
            ) : (
              <HazardTypeDropdown value={manualType} onChange={setManualType} />
            )}

            {/* Severity — model-assigned, read only (photo flow only) */}
            {isPhoto && (
              <SeverityResult
                result={storesPhoto ? null : result}
                empty={
                  storesPhoto
                    ? 'Severity is scored from the photo when the report is stored.'
                    : undefined
                }
              />
            )}

            {/* Description (required for manual) */}
            <View style={styles.labelRow}>
              <ThemedText type="smallBold" style={styles.label}>
                Description{!isPhoto ? ' *' : ''}
              </ThemedText>
              {!isPhoto && !description.trim() && (
                <ThemedText type="small" style={styles.required}>
                  required
                </ThemedText>
              )}
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder={isPhoto ? 'Add any extra details (optional)…' : 'Describe the hazard…'}
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.textArea,
                { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
              ]}
            />

            {/* Building (auto-detected) */}
            <View style={styles.buildingHeader}>
              <ThemedText type="smallBold" style={styles.label}>
                Building
              </ThemedText>
              <Pressable onPress={detectBuilding} accessibilityLabel="Re-detect location">
                <ThemedText type="small" style={{ color: BU.red }}>
                  {locStatus === 'detecting' ? 'detecting…' : '↻ use my location'}
                </ThemedText>
              </Pressable>
            </View>
            <LocationBanner status={locStatus} />
            <View style={styles.radioRow}>
              <RadioButton
                label="Inside CDS"
                selected={location === 'inside'}
                onPress={() => setLocation('inside')}
              />
              <RadioButton
                label="Outside CDS"
                selected={location === 'outside'}
                onPress={() => setLocation('outside')}
              />
            </View>

            {location === 'inside' && (
              <>
                <View style={styles.labelRow}>
                  <ThemedText type="smallBold" style={styles.label}>
                    Floor{!isPhoto ? ' *' : ''}
                  </ThemedText>
                </View>
                <Dropdown
                  value={floor}
                  onChange={(value) => {
                    setFloor(value);
                    if (value === 2) {
                      setResult(null);
                      return;
                    }
                    if (isPhoto && photoUri && position) {
                      void runClassifier(photoUri, coords, value);
                    }
                  }}
                  options={CDS_FLOORS}
                />

                <View style={styles.labelRow}>
                  <ThemedText type="smallBold" style={styles.label}>
                    Drag the pin to the exact spot{!isPhoto ? ' *' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    🛗 🪜 shown for context
                  </ThemedText>
                </View>
                <FloorPlan
                  planImage={floorPlanImage(floor)}
                  floor={floor}
                  draftPin={position}
                  userDot={userDot}
                  onPlace={(p) => {
                    setPosition(p);
                    if (isPhoto && photoUri && floor !== 2) {
                      const ctx = buildSpatialContext(floor, p, coords);
                      classifyHazard(photoUri, ctx).then(setResult).catch(() => setResult(null));
                    }
                  }}
                  showFeatures
                  caption={floorLabel(floor)}
                />
              </>
            )}
          </ScrollView>

          {submitError ? (
            <ThemedText type="small" style={styles.submitError}>
              {submitError}
            </ThemedText>
          ) : null}

          {/* Submit */}
          <Pressable
            accessibilityRole="button"
            onPress={submit}
            disabled={!canSubmit}
            style={[
              styles.submit,
              { backgroundColor: canSubmit ? BU.red : theme.backgroundSelected },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: canSubmit ? '#fff' : theme.textSecondary }}>
              {submitting
                ? 'Saving report…'
                : analyzing
                  ? 'Analyzing…'
                  : !isPhoto && missingManual.length
                    ? `Add ${missingManual.join(' & ')} to submit`
                    : 'Submit report'}
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <CameraCapture
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCapture}
      />
    </Modal>
  );
}

function clientHazardType(hazardType: StoredHazardType): HazardType {
  switch (hazardType) {
    case 'spill':
      return 'Spill';
    case 'blockage':
      return 'Blocked path';
    case 'elevator':
      return 'Broken elevator';
    case 'entrance':
      return 'Broken door';
    case 'walking_surface':
      return 'Wet floor';
    case 'other':
      return 'Other';
  }
}

function SeverityResult({
  result,
  empty = 'Severity is scored from the photo and where you pin it.',
}: {
  result: { severity: number; baseSeverity: number; locationBonus: number; reason: string } | null;
  empty?: string;
}) {
  const theme = useTheme();
  return (
    <>
      <ThemedText type="smallBold" style={styles.label}>
        Severity (assigned by AI)
      </ThemedText>
      <View style={[styles.severityCard, { borderColor: theme.border }]}>
        {result ? (
          <>
            <View style={styles.severityTop}>
              <View style={[styles.severityBadge, { backgroundColor: severityColor(result.severity) }]}>
                <ThemedText type="smallBold" style={styles.severityBadgeText}>
                  {result.severity}
                </ThemedText>
              </View>
              <View style={styles.severityMath}>
                <ThemedText type="small" themeColor="textSecondary">
                  base {result.baseSeverity}
                  {result.locationBonus > 0 ? `  +${result.locationBonus} location` : ''}
                  {`  =  ${result.severity}/10`}
                </ThemedText>
              </View>
            </View>
            {!!result.reason && (
              <ThemedText type="small" themeColor="textSecondary">
                {result.reason}
              </ThemedText>
            )}
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {empty}
          </ThemedText>
        )}
      </View>
    </>
  );
}

function HazardTypeDropdown({
  value,
  onChange,
}: {
  value: HazardType;
  onChange: (v: HazardType) => void;
}) {
  const options: HazardType[] = [
    'Spill',
    'Broken elevator',
    'Blocked path',
    'Broken door',
    'Wet floor',
    'Debris',
    'Lighting out',
    'Other',
  ];
  return (
    <Dropdown value={value} onChange={onChange} options={options.map((t) => ({ value: t, label: t }))} />
  );
}

function LocationBanner({ status }: { status: LocationStatus }) {
  const theme = useTheme();
  if (status === 'idle') return null;
  const msg =
    status === 'detecting'
      ? 'Detecting your location…'
      : status === 'at-cds'
        ? '📍 You appear to be inside CDS'
        : status === 'elsewhere'
          ? '📍 You appear to be outside CDS'
          : 'Location unavailable — select manually';
  return (
    <View style={[styles.locBanner, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {msg}
      </ThemedText>
    </View>
  );
}

function MethodButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.methodButton,
        {
          borderColor: active ? BU.red : theme.border,
          backgroundColor: active ? BU.red : theme.background,
        },
      ]}>
      <ThemedText type="smallBold" style={{ color: active ? '#fff' : theme.text }}>
        {icon} {label}
      </ThemedText>
    </Pressable>
  );
}

function RadioButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.radio}>
      <View style={[styles.radioOuter, { borderColor: selected ? '#2F7CF6' : theme.border }]}>
        {selected && <View style={styles.radioInner} />}
      </View>
      <ThemedText type="default">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    maxHeight: '92%',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  title: { fontSize: 28, lineHeight: 34 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: Spacing.three, paddingBottom: Spacing.three },
  methodRow: { flexDirection: 'row', gap: Spacing.three },
  methodButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: Spacing.three },
  submitError: { color: BU.red, marginBottom: Spacing.two },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  locBanner: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginBottom: Spacing.one },
  readonlyField: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  severityCard: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  severityTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  severityBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityBadgeText: { color: '#fff', fontSize: 16 },
  severityMath: { flex: 1 },
  textArea: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: 84,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  buildingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  radioRow: { flexDirection: 'row', gap: Spacing.five, marginTop: Spacing.one },
  radio: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#2F7CF6' },
  required: { color: BU.red },
  submit: {
    marginTop: Spacing.three,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
