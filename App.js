import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet, Animated, Easing, StatusBar, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Rect, Stop } from 'react-native-svg';
import * as DocumentPicker from 'expo-document-picker';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

// ---------- Dữ liệu ----------
const hashStr = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const mk = (id, title, artist, uri, hue) => ({ id, title, artist, uri, hue, seed: hashStr(title) });

const DEMO = [
  mk('d1', 'Sáng sớm', 'SoundHelix', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', 200),
  mk('d2', 'Đêm thành phố', 'SoundHelix', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', 275),
  mk('d3', 'Gió biển', 'SoundHelix', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', 160),
];
const IDLE = { id: 'idle', seed: 11, hue: 255 };

const fmt = (t) => {
  if (!isFinite(t) || t < 0) return '0:00';
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- Liquid Glass ----------
// iOS 26+: kính thật (GlassView). iOS cũ: blur. Android: kính giả bằng lớp mờ + viền sáng.
const HAS_LIQUID = (() => {
  try { return Platform.OS === 'ios' && isLiquidGlassAvailable(); } catch (e) { return false; }
})();

function Glass({ style, radius = 24, intensity = 45, tint, children }) {
  const base = { borderRadius: radius, overflow: 'hidden' };
  if (HAS_LIQUID) {
    return <GlassView glassEffectStyle="regular" tintColor={tint} style={[base, style]}>{children}</GlassView>;
  }
  return (
    <View style={[base, styles.glassFallback, style]}>
      {Platform.OS === 'ios' && <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />}
      {tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} /> : null}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.30)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0.12)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)' }]}
      />
      {children}
    </View>
  );
}

// ---------- Artwork ----------
const rng = (seed) => {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

function ArtSvg({ track, size }) {
  const shapes = useMemo(() => {
    const r = rng(track.seed);
    return Array.from({ length: 6 }, () => ({
      cx: r() * 100, cy: r() * 100, rad: 15 + r() * 40,
      h: Math.round((track.hue + r() * 80) % 360), op: 0.25 + r() * 0.4,
    }));
  }, [track.seed, track.hue]);
  const h = Math.round(track.hue);
  const gid = `g${track.id}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <SvgGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={`hsl(${h},75%,58%)`} />
          <Stop offset="1" stopColor={`hsl(${(h + 60) % 360},70%,32%)`} />
        </SvgGradient>
      </Defs>
      <Rect width="100" height="100" fill={`url(#${gid})`} />
      {shapes.map((s, i) => (
        <Circle key={i} cx={s.cx} cy={s.cy} r={s.rad} fill={`hsl(${s.h},80%,65%)`} opacity={s.op} />
      ))}
      <Circle cx="50" cy="50" r="18" fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth="1.2" />
      <Circle cx="50" cy="50" r="9" fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth="1" />
    </Svg>
  );
}

function Vinyl({ size, hue }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="49" fill="#141218" />
      {[44, 38, 32, 26].map((r) => (
        <Circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#2b2832" strokeWidth="1" />
      ))}
      <Path d="M50 5 A45 45 0 0 1 89 28" stroke="#fff" strokeOpacity={0.18} strokeWidth="3" fill="none" />
      <Circle cx="50" cy="50" r="16" fill={`hsl(${Math.round(hue)},70%,50%)`} />
      <Circle cx="50" cy="50" r="2.5" fill="#141218" />
    </Svg>
  );
}

function NowPlayingArt({ track, playing, size }) {
  const scale = useRef(new Animated.Value(playing ? 1 : 0.9)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const resume = useRef(0);

  useEffect(() => {
    Animated.spring(scale, { toValue: playing ? 1 : 0.9, friction: 6, useNativeDriver: true }).start();
  }, [playing]);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (!alive) return;
      spin.setValue(resume.current);
      Animated.timing(spin, {
        toValue: 1, duration: 9000 * (1 - resume.current),
        easing: Easing.linear, useNativeDriver: true,
      }).start(({ finished }) => { if (finished) { resume.current = 0; run(); } });
    };
    if (playing) run();
    return () => { alive = false; spin.stopAnimation((v) => { resume.current = v % 1; }); };
  }, [playing]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ width: size * 1.22, height: size, alignSelf: 'center', transform: [{ scale }] }}>
      <Animated.View style={{ position: 'absolute', left: size * 0.22, transform: [{ rotate }] }}>
        <Vinyl size={size} hue={track.hue} />
      </Animated.View>
      <View style={[styles.cover, { width: size, height: size }]}>
        <ArtSvg track={track} size={size} />
      </View>
    </Animated.View>
  );
}

