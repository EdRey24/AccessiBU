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
    floorLabel,
    floorPlanImage,
    gpsToPlanXY,
    HAZARD_TYPES,
    type Location as HazardLocation,
    type HazardType,
} from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useHazards } from '@/hooks/use-hazards';
import { useTheme } from '@/hooks/use-theme';
import { failureMessage } from '@/services/api';
import { classifyHazard } from '@/services/classifier';
import { resolveFloor2Location } from '@/services/floor-geo';
import { severityScoreFromPin, storedHazardType } from '@/services/hazards';
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

export function ReportHazardModal({ visible, onClose }: ReportHazardModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { addHazard } = useHazards();

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
  // Confirmed type. Seeded from the model, then editable.
  const [hazardType, setHazardType] = useState<HazardType>('Spill');
  const [severity, setSeverity] = useState(5);
  const [description, setDescription] = useState('');
  // One classification per photo. Later edits do not start another call.
  const classifiedPhoto = useRef<string | null>(null);

  const location: HazardLocation = 'inside';
  const [coords, setCoords] = useState<Coords | null>(null);
  // Reporting is limited to the digitized Floor 2 plan.
  const floor = 2;
  // Start with a center pin so the user just drags it to the exact spot.
  const [position, setPosition] = useState<{ x: number; y: number } | null>({ x: 0.5, y: 0.5 });

  // "You are here" dot: project the user's GPS onto the floor plan (approximate
  // indoors, so the user still drags the pin to the exact spot).
  const userDot = coords ? gpsToPlanXY(coords) : null;

  const reset = () => {
    setPhotoUri(null);
    setAnalyzing(false);
    setSubmitting(false);
    setSubmitError(null);
    setResult(null);
    setHazardType('Spill');
    setSeverity(5);
    classifiedPhoto.current = null;
    setDescription('');
    setCoords(null);
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

  const classificationId = useRef(0);
  // One classification after the photo and description are both set.
  // Moving the pin or editing the description again does not start another.
  useEffect(() => {
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
  }, [photoUri, description, position, coords, floor]);

  // Photo captured -> detect building. A new photo can be classified once.
  const handleCapture = async (uri: string) => {
    setPhotoUri(uri);
    setResult(null);
    setAnalyzing(false);
    classifiedPhoto.current = null;
    setCameraOpen(false);
    await detectBuilding();
  };

  const note = description.trim();
  const canSubmit =
    !analyzing && !submitting && !!photoUri && note.length > 0 && !!position && !!result;

  const submit = async () => {
    if (!canSubmit || submitting || !photoUri || !position || !result) return;
    const spatialContext = buildSpatialContext(floor, position, coords);
    const resolved = resolveFloor2Location(position);
    const confirmedScore = severityScoreFromPin(severity);

    setSubmitting(true);
    setSubmitError(null);
    try {
      const stored = await submitPhotoReport({
        uri: photoUri,
        latitude: resolved.coordinate.latitude,
        longitude: resolved.coordinate.longitude,
        floor,
        position,
        description: note,
        hazardType: storedHazardType(hazardType),
        severityScore: confirmedScore,
      });
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
        method: 'photo',
        photoUri,
        spatialContext,
        severityReason: result.reason,
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
  if (!photoUri) missing.push('photo');
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
            {photoUri ? (
              <>
                <Image source={{ uri: photoUri }} style={styles.preview} contentFit="cover" />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setCameraOpen(true)}
                  style={styles.retake}>
                  <ThemedText type="small" style={{ color: BU.red }}>
                    Retake photo
                  </ThemedText>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setCameraOpen(true)}
                style={[styles.photoButton, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">Take a photo</ThemedText>
              </Pressable>
            )}

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
              placeholder="Describe the hazard in the photo…"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.textArea,
                { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
              ]}
            />

            <View style={styles.labelRow}>
              <ThemedText type="smallBold" style={styles.label}>
                Floor
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {floorLabel(floor)}
              </ThemedText>
            </View>

            <View style={styles.labelRow}>
              <ThemedText type="smallBold" style={styles.label}>
                Drag the pin to the exact spot
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
              onPlace={setPosition}
              showFeatures
              caption={floorLabel(floor)}
            />

            {analyzing && !result ? (
              <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
                <ActivityIndicator color={BU.red} />
                <ThemedText type="small">Classifying hazard and severity…</ThemedText>
              </View>
            ) : null}

            {result ? (
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
                : analyzing
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
  photoButton: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
  retake: { alignSelf: 'flex-start', marginTop: -Spacing.two },
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
