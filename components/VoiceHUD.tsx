'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Music, X, Mic, MicOff } from 'lucide-react';
import type { FormantAnalyzer, FormantAnalysisResult } from 'fairly-fast-formants';

// ── Types ────────────────────────────────────────────────────────────────────

interface AnalysisData {
  f0: number | null;
  f3: number | null;
  f4: number | null;
  overtones: number;
  pitchVariance: number;
}

interface TargetData {
  f3: number;
  f4: number;
  pitch: number;
  name: string;
}

interface Colors {
  current: string;
  target: string;
  match: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_COLORS: Colors = {
  current: '#60a5fa',
  target: '#f472b6',
  match: '#34d399',
};

const COLOR_PALETTES: Record<keyof Colors, string[]> = {
  current: ['#60a5fa', '#818cf8', '#34d399', '#fb923c', '#f9a8d4'],
  target: ['#f472b6', '#e879f9', '#facc15', '#f87171', '#a78bfa'],
  match: ['#34d399', '#4ade80', '#86efac', '#fbbf24', '#67e8f9'],
};

// Frequency display ranges
const F3_MIN = 1800, F3_MAX = 3600;
const F4_MIN = 2800, F4_MAX = 5000;
const PITCH_MIN = 50, PITCH_MAX = 500;
const FEMALE_PITCH_LOW = 210, FEMALE_PITCH_HIGH = 270;
const MATCH_DISTANCE = 80; // px euclidean distance threshold
const CANVAS_MARGIN = 40;
const BUFFER_SIZE = 2048;

// ── Helper: map frequency to canvas coordinates ───────────────────────────

function freqToCanvasX(f3: number, canvasW: number): number {
  const x = CANVAS_MARGIN + ((f3 - F3_MIN) / (F3_MAX - F3_MIN)) * (canvasW - 2 * CANVAS_MARGIN);
  return Math.max(CANVAS_MARGIN, Math.min(canvasW - CANVAS_MARGIN, x));
}

function freqToCanvasY(f4: number, canvasH: number): number {
  const y = canvasH - CANVAS_MARGIN - ((f4 - F4_MIN) / (F4_MAX - F4_MIN)) * (canvasH - 2 * CANVAS_MARGIN);
  return Math.max(CANVAS_MARGIN, Math.min(canvasH - CANVAS_MARGIN, y));
}

function pitchToY(pitch: number, canvasH: number): number {
  const clamped = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
  const ratio = (clamped - PITCH_MIN) / (PITCH_MAX - PITCH_MIN);
  return canvasH - ratio * canvasH;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 96, g: 165, b: 250 };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VoiceHUD() {
  const [isRunning, setIsRunning] = useState(false);
  const [colors, setColors] = useState<Colors>(DEFAULT_COLORS);
  const [targetAudio, setTargetAudio] = useState<TargetData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [openPicker, setOpenPicker] = useState<keyof Colors | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const formantAnalyzerRef = useRef<FormantAnalyzer | null>(null);
  const pitchDetectorRef = useRef<((buf: Float32Array) => number | null) | null>(null);

  // Analysis data refs (updated from audio thread, read in rAF)
  const analysisRef = useRef<AnalysisData>({
    f0: null, f3: null, f4: null, overtones: 0, pitchVariance: 0,
  });
  const recentPitchesRef = useRef<number[]>([]);
  const targetRef = useRef<TargetData | null>(null);
  const colorsRef = useRef<Colors>(DEFAULT_COLORS);

  // Canvas refs
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const pitchCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const pulseRef = useRef<number>(0);
  const isMatchingRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // DOM refs for live-updating elements without re-renders
  const overtoneBarRef = useRef<HTMLDivElement>(null);
  const overtoneWarnRef = useRef<HTMLSpanElement>(null);

  // Keep ref mirrors in sync with state
  useEffect(() => { colorsRef.current = colors; }, [colors]);
  useEffect(() => { targetRef.current = targetAudio; }, [targetAudio]);

  // ── Audio Analysis ──────────────────────────────────────────────────────

  const handleAudioBuffer = useCallback(async (buffer: Float32Array) => {
    const analysis = analysisRef.current;

    // Pitch detection (pitchfinder YIN)
    if (pitchDetectorRef.current) {
      try {
        const pitch = pitchDetectorRef.current(buffer);
        if (pitch && pitch > 50 && pitch < 1000) {
          analysis.f0 = pitch;
          // Track recent pitches for variance
          recentPitchesRef.current.push(pitch);
          if (recentPitchesRef.current.length > 60) {
            recentPitchesRef.current.shift();
          }
          const pitches = recentPitchesRef.current;
          if (pitches.length > 2) {
            const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
            const variance = pitches.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / pitches.length;
            analysis.pitchVariance = Math.sqrt(variance);
          }
        } else {
          analysis.f0 = null;
        }
      } catch {
        // ignore pitch detection errors
      }
    }

    // Formant analysis (fairly-fast-formants)
    if (formantAnalyzerRef.current) {
      try {
        const result: FormantAnalysisResult = formantAnalyzerRef.current.analyze(buffer);
        if (result.success && result.formants.length >= 4) {
          const sorted = [...result.formants].sort((a, b) => a.frequency - b.frequency);
          analysis.f3 = sorted[2]?.frequency ?? null;
          analysis.f4 = sorted[3]?.frequency ?? null;
          analysis.overtones = sorted.filter(f => f.frequency < 2000).length;
        }
      } catch {
        // ignore formant errors
      }
    }
  }, []);

  // ── Start/Stop Audio ───────────────────────────────────────────────────

  const stopAudio = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (formantAnalyzerRef.current) {
      try { formantAnalyzerRef.current.destroy(); } catch { /* ignore */ }
      formantAnalyzerRef.current = null;
    }
    analysisRef.current = { f0: null, f3: null, f4: null, overtones: 0, pitchVariance: 0 };
    recentPitchesRef.current = [];
    setIsRunning(false);
  }, []);

  const startAudio = useCallback(async () => {
    try {
      setErrorMsg(null);
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      // Load AudioWorklet
      await ctx.audioWorklet.addModule('/processor.js');

      // Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);

      // FFT analyser node
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyserRef.current = analyser;

      // AudioWorklet node
      const worklet = new AudioWorkletNode(ctx, 'audio-processor');
      workletNodeRef.current = worklet;

      worklet.port.onmessage = (e) => {
        if (e.data.type === 'audioData') {
          handleAudioBuffer(e.data.buffer);
        }
      };

      source.connect(analyser);
      source.connect(worklet);
      // worklet output intentionally not connected to destination (analysis only)

      // Initialize formant analyzer
      const { FormantAnalyzer } = await import('fairly-fast-formants');
      const analyzer = new FormantAnalyzer({
        model_order: 16,
        window_length_s: BUFFER_SIZE / ctx.sampleRate,
        sample_rate_hz: ctx.sampleRate,
        frequency_bins: 512,
      });
      await analyzer.init();
      formantAnalyzerRef.current = analyzer;

      // Initialize pitch detector
      const Pitchfinder = await import('pitchfinder');
      pitchDetectorRef.current = Pitchfinder.YIN({ sampleRate: ctx.sampleRate });

      setIsRunning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`マイクの起動に失敗しました: ${msg}`);
      stopAudio();
    }
  }, [handleAudioBuffer, stopAudio]);

  // ── Target Audio Analysis ──────────────────────────────────────────────

  const analyzeTargetAudio = useCallback(async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      await ctx.close();

      const channelData = audioBuffer.getChannelData(0);
      const sr = audioBuffer.sampleRate;

      // Sample pitchfinder over the entire file to find average pitch
      const Pitchfinder = await import('pitchfinder');
      const detector = Pitchfinder.YIN({ sampleRate: sr });

      const pitches: number[] = [];
      const f3s: number[] = [];
      const f4s: number[] = [];

      const { FormantAnalyzer } = await import('fairly-fast-formants');
      const analyzer = new FormantAnalyzer({
        model_order: 16,
        window_length_s: BUFFER_SIZE / sr,
        sample_rate_hz: sr,
        frequency_bins: 512,
      });
      await analyzer.init();

      // Analyze every 50ms hop
      const hopSize = Math.floor(sr * 0.05);
      for (let i = 0; i + BUFFER_SIZE < channelData.length; i += hopSize) {
        const chunk = channelData.slice(i, i + BUFFER_SIZE);

        const pitch = detector(chunk);
        if (pitch && pitch > 100 && pitch < 600) pitches.push(pitch);

        const result = analyzer.analyze(chunk);
        if (result.success && result.formants.length >= 4) {
          const sorted = [...result.formants].sort((a, b) => a.frequency - b.frequency);
          if (sorted[2]?.frequency) f3s.push(sorted[2].frequency);
          if (sorted[3]?.frequency) f4s.push(sorted[3].frequency);
        }
      }

      analyzer.destroy();

      const median = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };

      setTargetAudio({
        f3: median(f3s) || 2500,
        f4: median(f4s) || 3500,
        pitch: median(pitches) || 220,
        name: file.name,
      });
    } catch (err) {
      setErrorMsg(`ターゲット音声の解析に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // ── Canvas Drawing ─────────────────────────────────────────────────────

  const drawMainCanvas = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const colors = colorsRef.current;
    const analysis = analysisRef.current;
    const target = targetRef.current;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridCols = 6, gridRows = 5;
    for (let i = 0; i <= gridCols; i++) {
      const x = CANVAS_MARGIN + (i / gridCols) * (W - 2 * CANVAS_MARGIN);
      ctx.beginPath(); ctx.moveTo(x, CANVAS_MARGIN); ctx.lineTo(x, H - CANVAS_MARGIN); ctx.stroke();
    }
    for (let i = 0; i <= gridRows; i++) {
      const y = CANVAS_MARGIN + (i / gridRows) * (H - 2 * CANVAS_MARGIN);
      ctx.beginPath(); ctx.moveTo(CANVAS_MARGIN, y); ctx.lineTo(W - CANVAS_MARGIN, y); ctx.stroke();
    }

    // Axis labels (minimal)
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('F3 →', W / 2, H - 8);
    ctx.save();
    ctx.translate(12, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('F4 ↑', 0, 0);
    ctx.restore();

    // Pulse counter
    pulseRef.current += 0.04;

    // Target circle (if loaded)
    if (target) {
      const tx = freqToCanvasX(target.f3, W);
      const ty = freqToCanvasY(target.f4, H);
      const baseR = 36;
      const pulseR = baseR + Math.sin(pulseRef.current) * 6;

      // Outer glow
      const grd = ctx.createRadialGradient(tx, ty, 0, tx, ty, pulseR * 2.5);
      grd.addColorStop(0, colorWithAlpha(colors.target, 0.3));
      grd.addColorStop(1, colorWithAlpha(colors.target, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(tx, ty, pulseR * 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Target ring
      ctx.strokeStyle = colorWithAlpha(colors.target, 0.7 + Math.sin(pulseRef.current) * 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, pulseR, 0, Math.PI * 2);
      ctx.stroke();

      // Inner dot
      ctx.fillStyle = colorWithAlpha(colors.target, 0.5);
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Current voice position
    if (analysis.f3 && analysis.f4) {
      const cx = freqToCanvasX(analysis.f3, W);
      const cy = freqToCanvasY(analysis.f4, H);

      // Tether line to target
      if (target) {
        const tx = freqToCanvasX(target.f3, W);
        const ty = freqToCanvasY(target.f4, H);
        const dx = cx - tx, dy = cy - ty;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const closeness = Math.max(0, 1 - dist / 400);

        const lineWidth = 1 + closeness * 5;
        const alpha = 0.2 + closeness * 0.6;
        const lineColor = closeness > 0.5 ? colors.match : colors.current;

        ctx.strokeStyle = colorWithAlpha(lineColor, alpha);
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        // Check match
        isMatchingRef.current = dist < MATCH_DISTANCE;
        if (isMatchingRef.current) {
          // Emit particles
          for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 3;
            particlesRef.current.push({
              x: tx, y: ty,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: 1,
              maxLife: 1,
              color: colors.match,
              size: 2 + Math.random() * 4,
            });
          }

          // Target burst glow
          const burstGrd = ctx.createRadialGradient(tx, ty, 0, tx, ty, MATCH_DISTANCE);
          burstGrd.addColorStop(0, colorWithAlpha(colors.match, 0.5));
          burstGrd.addColorStop(1, colorWithAlpha(colors.match, 0));
          ctx.fillStyle = burstGrd;
          ctx.beginPath();
          ctx.arc(tx, ty, MATCH_DISTANCE, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Current voice sphere (glowing orb)
      const orbR = 12;
      const orbGrd = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, orbR * 2);
      orbGrd.addColorStop(0, colorWithAlpha(colors.current, 0.9));
      orbGrd.addColorStop(0.4, colorWithAlpha(colors.current, 0.5));
      orbGrd.addColorStop(1, colorWithAlpha(colors.current, 0));
      ctx.fillStyle = orbGrd;
      ctx.beginPath();
      ctx.arc(cx, cy, orbR * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = colors.current;
      ctx.beginPath();
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Particles
    const alive: Particle[] = [];
    for (const p of particlesRef.current) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.025;
      if (p.life > 0) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        alive.push(p);
      }
    }
    ctx.globalAlpha = 1;
    particlesRef.current = alive;
  }, []);

  const drawPitchCanvas = useCallback(() => {
    const canvas = pitchCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const colors = colorsRef.current;
    const f0 = analysisRef.current.f0;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, W, H);

    const barX = W * 0.35;
    const barW = W * 0.3;

    // Female target zone highlight
    const yLow = pitchToY(FEMALE_PITCH_LOW, H);
    const yHigh = pitchToY(FEMALE_PITCH_HIGH, H);
    ctx.fillStyle = 'rgba(52,211,153,0.12)';
    ctx.fillRect(barX - 4, yHigh, barW + 8, yLow - yHigh);
    ctx.strokeStyle = 'rgba(52,211,153,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 4, yHigh, barW + 8, yLow - yHigh);

    // Track background
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(barX, 0, barW, H);

    // Hz labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    const labelFreqs = [100, 150, 200, 250, 300, 350, 400];
    for (const freq of labelFreqs) {
      const y = pitchToY(freq, H);
      ctx.fillText(`${freq}`, barX - 6, y + 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(barX, y);
      ctx.lineTo(barX + barW, y);
      ctx.stroke();
    }

    // Target band label
    ctx.fillStyle = 'rgba(52,211,153,0.7)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('目標', barX + barW / 2, (yLow + yHigh) / 2 + 3);

    // Current pitch bar
    if (f0 !== null && f0 > 0) {
      const barY = pitchToY(f0, H);
      const barH = H - barY;

      // Color based on range
      let barColor: string;
      if (f0 < FEMALE_PITCH_LOW) barColor = colors.current;
      else if (f0 <= FEMALE_PITCH_HIGH) barColor = '#34d399';
      else barColor = '#f87171';

      const grd = ctx.createLinearGradient(barX, barY, barX, H);
      grd.addColorStop(0, barColor);
      grd.addColorStop(1, colorWithAlpha(barColor, 0.2));
      ctx.fillStyle = grd;
      ctx.fillRect(barX, barY, barW, barH);

      // Marker line
      ctx.fillStyle = barColor;
      ctx.fillRect(barX - 4, barY - 2, barW + 8, 4);

      // Hz readout
      ctx.fillStyle = barColor;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(f0)}Hz`, barX + barW / 2, Math.max(barY - 8, 16));

      // Warning if too low
      if (f0 < 100) {
        ctx.fillStyle = '#f87171';
        ctx.font = '9px monospace';
        ctx.fillText('!低', barX + barW / 2, barY - 20);
      }
    }

    // Title
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PITCH', W / 2, H - 6);
  }, []);

  // ── rAF Loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const loop = () => {
      drawMainCanvas();
      drawPitchCanvas();

      // Update overtone bar DOM directly (no re-render)
      if (overtoneBarRef.current) {
        const level = Math.min(1, analysisRef.current.overtones / 5);
        overtoneBarRef.current.style.height = `${level * 100}%`;
        if (level > 0.6) {
          overtoneBarRef.current.style.background = 'rgba(52,211,153,0.6)';
        } else if (level > 0.3) {
          overtoneBarRef.current.style.background = 'rgba(251,191,36,0.6)';
        } else {
          overtoneBarRef.current.style.background = 'rgba(248,113,113,0.6)';
        }
      }
      if (overtoneWarnRef.current) {
        const level = Math.min(1, analysisRef.current.overtones / 5);
        overtoneWarnRef.current.style.display = level < 0.4 ? 'block' : 'none';
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawMainCanvas, drawPitchCanvas]);

  // ── Canvas Resize ───────────────────────────────────────────────────────

  useEffect(() => {
    const resizeCanvases = () => {
      const main = mainCanvasRef.current;
      const pitch = pitchCanvasRef.current;
      // Read size from the parent container, not the canvas itself.
      // Reading canvas.offsetWidth after setting canvas.width causes a
      // ResizeObserver feedback loop (intrinsic size change → observer fires → repeat).
      if (main?.parentElement) {
        main.width = main.parentElement.clientWidth;
        main.height = main.parentElement.clientHeight;
      }
      if (pitch?.parentElement) {
        pitch.width = pitch.parentElement.clientWidth;
        pitch.height = pitch.parentElement.clientHeight;
      }
    };
    resizeCanvases();
    const ro = new ResizeObserver(resizeCanvases);
    // Observe parent containers (stable CSS-sized divs), not the canvases themselves.
    const mainParent = mainCanvasRef.current?.parentElement;
    const pitchParent = pitchCanvasRef.current?.parentElement;
    if (mainParent) ro.observe(mainParent);
    if (pitchParent) ro.observe(pitchParent);
    return () => ro.disconnect();
  }, []);

  // ── Drag and Drop ────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Only respond to actual file drags, not touch gestures.
    // Calling preventDefault unconditionally can suppress tap→click on mobile.
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith('audio/') || file.name.match(/\.(wav|mp3|ogg|m4a)$/i))) {
      analyzeTargetAudio(file);
    }
  }, [analyzeTargetAudio]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) analyzeTargetAudio(file);
  }, [analyzeTargetAudio]);

  // ── Color picker close on outside tap/click ───────────────────────────

  useEffect(() => {
    if (!openPicker) return;
    // Bubble phase (no capture) so that e.stopPropagation() on the color button
    // prevents this listener from firing when the button itself is tapped.
    const close = () => setOpenPicker(null);
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('click', close);
    };
  }, [openPicker]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-black text-white flex relative"
    >
      {/* Error message */}
      {errorMsg && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/80 text-red-200 text-xs px-4 py-2 rounded font-mono max-w-xs text-center">
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} className="ml-2 opacity-60 hover:opacity-100 cursor-pointer">✕</button>
        </div>
      )}

      {/* ── Left pane (15%): voice state + color settings ──────────────── */}
      <div className="relative z-20 w-[15%] shrink-0 flex flex-col items-center py-6 px-2 gap-6 border-r border-white/5">

        {/* Start/Stop button */}
        <button
          onClick={isRunning ? stopAudio : startAudio}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer touch-manipulation ${
            isRunning
              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          title={isRunning ? 'マイクを停止' : 'マイクを開始'}
        >
          {isRunning
            ? <MicOff size={18} className="pointer-events-none" />
            : <Mic size={18} className="pointer-events-none" />}
        </button>

        {/* Color circles */}
        <div className="flex flex-col gap-4 items-center">
          {(['current', 'target', 'match'] as const).map((key) => (
            <div key={key} className="flex flex-col items-center gap-1 relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenPicker(openPicker === key ? null : key);
                }}
                className="w-7 h-7 rounded-full border-2 border-white/20 hover:border-white/50 transition-colors shadow-lg cursor-pointer touch-manipulation"
                style={{ background: colors[key], boxShadow: `0 0 10px ${colors[key]}66` }}
                title={key === 'current' ? '自分の声' : key === 'target' ? 'ターゲット' : '一致時'}
              />
              <span className="text-white/30 text-[9px] font-mono select-none">
                {key === 'current' ? 'NOW' : key === 'target' ? 'TGT' : 'MTH'}
              </span>

              {/* Color palette popover */}
              {openPicker === key && (
                <div
                  className="absolute left-10 top-0 z-40 bg-zinc-900 border border-white/10 rounded-lg p-2 flex flex-col gap-1 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-white/40 text-[9px] font-mono mb-1">
                    {key === 'current' ? '自分の声' : key === 'target' ? 'ターゲット' : '一致時'}
                  </span>
                  <div className="flex gap-1">
                    {COLOR_PALETTES[key].map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setColors(prev => ({ ...prev, [key]: c }));
                          setOpenPicker(null);
                        }}
                        className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform cursor-pointer touch-manipulation"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Overtone indicator */}
        <div className="flex flex-col items-center gap-2 mt-auto w-full px-3">
          <span className="text-white/30 text-[9px] font-mono select-none">倍音</span>
          <div className="w-full h-24 bg-white/5 rounded relative overflow-hidden">
            <div
              ref={overtoneBarRef}
              className="absolute bottom-0 w-full rounded"
              style={{ height: '0%', background: 'rgba(248,113,113,0.6)', transition: 'height 0.1s' }}
            />
          </div>
          <span
            ref={overtoneWarnRef}
            className="text-red-400 text-[8px] font-mono text-center select-none"
            style={{ display: 'none' }}
          >
            裏声注意
          </span>
        </div>
      </div>

      {/* ── Center pane (70%): main F3/F4 map canvas + D&D zone ────────── */}
      <div
        className="flex-1 relative select-none"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* D&D overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 border-2 border-dashed border-pink-400 pointer-events-none">
            <p className="text-pink-400 text-xl font-mono">音声ファイルをドロップ</p>
          </div>
        )}

        <canvas
          ref={mainCanvasRef}
          className="w-full h-full block"
          style={{ touchAction: 'none' }}
        />

        {/* Welcome overlay when not running */}
        {!isRunning && !isDragging && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-white/20 text-sm font-mono text-center leading-6">
              左の <span className="text-white/40">Mic</span> ボタンで開始<br />
              ターゲット音声をここにドロップ
            </p>
          </div>
        )}

        {/* Target info badge */}
        {targetAudio && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 border border-white/10 rounded px-3 py-1 text-[10px] font-mono text-white/50">
            <span className="text-pink-400/70">TARGET:</span> {targetAudio.name} &nbsp;
            F3:{Math.round(targetAudio.f3)}Hz F4:{Math.round(targetAudio.f4)}Hz P:{Math.round(targetAudio.pitch)}Hz
          </div>
        )}
      </div>

      {/* ── Right pane (15%): pitch indicator ──────────────────────────── */}
      <div className="w-[15%] flex flex-col items-center py-6 px-2 border-l border-white/5">
        <canvas
          ref={pitchCanvasRef}
          className="w-full flex-1 block"
        />
      </div>

      {/* ── Bottom-right: target audio loader button ──────────────────── */}
      <div className="absolute bottom-4 right-4 z-30">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.m4a"
          className="hidden"
          onChange={handleFileChange}
        />
        {targetAudio ? (
          <button
            onClick={() => setTargetAudio(null)}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-transparent text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors cursor-pointer"
            title="ターゲットをリセット"
          >
            <X size={18} className="pointer-events-none" />
          </button>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-transparent text-white/20 hover:text-white/50 hover:bg-white/10 transition-colors cursor-pointer"
            title="ターゲット音声を読み込む"
          >
            <Music size={18} className="pointer-events-none" />
          </button>
        )}
      </div>
    </div>
  );
}
