import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera, Disc, PenTool, Play, Pause, ChevronLeft,
  Eraser, Library, Circle as CircleIcon, ArrowRight, Minus,
  Video, Hand, Info, Upload, Download, AlertTriangle,
  RotateCcw, RotateCw, FastForward, Rewind, SkipBack, Radio, Home, HardDrive, Eye, X, Undo,
  Check, Scissors, Save as SaveIcon
} from 'lucide-react';

// Helpers
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const App = () => {
  // --- ÉTATS ---
  const [stream, setStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [viewMode, setViewMode] = useState('home');
  const [sessionType, setSessionType] = useState('free');

  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [supportedMimeType, setSupportedMimeType] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [playbackError, setPlaybackError] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);

  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [showFeedbackAnim, setShowFeedbackAnim] = useState(false);

  const [isTimeShifting, setIsTimeShifting] = useState(false);
  const [timeShiftUrl, setTimeShiftUrl] = useState(null);
  const [timeShiftChunks, setTimeShiftChunks] = useState([]);

  const [clips, setClips] = useState([]);
  const [activeClip, setActiveClip] = useState(null);

  const [isPlayingClip, setIsPlayingClip] = useState(true);

  // DESSIN
  const [drawingTool, setDrawingTool] = useState('none');
  const [drawingColor, setDrawingColor] = useState('#ef4444');
  const [shapes, setShapes] = useState([]);
  const [videoRotation, setVideoRotation] = useState(0);

  // TRIMMING (Séquenceur)
  const [trimRange, setTrimRange] = useState([0, 100]); // [start%, end%]
  const [trimDuration, setTrimDuration] = useState(0); // Durée totale en sec

  // --- RÉFÉRENCES ---
  const liveVideoRef = useRef(null);
  const analysisVideoRef = useRef(null);
  const trimmingVideoRef = useRef(null); // Lecteur pour le découpage
  const mediaRecorderRef = useRef(null);
  const chunksBufferRef = useRef([]);
  const fullSessionChunksRef = useRef([]);
  const mediaHeaderRef = useRef(null);
  const currentStreamIdRef = useRef(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [recordingTime, setRecordingTime] = useState(0);

  // Style dynamique pour coller le canvas à la vidéo
  const [canvasStyle, setCanvasStyle] = useState({});

  const shapesRef = useRef([]);
  const currentShapeRef = useRef(null);

  const BUFFER_DURATION_MS = 180000;
  const CHUNK_INTERVAL_MS = 1000;

  // --- FONCTIONS ---

  const showFeedback = (msg, isError = false) => {
    setFeedbackMessage(msg);
    setShowFeedbackAnim(true);
    setTimeout(() => setShowFeedbackAnim(false), 2000);
  };

  const rotateVideo = () => setVideoRotation(prev => (prev + 90) % 360);

  // 1. Enregistrement
  const saveFullSession = () => {
    if (fullSessionChunksRef.current.length === 0) return;
    try {
      const blob = new Blob(fullSessionChunksRef.current, { type: supportedMimeType });
      const ext = supportedMimeType.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `session-camera-${new Date().toISOString()}.${ext}`);
    } catch (e) { alert("Erreur sauvegarde."); }
  };

  const startBuffering = (mediaStream, mimeType) => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
      chunksBufferRef.current = [];
      mediaHeaderRef.current = null;
      const options = { mimeType: mimeType };
      const recorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) {
          if (!mediaHeaderRef.current) mediaHeaderRef.current = e.data;
          const now = Date.now();
          chunksBufferRef.current.push({ data: e.data, timestamp: now });
          const cutoff = now - BUFFER_DURATION_MS;
          if (chunksBufferRef.current.length > 200) chunksBufferRef.current = chunksBufferRef.current.filter(c => c.timestamp > cutoff);
          if (window.isRecordingActive) fullSessionChunksRef.current.push(e.data);
        }
      });
      recorder.start(CHUNK_INTERVAL_MS);
    } catch (e) { setErrorMsg(`Erreur Recorder: ${e.message}`); }
  };

  const startRecordingProcess = () => {
    fullSessionChunksRef.current = [];
    if (mediaHeaderRef.current) fullSessionChunksRef.current.push(mediaHeaderRef.current);
    setRecordingTime(0);
    setIsRecording(true);
    window.isRecordingActive = true;
    recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
  };

  const stopRecordingProcess = () => {
    setIsRecording(false);
    window.isRecordingActive = false;
    clearInterval(recordingTimerRef.current);
    saveFullSession();
  };

  const toggleRecording = () => {
    if (isRecording) stopRecordingProcess();
    else startRecordingProcess();
  };

  // 2. Caméra
  const goBackToLive = () => {
    setIsTimeShifting(false);
    setShapes([]);
    shapesRef.current = [];
    currentShapeRef.current = null;
    setDrawingTool('none');
    setTimeShiftChunks([]);

    if (timeShiftUrl) { URL.revokeObjectURL(timeShiftUrl); setTimeShiftUrl(null); }
    if (liveVideoRef.current && stream) {
      liveVideoRef.current.src = "";
      liveVideoRef.current.srcObject = stream;
      liveVideoRef.current.muted = true;
      liveVideoRef.current.play().catch(e => console.error("Reprise Live:", e));
    }
  };

  const startCameraStream = async (deviceId) => {
    if (!deviceId) return;

    if (stream && stream.active && currentStreamIdRef.current === deviceId) {
      if (liveVideoRef.current && !liveVideoRef.current.srcObject && !isTimeShifting) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.muted = true;
        liveVideoRef.current.play().catch(e => console.log("Play error", e));
      }
      return;
    }

    if (isRecording) {
      if (!confirm("Arrêter l'enregistrement pour changer de caméra ?")) return;
      stopRecordingProcess();
    }
    goBackToLive();
    if (stream) stream.getTracks().forEach(track => track.stop());

    const getStream = async (constraints) => {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.warn("Constraint failed:", constraints, err);
        return null;
      }
    };

    let newStream = await getStream({
      audio: true,
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 1.7777777778 },
        frameRate: { ideal: 30 }
      }
    });

    if (!newStream) {
      newStream = await getStream({
        audio: true,
        video: { deviceId: { exact: deviceId } }
      });
    }

    if (!newStream) {
      newStream = await getStream({
        audio: true,
        video: true
      });
    }

    if (newStream) {
      setStream(newStream);
      currentStreamIdRef.current = deviceId;

      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = newStream;
        liveVideoRef.current.muted = true;
      }

      if (supportedMimeType) {
        startBuffering(newStream, supportedMimeType);
      } else {
        setErrorMsg("Format non supporté.");
      }
      setErrorMsg('');
    } else {
      setErrorMsg(`Erreur caméra: Impossible d'accéder au périphérique.`);
    }
  };

  const enterLiveMode = async (shouldRecord = false) => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      setVideoDevices(videoInputs);
      if (!selectedDeviceId && videoInputs.length > 0) {
        const backCamera = videoInputs.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
        setSelectedDeviceId(backCamera ? backCamera.deviceId : videoInputs[0].deviceId);
      }
      setViewMode('live');
      setSessionType(shouldRecord ? 'rec' : 'free');
      if (shouldRecord) setTimeout(() => startRecordingProcess(), 1000);
    } catch (e) { alert("L'accès à la caméra est nécessaire."); }
  };

  const goHome = () => {
    if (isRecording) { if (!confirm("Arrêter la session ?")) return; stopRecordingProcess(); }
    if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null); currentStreamIdRef.current = null; }
    setViewMode('home');
  };

  // --- TRIMMING ---
  const enterTrimmingMode = () => {
    let sourceChunks = isTimeShifting && timeShiftChunks.length > 0 ? timeShiftChunks : chunksBufferRef.current.map(c => c.data);
    if (mediaHeaderRef.current && sourceChunks.length > 0 && sourceChunks[0] !== mediaHeaderRef.current) {
      sourceChunks = [mediaHeaderRef.current, ...sourceChunks];
    }
    if (sourceChunks.length === 0) { showFeedback("Rien à découper", true); return; }
    setTimeShiftChunks(sourceChunks);
    setTrimRange([0, 100]);
    setViewMode('trimming');
  };

  const saveTrimmedClip = () => {
    const dataChunks = timeShiftChunks.filter(c => c !== mediaHeaderRef.current);
    const startIndex = Math.floor((trimRange[0] / 100) * dataChunks.length);
    const endIndex = Math.ceil((trimRange[1] / 100) * dataChunks.length);
    let clipChunks = dataChunks.slice(startIndex, endIndex);
    if (mediaHeaderRef.current) clipChunks = [mediaHeaderRef.current, ...clipChunks];

    try {
      const blob = new Blob(clipChunks, { type: supportedMimeType });
      if (blob.size === 0) throw new Error("Clip vide");
      const url = URL.createObjectURL(blob);
      const newClip = {
        id: Date.now(),
        url: url,
        duration: Math.floor(clipChunks.length * (CHUNK_INTERVAL_MS / 1000)),
        size: (blob.size / 1024 / 1024).toFixed(2),
        type: 'camera',
        timeString: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        mime: supportedMimeType
      };
      setClips(prev => [newClip, ...prev]);
      showFeedback("Séquence sauvegardée !");
      if (isTimeShifting) setViewMode('live'); else goBackToLive();
    } catch (e) { showFeedback("Erreur création", true); }
    setViewMode('live');
  };

  const createClip = (secondsBack) => {
    let sourceChunks = isTimeShifting && timeShiftChunks.length > 0 ? timeShiftChunks : chunksBufferRef.current.map(c => c.data);
    if (sourceChunks.length === 0) return;
    const count = (secondsBack * 1000) / CHUNK_INTERVAL_MS + 5;
    let clipChunks = sourceChunks.slice(-count);
    if (mediaHeaderRef.current && clipChunks[0] !== mediaHeaderRef.current) clipChunks = [mediaHeaderRef.current, ...clipChunks];

    const blob = new Blob(clipChunks, { type: supportedMimeType });
    const url = URL.createObjectURL(blob);
    const newClip = {
      id: Date.now(),
      url: url,
      duration: secondsBack,
      size: (blob.size / 1024 / 1024).toFixed(2),
      type: 'camera',
      timeString: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mime: supportedMimeType
    };
    setClips(prev => [newClip, ...prev]);
    showFeedback("Clip Rapide Sauvegardé !");
  };

  const downloadClip = (e, clip) => {
    if (e) e.stopPropagation();
    const ext = (clip.mime && clip.mime.includes('mp4')) ? 'mp4' : 'webm';
    fetch(clip.url).then(res => res.blob()).then(blob => downloadBlob(blob, `clip-${clip.id}.${ext}`));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const newClip = {
      id: Date.now(),
      url: url,
      duration: 'Import',
      size: (file.size / 1024 / 1024).toFixed(2),
      type: 'import',
      timeString: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mime: file.type
    };
    setClips(prev => [newClip, ...prev]);
    openClip(newClip);
  };

  const triggerFileInput = () => { if (fileInputRef.current) fileInputRef.current.click(); };

  const handleTimeShift = (secondsToJump) => {
    if (chunksBufferRef.current.length === 0) { showFeedback("Pas de retour possible", true); return; }
    let blobUrl = timeShiftUrl;
    if (!isTimeShifting) {
      try {
        let chunks = chunksBufferRef.current.map(c => c.data);
        if (mediaHeaderRef.current && chunks[0] !== mediaHeaderRef.current) chunks = [mediaHeaderRef.current, ...chunks];
        setTimeShiftChunks(chunks);
        const blob = new Blob(chunks, { type: supportedMimeType });
        blobUrl = URL.createObjectURL(blob);
        setTimeShiftUrl(blobUrl);
        setIsTimeShifting(true);
        setShapes([]); shapesRef.current = []; currentShapeRef.current = null; renderCanvas();
        if (liveVideoRef.current) { liveVideoRef.current.srcObject = null; liveVideoRef.current.src = blobUrl; liveVideoRef.current.muted = false; liveVideoRef.current.load(); }
      } catch (e) { return; }
    }
    setTimeout(() => {
      if (liveVideoRef.current && Number.isFinite(liveVideoRef.current.duration)) {
        const d = liveVideoRef.current.duration;
        let t = (liveVideoRef.current.currentTime || d) + secondsToJump;
        if (t < 0) t = 0; if (t > d) t = d;
        liveVideoRef.current.currentTime = t;
        if (!drawingTool || drawingTool === 'none') liveVideoRef.current.play().catch(() => { });
      }
    }, 100);
  };

  // --- DRAWING ---

  const updateCanvasLayout = () => {
    const video = (viewMode === 'live' || viewMode === 'trimming') ? liveVideoRef.current : analysisVideoRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!video || !canvas || !container) return;

    const cWidth = container.clientWidth;
    const cHeight = container.clientHeight;

    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    if (vWidth === 0 || vHeight === 0) return;

    const videoRatio = vWidth / vHeight;
    const containerRatio = cWidth / cHeight;

    let finalW, finalH, finalTop, finalLeft;

    if (containerRatio > videoRatio) {
      finalH = cHeight;
      finalW = cHeight * videoRatio;
      finalTop = 0;
      finalLeft = (cWidth - finalW) / 2;
    } else {
      finalW = cWidth;
      finalH = cWidth / videoRatio;
      finalLeft = 0;
      finalTop = (cHeight - finalH) / 2;
    }

    canvas.style.width = `${finalW}px`;
    canvas.style.height = `${finalH}px`;
    canvas.style.top = `${finalTop}px`;
    canvas.style.left = `${finalLeft}px`;

    canvas.width = finalW;
    canvas.height = finalH;

    setCanvasStyle({ width: finalW, height: finalH, top: finalTop, left: finalLeft });
    renderCanvas();
  };

  useEffect(() => {
    const video = (viewMode === 'live' || viewMode === 'trimming') ? liveVideoRef.current : analysisVideoRef.current;
    if (video) {
      video.addEventListener('loadedmetadata', updateCanvasLayout);
      video.addEventListener('resize', updateCanvasLayout);
    }
    const container = containerRef.current;
    if (container) {
      const observer = new ResizeObserver(updateCanvasLayout);
      observer.observe(container);
      return () => {
        observer.disconnect();
        if (video) {
          video.removeEventListener('loadedmetadata', updateCanvasLayout);
          video.removeEventListener('resize', updateCanvasLayout);
        }
      }
    }
  }, [viewMode, isTimeShifting, activeClip]);

  const openClip = (clip) => {
    setActiveClip(clip); setViewMode('analysis'); setShapes([]); shapesRef.current = []; currentShapeRef.current = null; setIsPlayingClip(true); setDrawingTool('none'); setPlaybackError(false);
  };
  const handleVideoTimeUpdate = () => { };

  const selectTool = (tool) => {
    setDrawingTool(tool);
    if (tool !== 'none') {
      const v = (viewMode === 'live') ? liveVideoRef.current : analysisVideoRef.current;
      if (v) v.pause();
      setIsPlayingClip(false);
    }
  };

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const drawShape = (s) => {
      if (!s) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.beginPath();
      if (s.type === 'free') {
        if (s.points.length < 2) return;
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
      } else if (s.type === 'circle') {
        // MODIFICATION: Dessin "Coin à Coin" (Ellipse Bounding Box)
        const centerX = (s.start.x + s.end.x) / 2;
        const centerY = (s.start.y + s.end.y) / 2;
        const radiusX = Math.abs(s.end.x - s.start.x) / 2;
        const radiusY = Math.abs(s.end.y - s.start.y) / 2;
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (s.type === 'line') {
        ctx.moveTo(s.start.x, s.start.y); ctx.lineTo(s.end.x, s.end.y); ctx.stroke();
      } else if (s.type === 'arrow') {
        const a = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x); const h = 20;
        ctx.moveTo(s.start.x, s.start.y); ctx.lineTo(s.end.x, s.end.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.end.x, s.end.y);
        ctx.lineTo(s.end.x - h * Math.cos(a - Math.PI / 6), s.end.y - h * Math.sin(a - Math.PI / 6));
        ctx.moveTo(s.end.x, s.end.y);
        ctx.lineTo(s.end.x - h * Math.cos(a + Math.PI / 6), s.end.y - h * Math.sin(a + Math.PI / 6));
        ctx.stroke();
      } else if (s.type === 'cross') {
        const size = 15;
        ctx.moveTo(s.end.x - size, s.end.y - size); ctx.lineTo(s.end.x + size, s.end.y + size);
        ctx.moveTo(s.end.x + size, s.end.y - size); ctx.lineTo(s.end.x - size, s.end.y + size);
        ctx.stroke();
      }
    };
    shapesRef.current.forEach(drawShape);
    if (currentShapeRef.current) drawShape(currentShapeRef.current);
  }, []);

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e) => {
    const canDraw = (viewMode === 'analysis' || isTimeShifting) && drawingTool !== 'none';
    if (!canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.cancelable) e.preventDefault();
    const p = getCanvasCoords(e);
    currentShapeRef.current = { type: drawingTool, points: [p], start: p, end: p, color: drawingColor };
    renderCanvas();
  };

  const draw = (e) => {
    if (!currentShapeRef.current) return;
    if (e.cancelable) e.preventDefault();
    const p = getCanvasCoords(e);
    if (drawingTool === 'free') currentShapeRef.current.points.push(p);
    else currentShapeRef.current.end = p;
    renderCanvas();
  };

  const stopDrawing = (e) => {
    if (!currentShapeRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const newShapes = [...shapesRef.current, currentShapeRef.current];
    shapesRef.current = newShapes;
    setShapes(newShapes);
    currentShapeRef.current = null;
    renderCanvas();
  };

  const undoLastShape = () => {
    const newShapes = shapesRef.current.slice(0, -1);
    shapesRef.current = newShapes;
    setShapes(newShapes);
    renderCanvas();
  };

  const clearShapes = () => { shapesRef.current = []; setShapes([]); currentShapeRef.current = null; renderCanvas(); };

  useEffect(() => { shapesRef.current = shapes; renderCanvas(); }, [shapes, renderCanvas]);
  useEffect(() => { const h = () => setIsPortrait(window.innerHeight > window.innerWidth); window.addEventListener('resize', h); h(); return () => window.removeEventListener('resize', h); }, []);
  useEffect(() => { const t = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=h264', 'video/webm']; let b = ''; for (const x of t) if (MediaRecorder.isTypeSupported(x)) { b = x; break; } setSupportedMimeType(b || ''); }, []);

  useEffect(() => {
    const getDevices = async () => {
      try { const d = await navigator.mediaDevices.enumerateDevices(); setVideoDevices(d.filter(x => x.kind === 'videoinput')); if (!selectedDeviceId) { const b = d.find(x => x.label.toLowerCase().includes('back')); setSelectedDeviceId(b ? b.deviceId : d[0].deviceId); } } catch (e) { }
    }; getDevices();
  }, []);

  useEffect(() => { if (viewMode === 'live' && selectedDeviceId) startCameraStream(selectedDeviceId); }, [selectedDeviceId, viewMode]);

  // UI Composants
  const Toolbar = () => (
    <div className="flex items-center gap-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 shadow-2xl">
      <div className="flex gap-2 border-r border-white/10 pr-2">
        <button onClick={() => selectTool('none')} className={`p-2 rounded-full transition-all ${drawingTool === 'none' ? 'bg-white text-black' : 'text-slate-400 hover:bg-white/10'}`}><Hand size={20} /></button>
        <button onClick={() => selectTool('free')} className={`p-2 rounded-full transition-all ${drawingTool === 'free' ? 'bg-white text-black' : 'text-slate-400 hover:bg-white/10'}`}><PenTool size={20} /></button>
        <button onClick={() => selectTool('arrow')} className={`p-2 rounded-full transition-all ${drawingTool === 'arrow' ? 'bg-white text-black' : 'text-slate-400 hover:bg-white/10'}`}><ArrowRight size={20} /></button>
        <button onClick={() => selectTool('circle')} className={`p-2 rounded-full transition-all ${drawingTool === 'circle' ? 'bg-white text-black' : 'text-slate-400 hover:bg-white/10'}`}><CircleIcon size={20} /></button>
        <button onClick={() => selectTool('cross')} className={`p-2 rounded-full transition-all ${drawingTool === 'cross' ? 'bg-white text-black' : 'text-slate-400 hover:bg-white/10'}`}><X size={20} /></button>
      </div>
      <div className="flex items-center gap-2">
        {['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#000000', '#ffffff'].map(c => (
          <button key={c} onClick={() => setDrawingColor(c)} className={`w-6 h-6 rounded-full border-2 transition-transform ${drawingColor === c ? 'border-white scale-125' : 'border-transparent opacity-50'}`} style={{ backgroundColor: c }} />
        ))}
        <label className="relative flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-500 border-2 border-white/20 cursor-pointer hover:scale-110 transition-transform"><input type="color" className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" onChange={(e) => setDrawingColor(e.target.value)} /></label>
      </div>
      <div className="flex gap-2 border-l border-white/10 pl-2">
        <button onClick={undoLastShape} className="p-2 rounded-full hover:bg-white/10 text-slate-300 transition-colors"><Undo size={20} /></button>
        <button onClick={clearShapes} className="p-2 rounded-full hover:bg-white/10 text-slate-300 transition-colors"><Eraser size={20} /></button>
        {viewMode === 'analysis' && <button onClick={() => setViewMode('gallery')} className="p-2 rounded-full bg-white/10 hover:bg-red-500/80 text-white transition-colors ml-2"><X size={20} /></button>}
      </div>
    </div>
  );

  // --- RENDER ---
  return (
    <div className="flex flex-col h-[100dvh] bg-[#000000] text-white font-sans overflow-hidden overscroll-none touch-none selection:bg-blue-500/30">
      <input type="file" accept="video/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {isPortrait && viewMode !== 'home' && <div className="absolute inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center text-center p-8 backdrop-blur-sm pointer-events-none"><RotateCcw size={48} className="text-yellow-500 mb-4 animate-spin-slow" /><h2 className="text-xl font-bold mb-2">Pivotez votre appareil</h2></div>}

      {viewMode === 'home' && (
        <div className="relative flex flex-col items-center justify-center h-full p-6 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none"></div>
          <div className="z-10 text-center space-y-2 mb-10"><div className="bg-gradient-to-br from-blue-600 to-indigo-600 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-blue-900/40 border border-white/10"><Camera size={48} className="text-white drop-shadow-md" /></div><h1 className="text-5xl font-bold text-white tracking-tight drop-shadow-sm">CoachReplay</h1><p className="text-slate-400 text-lg font-medium">L'analyse vidéo réinventée</p></div>
          <div className="z-10 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl px-4">
            <button onClick={() => enterLiveMode(false)} className="bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 flex flex-col items-start gap-4 transition-all hover:scale-[1.02] group text-left"><div className="bg-blue-500/20 p-4 rounded-2xl"><Eye size={32} className="text-blue-400" /></div><div><h3 className="text-2xl font-bold text-white mb-1">Mode Live</h3><p className="text-slate-400 text-sm">Timeshift & Replay (Tampon 3min).</p></div></button>
            <button onClick={() => enterLiveMode(true)} className="bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 flex flex-col items-start gap-4 transition-all hover:scale-[1.02] group text-left"><div className="bg-red-500/20 p-4 rounded-2xl"><HardDrive size={32} className="text-red-400" /></div><div><h3 className="text-2xl font-bold text-white mb-1">Mode Enregistrement</h3><p className="text-slate-400 text-sm">Capture continue + Clips.</p></div></button>
            <button onClick={triggerFileInput} className="col-span-1 md:col-span-2 bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 flex flex-row items-center gap-6 transition-all hover:scale-[1.01] group text-left"><div className="bg-purple-500/20 p-4 rounded-2xl"><Upload size={32} className="text-purple-400" /></div><div><h3 className="text-xl font-bold text-white mb-1">Importer</h3><p className="text-slate-400 text-sm">Depuis la galerie.</p></div><ArrowRight className="ml-auto text-slate-500" /></button>
          </div>
          <p className="absolute bottom-8 text-xs text-slate-600 font-medium tracking-wider uppercase">v3.5.0 (Circle Fix)</p>
        </div>
      )}

      {/* --- TRIMMING VIEW (Séquenceur) --- */}
      {viewMode === 'trimming' && (
        <div className="flex-1 relative bg-black flex flex-col h-full items-center justify-center">
          <div className="absolute top-4 left-4 z-50"><button onClick={() => setViewMode('live')} className="bg-black/50 p-2 rounded-full text-white"><X /></button></div>
          <div className="w-full max-w-4xl aspect-video bg-gray-900 relative rounded-lg overflow-hidden border border-slate-700">
            <video
              ref={trimmingVideoRef}
              src={timeShiftUrl}
              className="w-full h-full object-contain"
              controls
              onLoadedMetadata={(e) => setTrimDuration(e.target.duration)}
              onTimeUpdate={(e) => {
                const t = e.target.currentTime;
                const d = e.target.duration;
                const start = (trimRange[0] / 100) * d;
                const end = (trimRange[1] / 100) * d;
                if (t < start || t > end) e.target.currentTime = start;
              }}
            />
          </div>

          <div className="w-full max-w-4xl mt-6 px-4">
            <div className="flex justify-between text-xs text-slate-400 mb-2 font-mono">
              <span>Début: {formatTime((trimRange[0] / 100) * trimDuration)}</span>
              <span>Durée: {formatTime(((trimRange[1] - trimRange[0]) / 100) * trimDuration)}</span>
              <span>Fin: {formatTime((trimRange[1] / 100) * trimDuration)}</span>
            </div>
            <div className="relative h-12 bg-slate-800 rounded-lg flex items-center px-2">
              <input
                type="range" min="0" max="100" value={trimRange[0]}
                onChange={(e) => { const v = parseFloat(e.target.value); if (v < trimRange[1] - 5) setTrimRange([v, trimRange[1]]) }}
                className="absolute inset-0 w-full z-20 opacity-0 cursor-pointer"
              />
              <input
                type="range" min="0" max="100" value={trimRange[1]}
                onChange={(e) => { const v = parseFloat(e.target.value); if (v > trimRange[0] + 5) setTrimRange([trimRange[0], v]) }}
                className="absolute inset-0 w-full z-20 opacity-0 cursor-pointer"
              />
              <div className="absolute top-2 bottom-2 left-0 right-0 pointer-events-none">
                <div className="h-full bg-blue-600/30 rounded" style={{ left: `${trimRange[0]}%`, right: `${100 - trimRange[1]}%`, position: 'absolute' }}></div>
                <div className="h-full w-1 bg-white absolute" style={{ left: `${trimRange[0]}%` }}></div>
                <div className="h-full w-1 bg-white absolute" style={{ left: `${trimRange[1]}%` }}></div>
              </div>
            </div>
            <button onClick={saveTrimmedClip} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2">
              <Scissors size={20} /> COUPER & SAUVEGARDER
            </button>
          </div>
        </div>
      )}

      {viewMode === 'live' && (
        <div className="flex-1 relative bg-black flex flex-col h-full">
          <div className="absolute top-4 left-0 right-0 z-50 flex justify-between items-start px-6 pointer-events-none">
            <div className="flex gap-2 pointer-events-auto">
              <button onClick={goHome} className="bg-black/40 backdrop-blur-md border border-white/10 w-10 h-10 rounded-full flex items-center justify-center text-white"><Home size={18} /></button>
              {!isTimeShifting ? (
                <div className="bg-red-500/90 backdrop-blur-md text-white px-3 h-10 rounded-full text-xs font-bold tracking-wider shadow-lg animate-pulse flex items-center gap-2"><div className="w-2 h-2 bg-white rounded-full"></div> EN DIRECT</div>
              ) : (
                <div className="bg-yellow-500/90 backdrop-blur-md text-black px-3 h-10 rounded-full text-xs font-bold tracking-wider shadow-lg flex items-center gap-2"><Pause size={12} fill="black" /> DIFFÉRÉ</div>
              )}
            </div>
            <div className="flex gap-2 pointer-events-auto">
              <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-1 py-1 flex items-center">
                <button onClick={rotateVideo} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-slate-200"><RotateCw size={16} /></button>
                <div className="w-px h-4 bg-white/10 mx-1"></div>
                <div className="relative w-8 h-8 flex items-center justify-center">
                  <Camera size={16} className="text-slate-200" />
                  <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer">{videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select>
                </div>
              </div>
            </div>
          </div>

          <div className={`relative flex-1 bg-black overflow-hidden flex items-center justify-center`} ref={containerRef}>
            <video
              ref={liveVideoRef}
              autoPlay
              playsInline
              webkit-playsinline="true"
              disablePictureInPicture
              controlsList="nodownload noplaybackrate"
              muted={!isTimeShifting}
              controls={isTimeShifting}
              onPlay={() => { if (isTimeShifting) setIsPlayingClip(true); }}
              onPause={() => { if (isTimeShifting) setIsPlayingClip(false); }}
              className="w-full h-full object-contain transition-transform duration-300"
              style={{ transform: `rotate(${videoRotation}deg)` }}
            />
            {isTimeShifting && <canvas ref={canvasRef} style={{ touchAction: 'none', position: 'absolute', ...canvasStyle }} className={`z-10 ${isPlayingClip || drawingTool === 'none' ? 'pointer-events-none' : 'cursor-crosshair'}`} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerLeave={stopDrawing} />}
            {errorMsg && <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-red-500/90 backdrop-blur-md text-white px-6 py-3 rounded-2xl text-sm flex items-center gap-3 z-50"><AlertTriangle size={18} /> {errorMsg}</div>}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/10 backdrop-blur-xl border border-white/20 text-white px-8 py-6 rounded-3xl font-bold text-xl text-center shadow-2xl transition-all duration-300 transform ${showFeedbackAnim ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}`}><div className="bg-green-500 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"><Check size={24} /></div>{feedbackMessage || "Action effectuée"}</div>
          </div>

          <div className="absolute bottom-8 left-4 right-4 z-40 flex justify-center pointer-events-none">
            <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-3 shadow-2xl flex items-center gap-6 pointer-events-auto max-w-3xl w-full justify-between">
              <div className="flex items-center gap-2">
                {!isTimeShifting ? (
                  <button onClick={() => handleTimeShift(-10)} className="group flex flex-col items-center justify-center w-14 h-14 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5"><RotateCcw size={20} className="text-yellow-400 group-hover:-rotate-45 transition-transform" /><span className="text-[10px] mt-1 font-medium text-slate-300">Replay</span></button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => handleTimeShift(-5)} className="w-10 h-14 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"><Rewind size={18} /></button>
                    <button onClick={() => handleTimeShift(5)} className="w-10 h-14 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"><FastForward size={18} /></button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                {!isTimeShifting ? (
                  <>
                    <button onClick={() => createClip(10)} className="flex flex-col items-center gap-1 active:scale-95 transition-transform text-slate-400 hover:text-white"><div className="w-10 h-10 rounded-full border border-slate-600 flex items-center justify-center bg-transparent"><span className="text-[10px] font-bold">-10s</span></div></button>
                    <div className="relative">
                      {isRecording && <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-mono px-3 py-1 rounded-full shadow-lg animate-pulse">{formatTime(recordingTime)}</div>}
                      <button onClick={toggleRecording} className={`w-16 h-16 rounded-full flex items-center justify-center border-[3px] shadow-lg active:scale-95 transition-all ${isRecording ? 'border-red-500 bg-red-500/20' : 'border-white bg-white/10 hover:bg-white/20'}`}><div className={`transition-all duration-300 ${isRecording ? 'w-6 h-6 bg-red-500 rounded-sm' : 'w-12 h-12 bg-red-600 rounded-full border-2 border-transparent'}`} /></button>
                    </div>
                    <button onClick={() => createClip(20)} className="flex flex-col items-center gap-1 active:scale-95 transition-transform text-slate-400 hover:text-white"><div className="w-10 h-10 rounded-full border border-slate-600 flex items-center justify-center bg-transparent"><span className="text-[10px] font-bold">-20s</span></div></button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 w-full">
                    <Toolbar />
                    <button onClick={goBackToLive} className="px-6 py-2 bg-red-600 rounded-full text-white font-bold text-xs shadow-lg shadow-red-600/30 hover:bg-red-500 transition-all flex items-center gap-2"><Radio size={12} className="animate-pulse" /> RETOUR DIRECT</button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 justify-end">
                {isTimeShifting && (
                  <button onClick={enterTrimmingMode} className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-lg active:scale-95"><Scissors size={20} /><span className="text-[9px] mt-1 font-medium">Couper</span></button>
                )}
                <button onClick={() => setViewMode('gallery')} className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 relative text-slate-300 hover:text-white"><Library size={20} /><span className="text-[9px] mt-1 font-medium">Clips</span>{clips.length > 0 && <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[9px] font-bold w-5 h-5 flex items-center justify-center rounded-full border border-black">{clips.length}</span>}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- GALLERY VIEW --- */}
      {viewMode === 'gallery' && (
        <div className="flex-1 bg-[#0a0a0a] flex flex-col overflow-hidden">
          <div className="h-20 flex items-center px-6 shrink-0 bg-black/50 backdrop-blur-md border-b border-white/5 justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setViewMode(sessionType === 'free' || isRecording ? 'live' : 'home')} className="p-3 bg-white/5 rounded-full text-white hover:bg-white/10 transition-colors"><ChevronLeft /></button>
              <h2 className="text-2xl font-bold text-white tracking-tight">Bibliothèque</h2>
            </div>
            <div className="text-slate-500 font-mono text-xs">{clips.length} Clips</div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {clips.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-600"><div className="bg-white/5 p-6 rounded-full mb-4"><Video size={48} className="opacity-50" /></div><p>Aucun clip enregistré.</p></div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pb-20">
                {clips.map((clip, idx) => (
                  <div key={clip.id} onClick={() => openClip(clip)} className="bg-white/5 rounded-3xl overflow-hidden border border-white/5 hover:border-white/20 transition-all hover:scale-[1.02] cursor-pointer group relative shadow-xl">
                    <div className="aspect-video bg-black relative">
                      <video src={clip.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" playsInline muted preload="metadata" onLoadedMetadata={(e) => { e.target.currentTime = 0.1 }} />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 backdrop-blur-sm"><Play size={32} className="text-white fill-white" /></div>
                      <span className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md border border-white/10 px-2 py-0.5 text-xs rounded-lg font-mono">{clip.duration === 'Import' ? 'Imp.' : clip.duration === 0 ? 'Img' : `-${clip.duration}s`}</span>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                      <div><p className="font-bold text-sm text-white">Clip #{clips.length - idx}</p><p className="text-xs text-slate-500">{clip.timeString}</p></div>
                      <button onClick={(e) => downloadClip(e, clip)} className="p-2 bg-white/5 rounded-full hover:bg-white/10 text-white transition-colors"><Download size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- ANALYSIS VIEW --- */}
      {viewMode === 'analysis' && activeClip && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col">
          <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black" ref={containerRef}>
            {playbackError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-20 p-6 text-center"><AlertTriangle size={48} className="text-yellow-500 mb-4" /><h3 className="text-lg font-bold mb-2">Format illisible</h3><button onClick={() => downloadClip(null, activeClip)} className="flex items-center gap-2 bg-blue-600 px-6 py-3 rounded-lg font-bold text-white shadow-lg"><Download size={20} /> Télécharger</button></div>
            ) : (
              <video
                ref={analysisVideoRef}
                src={activeClip.url}
                className="absolute inset-0 w-full h-full object-contain"
                playsInline
                webkit-playsinline="true"
                loop
                autoPlay
                muted={false}
                controls
                onPlay={() => setIsPlayingClip(true)}
                onPause={() => setIsPlayingClip(false)}
                onError={(e) => { console.error("Erreur lecture:", e); setPlaybackError(true); }}
              />
            )}
            <canvas
              ref={canvasRef}
              style={{ touchAction: 'none', position: 'absolute', ...canvasStyle }}
              className={`z-10 ${isPlayingClip || drawingTool === 'none' ? 'pointer-events-none' : 'cursor-crosshair'}`}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
            />
          </div>

          <div className="bg-black/80 backdrop-blur-xl border-t border-white/10 p-4 safe-area-pb absolute bottom-0 w-full">
            <div className="flex justify-center mb-4">
              <Toolbar />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;