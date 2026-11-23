import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet, Animated, Easing, StatusBar, Platform, BackHandler, Alert, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Rect, Stop } from 'react-native-svg';
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

// ---------- Dữ liệu ----------
const hashStr = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const LIB_KEY = 'library.v1';
const MUSIC_DIR = 'music/';
const mk = (id, title, artist, album, file) => {
  const s = hashStr(album);
  return {
    id, title, artist, album, file,
    uri: FS.documentDirectory + MUSIC_DIR + file,
    art: { id: `al${s}`, seed: s, hue: s % 360 },
  };
};
const IDLE = { id: 'idle', seed: 11, hue: 255 };
const TABS = [['songs', 'Bài hát'], ['singers', 'Ca sĩ'], ['albums', 'Album']];

const fmt = (t) => {
  if (!isFinite(t) || t < 0) return '0:00';
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// "Ca sĩ - Tên bài.mp3" -> tách ca sĩ và tên bài
const parseName = (file) => {
  const base = file.replace(/\.[^.]+$/, '');
  const parts = base.split(' - ');
  return parts.length > 1
    ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
    : { artist: 'Không rõ', title: base };
};

// ---------- Liquid Glass ----------
function Glass({ style, radius = 24, tint, children }) {
  const base = { borderRadius: radius, overflow: 'hidden' };
  return (
    <View style={[base, styles.glassFallback, style]}>
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

function ArtSvg({ art, size }) {
  const shapes = useMemo(() => {
    const r = rng(art.seed);
    return Array.from({ length: 6 }, () => ({
      cx: r() * 100, cy: r() * 100, rad: 15 + r() * 40,
      h: Math.round((art.hue + r() * 80) % 360), op: 0.25 + r() * 0.4,
    }));
  }, [art.seed, art.hue]);
  const h = Math.round(art.hue);
  const gid = `g${art.id}`;
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

const Cover = ({ art, size, radius = 12 }) => (
  <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}>
    <ArtSvg art={art} size={size} />
  </View>
);

function Avatar({ name, size }) {
  const h = hashStr(name) % 360;
  return (
    <LinearGradient
      colors={[`hsl(${h},70%,58%)`, `hsl(${(h + 60) % 360},65%,34%)`]}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '700' }}>{name[0]?.toUpperCase()}</Text>
    </LinearGradient>
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

function NowPlayingArt({ art, playing, size }) {
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
        <Vinyl size={size} hue={art.hue} />
      </Animated.View>
      <View style={[styles.cover, { width: size, height: size }]}>
        <ArtSvg art={art} size={size} />
      </View>
    </Animated.View>
  );
}

// ---------- Các dòng danh sách ----------
function SongRow({ track, active, playing, onPress, onLongPress }) {
  return (
    <Glass radius={20} tint={active ? 'rgba(255,255,255,0.20)' : undefined} style={styles.rowGlass}>
      <Pressable onPress={onPress} onLongPress={onLongPress} style={styles.row}>
        <Cover art={track.art} size={46} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{track.artist} · {track.album}</Text>
        </View>
        {active && <Ionicons name={playing ? 'volume-high' : 'volume-mute'} size={18} color="#fff" />}
      </Pressable>
    </Glass>
  );
}

// ---------- App ----------
function Player() {
  const { width, height } = useWindowDimensions();
  const [tracks, setTracks] = useState([]);
  const [ready, setReady] = useState(false);
  const [queue, setQueue] = useState([]);
  const [cur, setCur] = useState(null);
  const [screen, setScreen] = useState('home');
  const [tab, setTab] = useState('songs');
  const [detail, setDetail] = useState(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [seeking, setSeeking] = useState(null);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const live = useRef({});
  live.current = { tracks, queue, cur, shuffle, repeat };

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
  }, []);

  // Đọc thư viện đã lưu khi mở app
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LIB_KEY);
        const saved = raw ? JSON.parse(raw) : [];
        const ok = [];
        for (const s of saved) {
          const info = await FS.getInfoAsync(FS.documentDirectory + MUSIC_DIR + s.file);
          if (info.exists) ok.push(mk(s.id, s.title, s.artist, s.album, s.file));
        }
        setTracks(ok);
      } catch (e) {}
      setReady(true);
    })();
  }, []);

  // Lưu lại mỗi khi thư viện thay đổi
  useEffect(() => {
    if (!ready) return;
    const data = tracks.map(({ id, title, artist, album, file }) => ({ id, title, artist, album, file }));
    AsyncStorage.setItem(LIB_KEY, JSON.stringify(data)).catch(() => {});
  }, [tracks, ready]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'now') { setScreen('home'); return true; }
      if (detail) { setDetail(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [screen, detail]);

  const singers = useMemo(() => {
    const m = new Map();
    tracks.forEach((t) => { if (!m.has(t.artist)) m.set(t.artist, []); m.get(t.artist).push(t); });
    return [...m].map(([name, list]) => ({ name, list }));
  }, [tracks]);
  const albums = useMemo(() => {
    const m = new Map();
    tracks.forEach((t) => { if (!m.has(t.album)) m.set(t.album, []); m.get(t.album).push(t); });
    return [...m].map(([name, list]) => ({ name, list, artist: list[0].artist, art: list[0].art }));
  }, [tracks]);

  const playTrack = useCallback((t, list) => {
    live.current.queue = list; live.current.cur = t;
    setQueue(list); setCur(t);
    player.replace(t.uri);
    player.play();
    try { player.setActiveForLockScreen(true, { title: t.title, artist: t.artist }); } catch (e) {}
  }, [player]);

  const next = useCallback((auto) => {
    const { queue: q, cur: c, shuffle: sh, repeat: rp } = live.current;
    if (!q.length) return;
    const i = q.findIndex((x) => x.id === c?.id);
    let n;
    if (sh && q.length > 1) {
      do { n = Math.floor(Math.random() * q.length); } while (n === i);
    } else {
      n = i + 1;
      if (n >= q.length) { if (auto && !rp) return; n = 0; }
    }
    playTrack(q[n], q);
  }, [playTrack]);

  const prev = () => {
    if (status.currentTime > 3) { player.seekTo(0); return; }
    const { queue: q, cur: c } = live.current;
    if (!q.length) return;
    const i = q.findIndex((x) => x.id === c?.id);
    playTrack(q[(i - 1 + q.length) % q.length], q);
  };

  useEffect(() => { if (status.didJustFinish) next(true); }, [status.didJustFinish]);

  const toggle = () => { if (status.playing) player.pause(); else player.play(); };

  const addFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    try { await FS.makeDirectoryAsync(FS.documentDirectory + MUSIC_DIR, { intermediates: true }); } catch (e) {}
    const added = [];
    for (const [i, a] of res.assets.entries()) {
      const { artist, title } = parseName(a.name);
      const id = `f${Date.now()}${i}`;
      const file = `${id}_${a.name.replace(/[^\w.\-]+/g, '_')}`;
      try {
        await FS.moveAsync({ from: a.uri, to: FS.documentDirectory + MUSIC_DIR + file });
        added.push(mk(id, title, artist, 'Không rõ', file));
      } catch (e) {}
    }
    if (!added.length) return;
    const all = [...tracks, ...added];
    setTracks(all);
    playTrack(added[0], all);
  };

  const removeTrack = (t) => {
    Alert.alert('Xóa bài hát', `Xóa "${t.title}" khỏi máy?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          if (live.current.cur?.id === t.id) {
            player.pause();
            live.current.cur = null;
            setCur(null);
            setScreen('home');
          }
          try { await FS.deleteAsync(t.uri, { idempotent: true }); } catch (e) {}
          setTracks((ts) => ts.filter((x) => x.id !== t.id));
          setQueue((q) => q.filter((x) => x.id !== t.id));
        },
      },
    ]);
  };

  const art = cur ? cur.art : IDLE;
  const hue = art.hue;
  const playingNow = status.playing;
  const duration = status.duration || 0;
  const position = seeking ?? status.currentTime ?? 0;
  const artSize = Math.min(width - 96, 280) * 0.78;
  const cardW = (width - 32 - 12) / 2;

  // ----- Màn hình chi tiết (ca sĩ / album) -----
  const detailData = detail
    ? detail.type === 'singer'
      ? singers.find((s) => s.name === detail.key)
      : albums.find((a) => a.name === detail.key)
    : null;

  useEffect(() => { if (detail && !detailData) setDetail(null); }, [detail, detailData]);

  const renderDetail = () => {
    if (!detailData) return null;
    const isSinger = detail.type === 'singer';
    return (
      <FlatList
        data={detailData.list}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          <View style={styles.detailHead}>
            <Glass radius={22} style={styles.backBtn}>
              <Pressable onPress={() => setDetail(null)} style={styles.center}>
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </Pressable>
            </Glass>
            {isSinger ? <Avatar name={detailData.name} size={130} /> : <Cover art={detailData.art} size={150} radius={22} />}
            <Text style={styles.bigTitle} numberOfLines={2}>{detailData.name}</Text>
            <Text style={styles.rowSub}>
              {isSinger ? '' : `${detailData.artist} · `}{detailData.list.length} bài hát
            </Text>
            <Glass radius={999} tint={`hsla(${Math.round(detailData.list[0].art.hue)},85%,60%,0.5)`} style={{ marginTop: 16 }}>
              <Pressable style={styles.playAll} onPress={() => playTrack(detailData.list[0], detailData.list)}>
                <Ionicons name="play" size={16} color="#fff" />
                <Text style={styles.addTxt}>Phát tất cả</Text>
              </Pressable>
            </Glass>
          </View>
        }
        renderItem={({ item }) => (
          <SongRow
            track={item}
            active={cur?.id === item.id}
            playing={playingNow}
            onPress={() => playTrack(item, detailData.list)}
            onLongPress={() => removeTrack(item)}
          />
        )}
      />
    );
  };

  // ----- Các tab -----
  const empty = (
    <View style={styles.emptyBox}>
      <Ionicons name="musical-notes" size={48} color="#ffffff88" />
      <Text style={styles.emptyTitle}>Chưa có bài hát nào</Text>
      <Text style={styles.emptySub}>Bấm nút + ở góc trên để thêm nhạc từ máy của bạn</Text>
    </View>
  );
  const renderTab = () => {
    if (tab === 'songs') {
      return (
        <FlatList
          key="songs"
          ListEmptyComponent={empty}
          data={tracks}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item }) => (
            <SongRow
              track={item}
              active={cur?.id === item.id}
              playing={playingNow}
              onPress={() => playTrack(item, tracks)}
              onLongPress={() => removeTrack(item)}
            />
          )}
        />
      );
    }
    if (tab === 'singers') {
      return (
        <FlatList
          key="singers"
          ListEmptyComponent={empty}
          data={singers}
          keyExtractor={(s) => s.name}
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item }) => (
            <Glass radius={20} style={styles.rowGlass}>
              <Pressable style={styles.row} onPress={() => setDetail({ type: 'singer', key: item.name })}>
                <Avatar name={item.name} size={46} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.rowSub}>{item.list.length} bài hát</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#ffffff88" />
              </Pressable>
            </Glass>
          )}
        />
      );
    }
    return (
      <FlatList
        key="albums"
        ListEmptyComponent={empty}
        data={albums}
        numColumns={2}
        keyExtractor={(a) => a.name}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ paddingBottom: 120, gap: 12 }}
        renderItem={({ item }) => (
          <Glass radius={22} style={{ width: cardW }}>
            <Pressable style={{ padding: 10 }} onPress={() => setDetail({ type: 'album', key: item.name })}>
              <Cover art={item.art} size={cardW - 20} radius={14} />
              <Text style={[styles.rowTitle, { marginTop: 10 }]} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{item.artist}</Text>
            </Pressable>
          </Glass>
        )}
      />
    );
  };

  const home = (
    <View style={{ flex: 1 }}>
      {detail ? (
        renderDetail()
      ) : (
        <>
          <View style={styles.topRow}>
            <Text style={styles.bigTitle2}>Thư viện</Text>
            <Glass radius={22} style={styles.backBtn}>
              <Pressable onPress={addFiles} style={styles.center}>
                <Ionicons name="add" size={24} color="#fff" />
              </Pressable>
            </Glass>
          </View>
          <Glass radius={999} style={styles.tabBar}>
            <View style={{ flexDirection: 'row', padding: 4 }}>
              {TABS.map(([k, label]) => (
                <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]}>
                  <Text style={[styles.tabTxt, tab === k && { color: '#fff' }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </Glass>
          <View style={{ flex: 1, marginTop: 14 }}>{renderTab()}</View>
        </>
      )}

      {cur && (
        <Glass radius={28} style={styles.mini}>
          <Pressable style={styles.miniRow} onPress={() => setScreen('now')}>
            <Cover art={cur.art} size={44} radius={12} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{cur.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{cur.artist}</Text>
            </View>
            <Pressable hitSlop={10} onPress={toggle} style={{ padding: 6 }}>
              <Ionicons name={playingNow ? 'pause' : 'play'} size={26} color="#fff" />
            </Pressable>
            <Pressable hitSlop={10} onPress={() => next(false)} style={{ padding: 6 }}>
              <Ionicons name="play-skip-forward" size={24} color="#fff" />
            </Pressable>
          </Pressable>
        </Glass>
      )}
    </View>
  );

  // ----- Màn hình đang phát -----
  const now = cur && (
    <View style={{ flex: 1, paddingHorizontal: 16 }}>
      <View style={styles.nowTop}>
        <Glass radius={22} style={styles.backBtn}>
          <Pressable onPress={() => setScreen('home')} style={styles.center}>
            <Ionicons name="chevron-down" size={24} color="#fff" />
          </Pressable>
        </Glass>
        <Text style={styles.nowLabel}>Đang phát</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={{ marginTop: 20 }}>
        <NowPlayingArt art={cur.art} playing={playingNow} size={artSize} />
      </View>

      <Glass radius={32} style={{ marginTop: 28 }}>
        <View style={{ padding: 20 }}>
          <Text style={styles.title} numberOfLines={1}>{cur.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{cur.artist} · {cur.album}</Text>

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
                <Ionicons name={playingNow ? 'pause' : 'play'} size={32} color="#fff" style={{ marginLeft: playingNow ? 0 : 3 }} />
              </Pressable>
            </Glass>
            <Pressable hitSlop={10} onPress={() => next(false)}><Ionicons name="play-skip-forward" size={30} color="#fff" /></Pressable>
            <Pressable hitSlop={10} onPress={() => setRepeat((r) => !r)}>
              <Ionicons name="repeat" size={24} color={repeat ? '#fff' : '#ffffff77'} />
            </Pressable>
          </View>
        </View>
      </Glass>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#0c0a12' }}>
      <StatusBar barStyle="light-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ position: 'absolute', top: -height * 0.05, left: -width * 0.3 }}>
          <ArtSvg key={art.id} art={art} size={Math.max(width, height) * 1.3} />
        </View>
        <LinearGradient colors={['rgba(12,10,18,0.15)', 'rgba(12,10,18,0.55)', 'rgba(12,10,18,0.9)']} style={StyleSheet.absoluteFill} />
      </View>
      <SafeAreaView style={{ flex: 1 }}>{screen === 'now' && now ? now : home}</SafeAreaView>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 6 },
  emptySub: { color: '#ffffff99', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  glassFallback: { backgroundColor: 'rgba(255,255,255,0.08)' },
  cover: {
    borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  bigTitle2: { color: '#fff', fontSize: 30, fontWeight: '800' },
  backBtn: { width: 44, height: 44 },
  tabBar: { marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 999 },
  tabOn: { backgroundColor: 'rgba(255,255,255,0.22)' },
  tabTxt: { color: '#ffffffaa', fontSize: 14, fontWeight: '600' },
  rowGlass: { marginHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowSub: { color: '#ffffff99', fontSize: 12, marginTop: 2 },
  detailHead: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  bigTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  playAll: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 11 },
  addTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },
  mini: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  nowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 },
  nowLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  artist: { color: '#ffffffb0', fontSize: 14, marginTop: 4, textAlign: 'center' },
  seekRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  time: { color: '#ffffffb0', fontSize: 12, width: 38, textAlign: 'center', fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 6 },
  playGlass: { width: 68, height: 68 },
});