// ---------- App ----------
function Player() {
  const { width, height } = useWindowDimensions();
  const [tracks, setTracks] = useState(DEMO);
  const [idx, setIdx] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [seeking, setSeeking] = useState(null);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const live = useRef({});
  live.current = { tracks, idx, shuffle, repeat };

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
  }, []);

  const load = useCallback((i) => {
    const t = live.current.tracks[i];
    if (!t) return;
    setIdx(i);
    player.replace(t.uri);
    player.play();
    try { player.setActiveForLockScreen(true, { title: t.title, artist: t.artist }); } catch (e) {}
  }, [player]);

  const next = useCallback((auto) => {
    const { tracks: ts, idx: cur, shuffle: sh, repeat: rp } = live.current;
    if (!ts.length) return;
    let n;
    if (sh && ts.length > 1) {
      do { n = Math.floor(Math.random() * ts.length); } while (n === cur);
    } else {
      n = cur + 1;
      if (n >= ts.length) { if (auto && !rp) return; n = 0; }
    }
    load(n);
  }, [load]);

  const prev = () => {
    if (status.currentTime > 3) { player.seekTo(0); return; }
    const n = live.current.tracks.length;
    load((live.current.idx - 1 + n) % n);
  };

  useEffect(() => { if (status.didJustFinish) next(true); }, [status.didJustFinish]);

  const toggle = () => {
    if (idx < 0) load(0);
    else if (status.playing) player.pause();
    else player.play();
  };

  const addFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const first = tracks.length;
    const added = res.assets.map((a, i) => {
      const title = a.name.replace(/\.[^.]+$/, '');
      return mk(`f${Date.now()}${i}`, title, 'Từ máy của bạn', a.uri, hashStr(title) % 360);
    });
    live.current.tracks = [...tracks, ...added];
    setTracks(live.current.tracks);
    load(first);
  };

  const track = tracks[idx];
  const bg = track || IDLE;
  const hue = bg.hue;
  const artSize = Math.min(width - 96, 280) * 0.78;
  const duration = status.duration || 0;
  const position = seeking ?? status.currentTime ?? 0;

  const header = (
    <View style={styles.header}>
      {track ? (
        <NowPlayingArt track={track} playing={status.playing} size={artSize} />
      ) : (
        <Glass radius={24} style={{ alignSelf: 'center', width: artSize, height: artSize }}>
          <View style={styles.center}><Ionicons name="musical-notes" size={56} color="#ffffffaa" /></View>
        </Glass>
      )}

      <Glass radius={32} style={styles.panel}>
        <View style={styles.panelInner}>
          <Text style={styles.title} numberOfLines={1}>{track ? track.title : 'Chọn một bài để phát'}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track ? track.artist : 'Chạm vào bài trong danh sách bên dưới'}</Text>

          <View style={styles.seekRow}>
            <Text style={styles.time}>{fmt(position)}</Text>
            <Slider
              style={{ flex: 1, height: 36 }}
              minimumValue={0}
              maximumValue={duration || 1}
              value={position}
              minimumTrackTintColor="#fff"
              maximumTrackTintColor="#ffffff44"
              thumbTintColor="#fff"
              onValueChange={setSeeking}
              onSlidingComplete={(v) => { player.seekTo(v); setSeeking(null); }}
            />
            <Text style={styles.time}>{fmt(duration)}</Text>
          </View>

          <View style={styles.controls}>
            <Pressable hitSlop={10} onPress={() => setShuffle((s) => !s)}>
              <Ionicons name="shuffle" size={24} color={shuffle ? '#fff' : '#ffffff77'} />
            </Pressable>
            <Pressable hitSlop={10} onPress={prev}><Ionicons name="play-skip-back" size={30} color="#fff" /></Pressable>
            <Glass radius={34} tint={`hsla(${Math.round(hue)},85%,60%,0.55)`} style={styles.playGlass}>
              <Pressable onPress={toggle} style={styles.center}>
                <Ionicons name={status.playing ? 'pause' : 'play'} size={32} color="#fff" style={{ marginLeft: status.playing ? 0 : 3 }} />
              </Pressable>
            </Glass>
            <Pressable hitSlop={10} onPress={() => next(false)}><Ionicons name="play-skip-forward" size={30} color="#fff" /></Pressable>
            <Pressable hitSlop={10} onPress={() => setRepeat((r) => !r)}>
              <Ionicons name="repeat" size={24} color={repeat ? '#fff' : '#ffffff77'} />
            </Pressable>
          </View>
        </View>
      </Glass>

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>Danh sách phát</Text>
        <Glass radius={999}>
          <Pressable style={styles.addBtn} onPress={addFiles}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addTxt}>Thêm nhạc</Text>
          </Pressable>
        </Glass>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#0c0a12' }}>
      <StatusBar barStyle="light-content" />
      {/* Nền: chính artwork phóng to, để lớp kính có thứ để "khúc xạ" */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ position: 'absolute', top: -height * 0.05, left: -width * 0.3 }}>
          <ArtSvg key={bg.id} track={bg} size={Math.max(width, height) * 1.3} />
        </View>
        <LinearGradient colors={['rgba(12,10,18,0.15)', 'rgba(12,10,18,0.55)', 'rgba(12,10,18,0.9)']} style={StyleSheet.absoluteFill} />
      </View>

      <SafeAreaView style={{ flex: 1 }}>
        <FlatList
          data={tracks}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item, index }) => {
            const active = index === idx;
            return (
              <Glass radius={20} tint={active ? 'rgba(255,255,255,0.20)' : undefined} style={styles.rowGlass}>
                <Pressable onPress={() => load(index)} style={styles.row}>
                  <View style={styles.thumb}><ArtSvg track={item} size={46} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.rowArtist} numberOfLines={1}>{item.artist}</Text>
                  </View>
                  {active && <Ionicons name={status.playing ? 'volume-high' : 'volume-mute'} size={18} color="#fff" />}
                </Pressable>
              </Glass>
            );
          }}
        />
      </SafeAreaView>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Player />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glassFallback: { backgroundColor: 'rgba(255,255,255,0.08)' },
  cover: {
    borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
  },
  panel: { marginTop: 24 },
  panelInner: { padding: 20 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  artist: { color: '#ffffffb0', fontSize: 14, marginTop: 4, textAlign: 'center' },
  seekRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  time: { color: '#ffffffb0', fontSize: 12, width: 38, textAlign: 'center', fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 6 },
  playGlass: { width: 68, height: 68 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 10, paddingHorizontal: 4 },
  listTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8 },
  addTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rowGlass: { marginHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  thumb: { width: 46, height: 46, borderRadius: 12, overflow: 'hidden' },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowArtist: { color: '#ffffff99', fontSize: 12, marginTop: 2 },
});
