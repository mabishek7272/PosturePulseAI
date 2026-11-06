import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { getMetricCatalog, type CatalogMetric } from "../api/catalog";
import { listReportResults, MetricResult } from "../api/events";
import { UnauthorizedError } from "../api/http";
import { findPatientHistory, latestEarlierWithResults, type PatientHistory } from "../api/patientHistory";
import type { PatientSession } from "../api/patients";
import { getClinicianToken } from "../auth/tokenStore";
import { BackButton } from "../components/ScreenHeader";
import { PrimaryButton, SecondaryButton } from "../components/Buttons";
import { DriftingBlobs, LIGHT_BLOBS, type BlobSpec } from "../components/DriftingBlobs";
import { GlassCard } from "../components/GlassCard";
import { ShareIcon, SparkleIcon } from "../components/icons";
import { GrowWidth, RingPulse } from "../components/Motion";
import { shareReportPdf } from "../report/sharePdf";
import { MAX_CONTENT_WIDTH } from "../components/Screen";
import {
  barLayout, coverage, formatValueParts, hasReferenceComparison, heroSummary, metricLabel, formatResult,
  NO_REFERENCE_CAPTION, positionLabel, referenceCaption, regionItems, resultKind, ringFraction, type PositionBucket,
} from "../lib/results";
import { colors, gradients } from "../theme/colors";
import { radii } from "../theme/radii";
import { shadows } from "../theme/shadows";
import { type } from "../theme/typography";

const HERO_BLOB: BlobSpec[] = [{ size: 200, right: -60, top: -70, color: colors.accent400, duration: 14, variant: 2, opacity: 0.45 }];
const DOT: Record<PositionBucket, string> = { outside: colors.accent600, within: colors.accent300, unknown: colors.hairline };
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const CIRCUMFERENCE = 2 * Math.PI * 39;

