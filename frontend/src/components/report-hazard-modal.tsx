import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
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
    floorLabel,
    floorPlanImage,
    gpsToPlanXY,
    HAZARD_TYPES,
    planXYToGps,
    type Location as HazardLocation,
    type HazardType,
} from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useHazards } from '@/hooks/use-hazards';
import { useTheme } from '@/hooks/use-theme';
import { failureMessage } from '@/services/api';
import { classifyHazard } from '@/services/classifier';
import { resolveFloor2Location, type ResolvedLocation } from '@/services/floor-geo';
import {
    hazardCategory,
    severityScoreFromPin,
    storedHazardType,
    submitTextReport,
} from '@/services/hazards';
import { submitPhotoReport } from '@/services/reports';

import { CameraCapture } from './camera-capture';
import { Dropdown } from './dropdown';
import { FloorPlan } from './floor-plan';
import { ThemedText } from './themed-text';

type ReportHazardModalProps = {
  visible: boolean;
  onClose: () => void;
};

type Coords = { latitude: number; longitude: number; accuracy: number | null };

/**
 * How the member reports.
 *   photo  — the camera photo is classified, and the AI suggests type + severity.
 *   manual — the member picks type + severity. A photo is optional and is stored
 *            as a plain attachment without classification. Facilities confirms
 *            the severity on site.
 */
type ReportMethod = 'photo' | 'manual';

const DEFAULT_SEVERITY = 5;

/** The AI photo flow is built on the digitized Floor 2 plan. */
const PHOTO_FLOOR = 2;

/** Floors a manual report can be filed on: Basement first, up to the top floor. */
const MANUAL_FLOOR_OPTIONS = [...CDS_FLOORS]
  .sort((a, b) => a.value - b.value)
  .map((f) => ({ value: f.value, label: f.label }));

/**
 * Real-world location for a pin. Floor 2 uses its digitized room map; other
 * floors have only the plan image, so the pin is interpolated over the
 * building corners and has no room.
 */
function resolvePin(
  floor: number,
  pin: { x: number; y: number }
): Pick<ResolvedLocation, 'room' | 'coordinate'> {
  if (floor === PHOTO_FLOOR) return resolveFloor2Location(pin);
  return { room: null, coordinate: planXYToGps(pin) };
}

