import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { BU, Spacing } from '@/constants/theme';

import { ThemedText } from './themed-text';

type CameraCaptureProps = {
  visible: boolean;
  onClose: () => void;
  onCapture: (uri: string) => void;
};

/**
 * Full-screen live camera. Enforces native capture (no camera-roll upload)
 * to preserve report integrity, per the AccessiBU spec.
 */
export function CameraCapture({ visible, onClose, onCapture }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  const takePhoto = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (photo?.uri) onCapture(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.center}>
            <ThemedText type="default" style={styles.whiteText}>
              Requesting camera…
            </ThemedText>
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <ThemedText type="default" style={styles.whiteText}>
              Camera access is required to report a hazard with a photo.
            </ThemedText>
            <Pressable style={styles.permissionButton} onPress={requestPermission}>
              <ThemedText type="smallBold" style={styles.whiteText}>
                Grant camera access
              </ThemedText>
            </Pressable>
            <Pressable style={styles.textButton} onPress={onClose}>
              <ThemedText type="small" style={styles.whiteText}>
                Cancel
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
            <View style={styles.topBar}>
              <Pressable onPress={onClose} accessibilityLabel="Close camera" style={styles.closeBtn}>
                <ThemedText type="default" style={styles.whiteText}>
                  ✕
                </ThemedText>
              </Pressable>
              <ThemedText type="smallBold" style={styles.whiteText}>
                Live capture only
              </ThemedText>
              <View style={styles.closeBtn} />
            </View>
            <View style={styles.controls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take photo"
                onPress={takePhoto}
                style={[styles.shutter, busy && styles.shutterBusy]}>
                <View style={styles.shutterInner} />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  whiteText: { color: '#fff', textAlign: 'center' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  controls: {
    position: 'absolute',
    bottom: Spacing.six,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: { opacity: 0.5 },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  permissionButton: {
    backgroundColor: BU.red,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  textButton: { padding: Spacing.two },
});