/** Ring arc = measured / total metrics (coverage, not a score). Draws in like ppDraw. */
function CoverageRing({ fraction, count }: { fraction: number; count: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(300, withTiming(fraction, { duration: 1600, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
  }, [t, fraction]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - t.value) }));
  return (
    <View style={styles.ring}>
      <Svg width={92} height={92} viewBox="0 0 92 92" style={[StyleSheet.absoluteFill, { transform: [{ rotate: "-90deg" }] }]}>
        <Circle cx={46} cy={46} r={39} fill="none" stroke={colors.heroRingTrack} strokeWidth={7} />
        <AnimatedCircle
          cx={46} cy={46} r={39} fill="none" stroke={colors.accent400} strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE}`} animatedProps={props}
        />
      </Svg>
      <Text style={styles.ringNumber}>{count}</Text>
    </View>
  );
}

function Silhouette() {
  return (
    <Svg viewBox="0 0 110 260" width={96} height={228} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <G stroke={colors.hairlineStrong} strokeWidth={1} strokeDasharray="3 4">
        <Line x1={55} y1={8} x2={55} y2={252} />
      </G>
      <G fill={colors.accent200} stroke={colors.accent400} strokeWidth={1.4}>
        <Circle cx={55} cy={26} r={15} />
        <Path d="M55 41c-13 0-22 7-24 20l-4 38c-1 8 3 12 8 12h40c5 0 9-4 8-12l-4-38c-2-13-11-20-24-20z" />
        <Path d="M33 60 24 108c-1 6-5 8-8 7-3-1-4-4-3-9l10-48z" />
        <Path d="M77 60l9 48c1 6 5 8 8 7 3-1 4-4 3-9l-10-48z" />
        <Path d="M38 112h34l3 56-6 78h-11l-2-74-2 74H43l-6-78z" />
      </G>
    </Svg>
  );
}

/** "How it's measured": the catalog's own words, formula and shared method note. Shown only when the catalog loaded. */
function HowMeasured({ info, methodNote, r }: { info: CatalogMetric; methodNote?: string; r: MetricResult }) {
  return (
    <View style={styles.how}>
      <Text style={styles.howTitle}>{"How it's measured"}</Text>
      <Text style={styles.howText}>{info.description}</Text>
      {info.formula ? <Text style={styles.howFormula}>{info.formula}</Text> : null}
      <Text style={styles.howText}>{`Sign: ${info.signConvention}.`}</Text>
      {r.estimate ? (
        <Text style={styles.howText}>{`This value: ${formatResult(r)}.`}</Text>
      ) : null}
      {methodNote ? <Text style={styles.howNote}>{methodNote}</Text> : null}
    </View>
  );
}

function MetricCard({ r, info, methodNote }: { r: MetricResult; info?: CatalogMetric; methodNote?: string }) {
  const [open, setOpen] = useState(false);
  const how = info && open ? <HowMeasured info={info} methodNote={methodNote} r={r} /> : null;
  const card = <MetricCardBody r={r} how={how} />;
  if (!info) return card;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint={open ? "Hides how this is measured" : "Shows how this is measured"}
      onPress={() => setOpen((v) => !v)}
    >
      {card}
    </Pressable>
  );
}

function MetricCardBody({ r, how }: { r: MetricResult; how: React.ReactNode }) {
  const kind = resultKind(r);
  const parts = formatValueParts(r);
  if (kind !== "estimate" || !parts) {
    // Same card shell; explicit text, no value, no bar.
    return (
      <GlassCard radius={15} fill={colors.glassStrong} intensity={30}>
        <View style={styles.metricPad}>
          <Text style={styles.metricTitle}>{metricLabel(r)}</Text>
          <Text style={styles.unmeasured}>{formatResult(r)}</Text>
          {how}
        </View>
      </GlassCard>
    );
  }
  const bar = barLayout(r);
  return (
    <GlassCard radius={15} fill={colors.glassStrong} intensity={30}>
      <View style={styles.metricPad}>
        <View style={styles.valueRow}>
          <Text style={[styles.metricTitle, styles.flexShrink]}>{metricLabel(r)}</Text>
          <Text style={styles.metricValue}>{parts.value}</Text>
          <Text style={styles.metricUnc}>{parts.uncertainty}</Text>
        </View>
        <View style={styles.track}>
          {bar ? (
            <>
              <View style={[styles.band, { left: `${bar.band.from * 100}%`, width: `${(bar.band.to - bar.band.from) * 100}%` }]} />
              <GrowWidth pct={bar.fill * 100} delay={400} style={styles.fillWrap}>
                <LinearGradient colors={gradients.progress} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
              </GrowWidth>
            </>
          ) : null}
        </View>
        {hasReferenceComparison(r) ? (
          <View style={styles.captionRow}>
            <Text style={styles.captionText}>{positionLabel(r)}</Text>
            <Text style={styles.captionText}>{referenceCaption(r)}</Text>
          </View>
        ) : (
          <Text style={styles.captionText}>{NO_REFERENCE_CAPTION}</Text>
        )}
        {how}
      </View>
    </GlassCard>
  );
}

export default function ResultsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [results, setResults] = useState<MetricResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  // Same-patient context: undefined = loading, null = patient not found.
  const [history, setHistory] = useState<PatientHistory | null | undefined>(undefined);
  const [previous, setPrevious] = useState<PatientSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return;
        const found = await findPatientHistory(sessionId, token);
        const prev = found ? await latestEarlierWithResults(found.sessions, sessionId, token) : null;
        if (!cancelled) { setHistory(found); setPrevious(prev); }
      } catch {
        // Auth failures are handled by the results load; here the actions just stay disabled.
        if (!cancelled) setHistory(null);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Optional: when the catalog cannot load, cards simply are not expandable.
  const [catalog, setCatalog] = useState<{ byKey: Map<string, CatalogMetric>; methodNote?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return;
        const c = await getMetricCatalog(token);
        if (!cancelled) setCatalog({ byKey: new Map(c.metrics.map((m) => [m.metricKey, m])), methodNote: c.methodNote });
      } catch {
        // No explanation panel; the values themselves are unaffected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const canShare = !!results && results.length > 0 && !sharing;

  async function sharePdf() {
    if (!results || sharing) return;
    setSharing(true);
    setShareError(null);
    try {
      const token = await getClinicianToken();
      if (!token) return router.replace("/login");
      await shareReportPdf({ sessionId, patientName: history?.patient.name ?? null, results, token });
    } catch (err) {
      if (err instanceof UnauthorizedError) return router.replace("/login");
      setShareError(err instanceof Error ? err.message : "Could not create the PDF.");
    } finally {
      setSharing(false);
    }
  }

  function scanAgain() {
    if (!history) return;
    router.push({ pathname: "/consent", params: { patientId: history.patient.id, patientName: history.patient.name } });
  }
  const compareReason =
    history === undefined ? "Checking for an earlier scan…"
    : history === null ? "Patient not found for this scan"
    : previous ? null : "No earlier scan with results for this patient";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getClinicianToken();
        if (!token) return router.replace("/login");
        const found = await listReportResults(sessionId, token);
        if (!cancelled) setResults(found);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) return router.replace("/login");
        setError(err instanceof Error ? err.message : "Could not load results.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const list = results ?? [];
  const cov = coverage(list);
  const hero = heroSummary(cov);
  const regions = regionItems(list);

  return (
    <View style={styles.root}>
      <DriftingBlobs blobs={LIGHT_BLOBS} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <BackButton onPress={() => router.replace("/home")} />
        <Text accessibilityRole="header" style={type.headerTitle}>Assessment</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sharing ? "Preparing the PDF" : "Share the report as a PDF"}
          accessibilityState={{ disabled: !canShare, busy: sharing }}
          disabled={!canShare}
          onPress={sharePdf}
          style={[styles.share, !canShare && { opacity: 0.45 }]}
        >
          {sharing ? <ActivityIndicator size="small" color={colors.accent600} /> : <ShareIcon size={18} color={colors.accent700} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
        {!results && !error ? <ActivityIndicator color={colors.accent600} style={styles.loading} /> : null}

        {results ? (
          <>
            <View style={[shadows.hero, styles.heroShadow]}>
              <LinearGradient
                colors={gradients.hero}
                locations={[0, 0.6, 1]}
                start={{ x: 0.17, y: 0 }}
                end={{ x: 0.83, y: 1 }}
                style={styles.hero}
              >
                <DriftingBlobs blobs={HERO_BLOB} />
                <CoverageRing fraction={ringFraction(cov)} count={cov.measured} />
                <View style={styles.heroText}>
                  <Text style={styles.heroEyebrow}>METRICS MEASURED</Text>
                  <Text style={styles.heroTitle}>{hero.title}</Text>
                  <Text style={styles.heroSub}>{hero.sub}</Text>
                </View>
              </LinearGradient>
            </View>

            <GlassCard radius={20} fill={colors.glassStrong} intensity={40}>
              <View style={styles.regions}>
                <Silhouette />
                <View style={styles.regionList}>
                  <Text style={styles.regionTitle}>Regions of interest</Text>
                  {regions.items.length === 0 ? (
                    <Text style={[styles.regionText, { color: colors.textMuted }]}>No measured metrics</Text>
                  ) : null}
                  {regions.items.map((it) => (
                    <View key={it.key} style={styles.regionRow} accessible accessibilityLabel={it.text}>
                      <View style={[styles.dot, { backgroundColor: DOT[it.bucket] }]} />
                      <Text style={styles.regionText}>{it.text}</Text>
                    </View>
                  ))}
                  {regions.more > 0 ? <Text style={[styles.regionText, { color: colors.textMuted }]}>+{regions.more} more below</Text> : null}
                </View>
              </View>
            </GlassCard>

            <View style={styles.metricsHeader}>
              <Text style={styles.metricsTitle}>Metrics</Text>
              <Text style={styles.metricsCaption}>value ± uncertainty</Text>
            </View>

            <View style={styles.metricList}>
              {list.length === 0 ? <Text style={styles.empty}>No measurements returned.</Text> : null}
              {list.map((r, i) => (
                <MetricCard key={`${r.metricKey}-${r.side ?? ""}-${i}`} r={r} info={catalog?.byKey.get(r.metricKey)} methodNote={catalog?.methodNote} />
              ))}
            </View>

            <GlassCard radius={18} fill={colors.glassTint} ring={colors.accent300} intensity={36} elevated={false}>
              <View style={styles.note}>
                <View style={styles.noteHead}>
                  <View style={styles.sparkWrap}>
                    <RingPulse duration={3000} style={styles.sparkRing} />
                    <SparkleIcon size={16} color={colors.accent700} />
                  </View>
                  <Text style={styles.noteEyebrow}>PULSE AI · DRAFT NOTE</Text>
                </View>
                <Text style={styles.noteBody}>Not available yet.</Text>
                <View style={styles.noteButtons}>
                  <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[styles.accept, styles.off]}>
                    <Text style={styles.acceptText}>Accept into record</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[styles.edit, styles.off]}>
                    <Text style={styles.editText}>Edit</Text>
                  </Pressable>
                </View>
              </View>
            </GlassCard>

            <PrimaryButton label="Sign off & close session" disabled />
            <SecondaryButton label="Scan again" onPress={scanAgain} disabled={!history} />
            <SecondaryButton
              label="Compare with previous scan"
              disabled={!!compareReason}
              onPress={() => previous && router.push({ pathname: "/compare", params: { a: previous.id, b: sessionId } })}
            />
            {compareReason ? <Text style={styles.caption}>{compareReason}</Text> : null}
            <SecondaryButton label="Done" onPress={() => router.replace("/home")} />
            <Text style={styles.caption}>Camera-based estimates. Not a substitute for clinical examination.</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingBottom: 14, backgroundColor: colors.glassHeader },
  share: {
    marginLeft: "auto", width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline, opacity: 0.5,
  },
  content: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 36, gap: 14, width: "100%", maxWidth: MAX_CONTENT_WIDTH + 44, alignSelf: "center" },
  error: { color: colors.caution, fontSize: 13 },
  loading: { marginTop: 40 },
  empty: { color: colors.textFaint, fontSize: 13 },

  heroShadow: { borderRadius: radii.hero },
  hero: { overflow: "hidden", padding: 20, borderRadius: radii.hero, flexDirection: "row", alignItems: "center", gap: 18 },
  ring: { width: 92, height: 92, alignItems: "center", justifyContent: "center" },
  ringNumber: { fontSize: 28, fontWeight: "600", letterSpacing: -1.12, color: colors.textOnDark },
  heroText: { flex: 1, gap: 6, minWidth: 0 },
  heroEyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.54, color: colors.accent400 },
  heroTitle: { fontSize: 17, fontWeight: "600", letterSpacing: -0.34, color: colors.textOnDark },
  heroSub: { fontSize: 12.5, color: colors.accent300 },

  regions: { flexDirection: "row", gap: 12, paddingVertical: 18, paddingHorizontal: 16 },
  regionList: { flex: 1, minWidth: 0, gap: 9 },
  regionTitle: { fontSize: 12.5, fontWeight: "600", letterSpacing: -0.125, color: colors.text },
  regionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  regionText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: colors.textBody },

  metricsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metricsTitle: { fontSize: 13, fontWeight: "600", letterSpacing: -0.13, color: colors.text },
  metricsCaption: { fontSize: 11.5, color: colors.textFaint },
  metricList: { gap: 9 },
  metricPad: { paddingVertical: 14, paddingHorizontal: 15 },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  flexShrink: { flex: 1 },
  metricTitle: { fontSize: 13.5, fontWeight: "600", letterSpacing: -0.135, color: colors.text },
  metricValue: { fontSize: 15, fontWeight: "600", letterSpacing: -0.3, color: colors.accent700 },
  metricUnc: { fontSize: 11.5, color: colors.textFaint },
  unmeasured: { marginTop: 6, fontSize: 12.5, lineHeight: 18, color: colors.textBody },
  track: { marginTop: 10, height: 6, borderRadius: 3, backgroundColor: colors.bgPage, overflow: "hidden" },
  band: { position: "absolute", top: 0, bottom: 0, borderRadius: 3, backgroundColor: colors.accent200 },
  fillWrap: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 3, overflow: "hidden" },
  captionRow: { marginTop: 7, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  captionText: { fontSize: 11, color: colors.textFaint },
  how: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.hairline, gap: 5 },
  howTitle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, color: colors.accent700, textTransform: "uppercase" },
  howText: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  howFormula: {
    fontSize: 12, lineHeight: 17, color: colors.text, fontFamily: "Menlo", backgroundColor: colors.accent100,
    borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, overflow: "hidden",
  },
  howNote: { fontSize: 11, lineHeight: 15.5, color: colors.textFaint },

  note: { paddingVertical: 17, paddingHorizontal: 16 },
  noteHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  sparkWrap: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  sparkRing: { position: "absolute", width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.accentRing },
  noteEyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 1.43, color: colors.accent700 },
  noteBody: { marginTop: 11, fontSize: 13.5, lineHeight: 21, color: colors.textBody },
  noteButtons: { marginTop: 13, flexDirection: "row", gap: 8 },
  accept: { flex: 1, height: 40, borderRadius: 11, backgroundColor: colors.accent700, alignItems: "center", justifyContent: "center" },
  acceptText: { fontSize: 13, fontWeight: "600", color: colors.textOnDark },
  edit: {
    height: 40, paddingHorizontal: 15, borderRadius: 11, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.accent300,
    alignItems: "center", justifyContent: "center",
  },
  editText: { fontSize: 13, fontWeight: "600", color: colors.accent700 },
  off: { opacity: 0.5 },
  caption: { color: colors.textFaint, fontSize: 11, textAlign: "center" },
});