export function ReportHazardModal({ visible, onClose }: ReportHazardModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { addHazard } = useHazards();

  const [method, setMethod] = useState<ReportMethod>('photo');
  const isPhoto = method === 'photo';
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The model result — null until the photo and description are classified.
  const [result, setResult] = useState<{
    type: HazardType;
    severity: number;
    baseSeverity: number;
    locationBonus: number;
    description: string;
    reason: string;
  } | null>(null);
  // Photo flow: seeded from the model, then editable. Manual flow: picked by the member.
  const [hazardType, setHazardType] = useState<HazardType>('Spill');
  const [severity, setSeverity] = useState(DEFAULT_SEVERITY);
  const [description, setDescription] = useState('');
  // One classification per photo. Later edits do not start another call.
  const classifiedPhoto = useRef<string | null>(null);
  const classificationId = useRef(0);

  const location: HazardLocation = 'inside';
  const [coords, setCoords] = useState<Coords | null>(null);
  // The photo flow stays on Floor 2. A manual report can pick any floor.
  const [manualFloor, setManualFloor] = useState(PHOTO_FLOOR);
  const floor = isPhoto ? PHOTO_FLOOR : manualFloor;
  // Start with a center pin so the user just drags it to the exact spot.
  const [position, setPosition] = useState<{ x: number; y: number } | null>({ x: 0.5, y: 0.5 });

  // "You are here" dot: project the user's GPS onto the floor plan (approximate
  // indoors, so the user still drags the pin to the exact spot).
  const userDot = coords ? gpsToPlanXY(coords) : null;

  const clearClassification = () => {
    classificationId.current += 1;
    classifiedPhoto.current = null;
    setResult(null);
    setAnalyzing(false);
  };

  const reset = () => {
    setMethod('photo');
    setPhotoUri(null);
    setSubmitting(false);
    setSubmitError(null);
    clearClassification();
    setHazardType('Spill');
    setSeverity(DEFAULT_SEVERITY);
    setDescription('');
    setCoords(null);
    setManualFloor(PHOTO_FLOOR);
    setPosition({ x: 0.5, y: 0.5 });
  };

  // A pin from one floor means nothing on another, so re-center it.
  const chooseFloor = (next: number) => {
    if (next === manualFloor) return;
    setManualFloor(next);
    setPosition({ x: 0.5, y: 0.5 });
  };

  const close = () => {
    reset();
    onClose();
  };

  // Keeps coords so the floor plan can show an approximate "you are here" dot.
  const detectBuilding = async (): Promise<Coords | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const pos = await Location.getCurrentPositionAsync({});
      const c: Coords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      };
      setCoords(c);
      return c;
    } catch {
      return null;
    }
  };

  // Photo flow only: one classification after the photo and description are
  // both set. Moving the pin or editing the description again does not re-run it.
  useEffect(() => {
    if (method !== 'photo') return;
    const written = description.trim();
    if (!photoUri || !written || !position || classifiedPhoto.current === photoUri) return;
    const pin = position;
    const here = coords;
    const timer = setTimeout(() => {
      if (classifiedPhoto.current === photoUri) return;
      classifiedPhoto.current = photoUri;
      const id = classificationId.current + 1;
      classificationId.current = id;
      setAnalyzing(true);
      setSubmitError(null);
      const ctx = buildSpatialContext(floor, pin, here);
      classifyHazard(photoUri, ctx, written)
        .then((value) => {
          if (classificationId.current !== id) return;
          const suggested = asHazardType(value.type);
          setResult({ ...value, type: suggested });
          setHazardType(suggested);
          setSeverity(value.severity);
        })
        .catch((error: unknown) => {
          if (classificationId.current !== id) return;
          classifiedPhoto.current = null;
          setResult(null);
          setSubmitError(failureMessage(error, 'The photo could not be classified.'));
        })
        .finally(() => {
          if (classificationId.current === id) setAnalyzing(false);
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [method, photoUri, description, position, coords, floor]);

  const chooseMethod = (next: ReportMethod) => {
    if (next === method) {
      if (next === 'photo' && !photoUri) setCameraOpen(true);
      return;
    }
    setMethod(next);
    setSubmitError(null);
    clearClassification();
    setPhotoUri(null);
    setHazardType('Spill');
    setSeverity(DEFAULT_SEVERITY);
    if (manualFloor !== PHOTO_FLOOR) setPosition({ x: 0.5, y: 0.5 });
    setManualFloor(PHOTO_FLOOR);
    if (next === 'photo') setCameraOpen(true);
    else void detectBuilding();
  };

  // Photo captured -> detect building. In the photo flow it is then classified once.
  const handleCapture = async (uri: string) => {
    setPhotoUri(uri);
    clearClassification();
    setCameraOpen(false);
    await detectBuilding();
  };

  const note = description.trim();
  const canSubmit = isPhoto
    ? !analyzing && !submitting && !!photoUri && note.length > 0 && !!position && !!result
    : !submitting && note.length > 0 && !!position;

  const submit = async () => {
    if (!canSubmit || submitting || !position) return;
    if (isPhoto && (!photoUri || !result)) return;
    const spatialContext = buildSpatialContext(floor, position, coords);
    const resolved = resolvePin(floor, position);
    const confirmedScore = severityScoreFromPin(severity);

    setSubmitting(true);
    setSubmitError(null);
    try {
      let stored: {
        hazardId: string;
        createdAt: number;
        hazardType: ReturnType<typeof storedHazardType>;
        summary: string;
        severityScore: number | null;
      };
      if (photoUri) {
        // Photo flow is classified. A photo attached to a manual report is not.
        stored = await submitPhotoReport({
          uri: photoUri,
          latitude: resolved.coordinate.latitude,
          longitude: resolved.coordinate.longitude,
          floor,
          position,
          description: note,
          hazardType: storedHazardType(hazardType),
          severityScore: confirmedScore,
          classify: isPhoto,
          category: isPhoto ? null : hazardCategory(hazardType),
        });
      } else {
        stored = await submitTextReport({
          type: hazardType,
          description: note,
          severity,
          latitude: resolved.coordinate.latitude,
          longitude: resolved.coordinate.longitude,
          floor,
          position,
        });
      }
      addHazard({
        id: stored.hazardId,
        createdAt: stored.createdAt,
        type: hazardType,
        hazardType: stored.hazardType,
        severity,
        severityScore: stored.severityScore ?? confirmedScore,
        description: stored.summary,
        location,
        floor,
        position,
        method,
        photoUri,
        spatialContext,
        severityReason: isPhoto ? result?.reason : 'Reported by the member. Facilities will confirm.',
        room: resolved.room,
        coordinate: resolved.coordinate,
      });
      close();
    } catch (error) {
      setSubmitError(failureMessage(error, 'The report could not be stored.'));
    } finally {
      setSubmitting(false);
    }
  };

  const missing: string[] = [];
  if (isPhoto && !photoUri) missing.push('photo');
  if (!note) missing.push('description');
  if (!position) missing.push('pin');

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
            {/* Report method: AI-classified photo, or manual (camera optional). */}
            <View style={styles.methodRow} accessibilityRole="radiogroup">
              <MethodButton
                label="📷 Take a photo"
                active={isPhoto}
                onPress={() => chooseMethod('photo')}
              />
              <MethodButton
                label="📋 Manual report"
                active={!isPhoto}
                onPress={() => chooseMethod('manual')}
              />
            </View>

            {photoUri ? (
              <>
                <Image source={{ uri: photoUri }} style={styles.preview} contentFit="cover" />
                <View style={styles.photoActions}>
                  <Pressable accessibilityRole="button" onPress={() => setCameraOpen(true)}>
                    <ThemedText type="small" style={{ color: BU.red }}>
                      Retake photo
                    </ThemedText>
                  </Pressable>
                  {!isPhoto ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setPhotoUri(null)}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Remove photo
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setCameraOpen(true)}
                style={[styles.photoButton, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">
                  {isPhoto ? 'Open camera' : 'Add a photo (optional)'}
                </ThemedText>
                {!isPhoto ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Attached as-is. It is not analyzed.
                  </ThemedText>
                ) : null}
              </Pressable>
            )}

            {!isPhoto ? (
              <>
                <ThemedText type="smallBold" style={styles.label}>
                  Hazard type *
                </ThemedText>
                <HazardTypeDropdown value={hazardType} onChange={setHazardType} />

                <ThemedText type="smallBold" style={styles.label}>
                  Severity *
                </ThemedText>
                <SeverityStepper value={severity} onChange={setSeverity} />
                <ThemedText type="small" themeColor="textSecondary">
                  Your estimate. Facilities will confirm the severity when they arrive.
                </ThemedText>
              </>
            ) : null}

            <View style={styles.labelRow}>
              <ThemedText type="smallBold" style={styles.label}>
                Description *
              </ThemedText>
              {!note && (
                <ThemedText type="small" style={styles.required}>
                  required
                </ThemedText>
              )}
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={1000}
              placeholder={
                isPhoto ? 'Describe the hazard in the photo…' : 'Describe the hazard and where it is…'
              }
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.textArea,
                { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
              ]}
            />

            {isPhoto ? (
              <View style={styles.labelRow}>
                <ThemedText type="smallBold" style={styles.label}>
                  Floor
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {floorLabel(floor)}
                </ThemedText>
              </View>
            ) : (
              <>
                <ThemedText type="smallBold" style={styles.label}>
                  Floor *
                </ThemedText>
                <Dropdown value={manualFloor} onChange={chooseFloor} options={MANUAL_FLOOR_OPTIONS} />
              </>
            )}

            <View style={styles.labelRow}>
              <ThemedText type="smallBold" style={styles.label}>
                Drag the pin to the exact spot
              </ThemedText>
            </View>
            <FloorPlan
              planImage={floorPlanImage(floor)}
              floor={floor}
              draftPin={position}
              userDot={userDot}
              onPlace={setPosition}
              showFeatures
              caption={floorLabel(floor)}
            />

            {isPhoto && analyzing && !result ? (
              <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
                <ActivityIndicator color={BU.red} />
                <ThemedText type="small">Classifying hazard and severity…</ThemedText>
              </View>
            ) : null}

            {isPhoto && result ? (
              <>
                <ThemedText type="smallBold" style={styles.label}>
                  Hazard type
                </ThemedText>
                <HazardTypeDropdown value={hazardType} onChange={setHazardType} />

                <ThemedText type="smallBold" style={styles.label}>
                  Severity
                </ThemedText>
                <View style={styles.severityTop}>
                  <View style={[styles.severityBadge, { backgroundColor: severityColor(severity) }]}>
                    <ThemedText type="smallBold" style={styles.severityBadgeText}>
                      {severity}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.severityMath}>
                    {`${severity}/10`}
                    {result.reason ? `. ${result.reason}` : ''}
                  </ThemedText>
                </View>
              </>
            ) : null}
          </ScrollView>

          {submitError ? (
            <ThemedText type="small" style={styles.submitError} accessibilityRole="alert">
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
                : isPhoto && analyzing
                  ? 'Classifying…'
                  : missing.length
                    ? `Add ${missing.join(' & ')} to submit`
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

function asHazardType(value: string): HazardType {
  return (HAZARD_TYPES as readonly string[]).includes(value) ? (value as HazardType) : 'Other';
}

function MethodButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.methodButton,
        {
          borderColor: active ? BU.red : theme.border,
          backgroundColor: active ? BU.red : theme.background,
        },
      ]}>
      <ThemedText type="smallBold" style={{ color: active ? '#fff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** 1–10 severity picker for manual reports. */
function SeverityStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.stepper, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease severity"
        disabled={value <= 1}
        onPress={() => onChange(Math.max(1, value - 1))}
        style={styles.stepperBtn}>
        <ThemedText type="subtitle" themeColor={value <= 1 ? 'backgroundSelected' : 'textSecondary'}>
          −
        </ThemedText>
      </Pressable>
      <View
        style={styles.stepperValue}
        accessibilityRole="adjustable"
        accessibilityLabel={`Severity ${value} out of 10`}>
        <View style={[styles.severityDot, { backgroundColor: severityColor(value) }]} />
        <ThemedText type="default">{value}/10</ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase severity"
        disabled={value >= 10}
        onPress={() => onChange(Math.min(10, value + 1))}
        style={styles.stepperBtn}>
        <ThemedText type="subtitle" themeColor={value >= 10 ? 'backgroundSelected' : 'textSecondary'}>
          +
        </ThemedText>
      </Pressable>
    </View>
  );
}

function HazardTypeDropdown({
  value,
  onChange,
}: {
  value: HazardType;
  onChange: (v: HazardType) => void;
}) {
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      options={HAZARD_TYPES.map((type) => ({ value: type, label: type }))}
    />
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
  photoButton: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
  },
  photoActions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: -Spacing.two,
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
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginBottom: Spacing.one },
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
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  stepperBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  severityDot: { width: 12, height: 12, borderRadius: 6 },
  textArea: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: 84,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  required: { color: BU.red },
  submit: {
    marginTop: Spacing.three,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
