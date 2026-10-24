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
    analyzeHazardPhoto,
    CDS_FLOORS,
    floorLabel,
    floorPlanImage,
    HAZARD_TYPES,
    isAtCDS,
    type Location as HazardLocation,
    type HazardType,
    type ReportMethod,
} from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useHazards } from '@/hooks/use-hazards';
import { useTheme } from '@/hooks/use-theme';

import { CameraCapture } from './camera-capture';
import { Dropdown } from './dropdown';
import { FloorPlan } from './floor-plan';
import { ThemedText } from './themed-text';

type ReportHazardModalProps = {
  visible: boolean;
  onClose: () => void;
};

type LocationStatus = 'idle' | 'detecting' | 'at-cds' | 'elsewhere' | 'denied';

export function ReportHazardModal({ visible, onClose }: ReportHazardModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { addHazard } = useHazards();

  const [method, setMethod] = useState<ReportMethod>('photo');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [type, setType] = useState<HazardType>('Spill');
  const [severity, setSeverity] = useState(5);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<HazardLocation>('inside');
  const [locStatus, setLocStatus] = useState<LocationStatus>('idle');
  const [floor, setFloor] = useState(12);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const reset = () => {
    setMethod('photo');
    setPhotoUri(null);
    setAnalyzing(false);
    setAnalyzed(false);
    setType('Spill');
    setSeverity(5);
    setDescription('');
    setLocation('inside');
    setLocStatus('idle');
    setFloor(12);
    setPosition(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  // Auto-detect the building from GPS and set inside/outside CDS.
  const detectBuilding = async () => {
    setLocStatus('detecting');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocStatus('denied');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const atCDS = isAtCDS(pos.coords);
      setLocation(atCDS ? 'inside' : 'outside');
      setLocStatus(atCDS ? 'at-cds' : 'elsewhere');
    } catch {
      setLocStatus('denied');
    }
  };

  // After a photo is captured: analyze it, then auto-detect the building.
  const handleCapture = async (uri: string) => {
    setPhotoUri(uri);
    setCameraOpen(false);
    setAnalyzing(true);
    setAnalyzed(false);
    const [result] = await Promise.all([analyzeHazardPhoto(uri), detectBuilding()]);
    setType(result.type);
    setSeverity(result.severity);
    setDescription(result.description);
    setAnalyzing(false);
    setAnalyzed(true);
  };

  const canSubmit = !analyzing && (location === 'outside' || position !== null);

  const submit = () => {
    if (!canSubmit) return;
    addHazard({
      type,
      severity,
      description: description.trim(),
      location,
      floor: location === 'inside' ? floor : null,
      position: location === 'inside' ? position : null,
      method,
      photoUri,
    });
    close();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.four },
          ]}>
          {/* Header */}
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
                  setAnalyzed(false);
                  detectBuilding();
                }}
              />
            </View>

            {photoUri && (
              <Image source={{ uri: photoUri }} style={styles.preview} contentFit="cover" />
            )}

            {/* AI analysis status */}
            {analyzing && (
              <View style={[styles.analyzeBanner, { backgroundColor: theme.backgroundElement }]}>
                <ActivityIndicator color={BU.red} />
                <ThemedText type="small">Analyzing photo…</ThemedText>
              </View>
            )}
            {analyzed && !analyzing && (
              <View style={[styles.analyzeBanner, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold" style={{ color: BU.red }}>
                  ✓ AI classified
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Review and adjust if needed
                </ThemedText>
              </View>
            )}

            {/* Hazard + Severity */}
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <ThemedText type="smallBold" style={styles.label}>
                  Hazard
                </ThemedText>
                <Dropdown
                  value={type}
                  onChange={(v) => setType(v)}
                  options={HAZARD_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </View>
              <View style={styles.col}>
                <View style={styles.severityHeader}>
                  <ThemedText type="smallBold" style={styles.label}>
                    Severity
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {severity}/10
                  </ThemedText>
                </View>
                <SeverityStepper value={severity} onChange={setSeverity} />
              </View>
            </View>

            {/* Description */}
            <ThemedText type="smallBold" style={styles.label}>
              Description
            </ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="Add any helpful details…"
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
                <ThemedText type="smallBold" style={styles.label}>
                  Floor
                </ThemedText>
                <Dropdown value={floor} onChange={(v) => setFloor(v)} options={CDS_FLOORS} />

                <View style={styles.positionHeader}>
                  <ThemedText type="smallBold" style={styles.label}>
                    Pinpoint the hazard
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor={position ? 'textSecondary' : undefined}
                    style={!position && styles.required}>
                    {position ? '✓ placed' : 'tap the plan'}
                  </ThemedText>
                </View>
                <FloorPlan
                  planImage={floorPlanImage(floor)}
                  draftPin={position}
                  onPlace={setPosition}
                  caption={floorLabel(floor)}
                />
              </>
            )}
          </ScrollView>

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
              {analyzing ? 'Analyzing…' : 'Submit report'}
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

function SeverityStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.stepper, { borderColor: theme.border }]}>
      <Pressable
        accessibilityLabel="Decrease severity"
        onPress={() => onChange(Math.max(1, value - 1))}
        style={styles.stepperBtn}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          −
        </ThemedText>
      </Pressable>
      <View style={styles.stepperValue}>
        <View style={[styles.severityDot, { backgroundColor: severityColor(value) }]} />
        <ThemedText type="default">{value}</ThemedText>
      </View>
      <Pressable
        accessibilityLabel="Increase severity"
        onPress={() => onChange(Math.min(10, value + 1))}
        style={styles.stepperBtn}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          +
        </ThemedText>
      </Pressable>
    </View>
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
  analyzeBanner: {
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
  twoCol: { flexDirection: 'row', gap: Spacing.three },
  col: { flex: 1, gap: Spacing.two },
  label: { marginBottom: Spacing.one },
  severityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textArea: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: 84,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  buildingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
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
  positionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  required: { color: BU.red },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  stepperBtn: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  severityDot: { width: 12, height: 12, borderRadius: 6 },
  submit: {
    marginTop: Spacing.three,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
