import React, { useState, useRef, useEffect } from 'react';
import {
  Camera, Disc, PenTool, Play, Pause, ChevronLeft,
  Eraser, Library, Circle as CircleIcon, ArrowRight, Minus,
  Video, Hand, Info, Upload, Download, AlertTriangle,
  RotateCcw, FastForward, Rewind, SkipBack, Radio, Home, HardDrive, Eye
} from 'lucide-react';

// Helpers externes
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
  const secs = seconds % 60;
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

  // Feedback clips
  const [feedbackMessage, setFeedbackMessage] = useState(''); // Pour gérer différents messages

  const [isTimeShifting, setIsTimeShifting] = useState(false);
  const [timeShiftUrl, setTimeShiftUrl] = useState(null);

  const [clips, setClips] = useState([]);
  const [activeClip, setActiveClip] = useState(null);

  const [isPlayingClip, setIsPlayingClip] = useState(true);
  const [progress, setProgress] = useState(0);
  const [drawingTool, setDrawingTool] = useState('none');
  const [drawingColor, setDrawingColor] = useState('#ef4444');
  const [shapes, setShapes] = useState([]);
  const [currentShape, setCurrentShape] = useState(null);

  // --- RÉFÉRENCES ---
  const liveVideoRef = useRef(null);
  const analysisVideoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksBufferRef = useRef([]);
  const fullSessionChunksRef = useRef([]);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [recordingTime, setRecordingTime] = useState(0);

  // Configuration
  const BUFFER_DURATION_MS = 120000;
  const CHUNK_INTERVAL_MS = 1000;

  // --- FONCTIONS LOGIQUES ---

  // Helper pour afficher feedback
  const showFeedback = (msg, isError = false) => {
    setFeedbackMessage(msg);
    const id = isError ? 'clip-feedback-error' : 'clip-feedback';
    const btn = document.getElementById(id);
    if (btn) {
      btn.style.opacity = 1;
      setTimeout(() => {
        btn.style.opacity = 0;
        setFeedbackMessage(''); // Reset message
      }, 2000);
    }
  };

  // 1. Gestion Enregistrement
  const saveFullSession = () => {
    if (fullSessionChunksRef.current.length === 0) return;
    try {
      const blob = new Blob(fullSessionChunksRef.current, { type: supportedMimeType });
      const ext = supportedMimeType.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `session-camera-${new Date().toISOString()}.${ext}`);
    } catch (e) {
      alert("Erreur lors de la sauvegarde.");
    }
  };

  const startBuffering = (mediaStream, mimeType) => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      const options = { mimeType: mimeType };
      const recorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) {
          const now = Date.now();
          chunksBufferRef.current.push({ data: e.data, timestamp: now });

          const cutoff = now - BUFFER_DURATION_MS;
          if (chunksBufferRef.current.length > 500) {
            chunksBufferRef.current = chunksBufferRef.current.filter(c => c.timestamp > cutoff);
          }

          if (window.isRecordingActive) {
            fullSessionChunksRef.current.push(e.data);
          }
        }
      });

      recorder.start(CHUNK_INTERVAL_MS);
    } catch (e) {
      setErrorMsg(`Erreur Recorder: ${e.message}`);
    }
  };

  const startRecordingProcess = () => {
    fullSessionChunksRef.current = [];
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

  // 2. Gestion Flux & Caméra
  const goBackToLive = () => {
    setIsTimeShifting(false);
    if (timeShiftUrl) {
      URL.revokeObjectURL(timeShiftUrl);
      setTimeShiftUrl(null);
    }
    if (liveVideoRef.current && stream) {
      liveVideoRef.current.src = "";
      liveVideoRef.current.srcObject = stream;
      liveVideoRef.current.muted = true;
      liveVideoRef.current.play().catch(e => console.error("Reprise Live:", e));
    }
  };

  const startCameraStream = async (deviceId) => {
    if (!deviceId) return;

    if (isRecording) {
      if (!confirm("Changer de caméra arrêtera l'enregistrement actuel. Continuer ?")) return;
      stopRecordingProcess();
    }

    goBackToLive();

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    try {
      const constraints = {
        audio: true,
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = mediaStream;
        liveVideoRef.current.muted = true;
      }

      if (supportedMimeType) {
        startBuffering(mediaStream, supportedMimeType);
      } else {
        setErrorMsg("Format non supporté.");
      }
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(`Erreur caméra: ${err.name}`);
    }
  };

  // 3. Navigation & Clips
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

      if (shouldRecord) {
        setTimeout(() => {
          startRecordingProcess();
        }, 1000);
      }
    } catch (e) {
      alert("L'accès à la caméra est nécessaire.");
    }
  };

  const goHome = () => {
    if (isRecording) {
      if (!confirm("Arrêter la session et retourner à l'accueil ?")) return;
      stopRecordingProcess();
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    setViewMode('home');
  };

  const createClip = (secondsBack) => {
    // Si le buffer est totalement vide
    if (chunksBufferRef.current.length === 0) {
      showFeedback("Tampon vide ! Attendez un peu.", true);
      return;
    }

    const now = Date.now();
    const safetyBuffer = 2000;
    const startTime = now - (secondsBack * 1000) - safetyBuffer;

    let relevantChunks = chunksBufferRef.current
      .filter(chunk => chunk.timestamp >= startTime)
      .map(c => c.data);

    // Fallback: Si le filtrage temporel ne donne rien (début de session), on prend tout le buffer
    if (relevantChunks.length === 0) {
      relevantChunks = chunksBufferRef.current.map(c => c.data);
    }

    // Double vérification
    if (relevantChunks.length === 0) {
      showFeedback("Pas assez de vidéo !", true);
      return;
    }

    try {
      const blob = new Blob(relevantChunks, { type: supportedMimeType });

      // Gestion de l'erreur silencieuse: Blob vide
      if (blob.size === 0) {
        showFeedback("Erreur: Clip vide (Bug iOS)", true);
        return;
      }

      const url = URL.createObjectURL(blob);
      const newClip = {
        id: Date.now(),
        url: url,
        duration: secondsBack,
        size: (blob.size / 1024 / 1024).toFixed(2),
        type: 'camera',
        timeString: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        mime: supportedMimeType
      };
      setClips(prev => [newClip, ...prev]);
      showFeedback("Clip Sauvegardé !", false);

    } catch (e) {
      console.error(e);
      showFeedback("Erreur technique", true);
    }
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
    if (chunksBufferRef.current.length === 0) {
      showFeedback("Pas de retour arrière possible", true);
      return;
    }
    let blobUrl = timeShiftUrl;

    if (!isTimeShifting) {
      try {
        const chunks = chunksBufferRef.current.map(c => c.data);
        const blob = new Blob(chunks, { type: supportedMimeType });
        blobUrl = URL.createObjectURL(blob);
        setTimeShiftUrl(blobUrl);
        setIsTimeShifting(true);

        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = null;
          liveVideoRef.current.src = blobUrl;
          liveVideoRef.current.muted = false;
          liveVideoRef.current.load();
        }
      } catch (e) { return; }
    }

    setTimeout(() => {
      if (liveVideoRef.current && Number.isFinite(liveVideoRef.current.duration)) {
        const duration = liveVideoRef.current.duration;
        const baseTime = liveVideoRef.current.currentTime || duration;
        let newTime = baseTime + secondsToJump;
        if (newTime < 0) newTime = 0;
        if (newTime > duration) newTime = duration;
        liveVideoRef.current.currentTime = newTime;
        liveVideoRef.current.play().catch(e => console.log("Play interrupted"));
      }
    }, 100);
  };

  // 4. Player & Drawing Helpers
  const openClip = (clip) => {
    setActiveClip(clip);
    setViewMode('analysis');
    setShapes([]);
    setIsPlayingClip(true);
    setDrawingTool('none');
    setPlaybackError(false);
  };

  const handleVideoTimeUpdate = () => {
    if (analysisVideoRef.current) {
      const pct = (analysisVideoRef.current.currentTime / analysisVideoRef.current.duration) * 100;
      setProgress(isNaN(pct) ? 0 : pct);
    }
  };

  const handleSeek = (e) => {
    if (analysisVideoRef.current && Number.isFinite(analysisVideoRef.current.duration)) {
      analysisVideoRef.current.currentTime = (parseFloat(e.target.value) / 100) * analysisVideoRef.current.duration;
    }
  };

  const togglePlayPause = () => {
    if (analysisVideoRef.current) {
      if (isPlayingClip) {
        analysisVideoRef.current.pause();
      } else {
        analysisVideoRef.current.play();
        setDrawingTool('none');
      }
      setIsPlayingClip(!isPlayingClip);
    }
  };

  // Dessin
  const selectTool = (tool) => {
    setDrawingTool(tool);
    if (tool !== 'none') {
      if (analysisVideoRef.current) analysisVideoRef.current.pause();
      setIsPlayingClip(false);
    }
  };

  const getCanvasCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.touches?.[0]?.clientX ?? e.clientX;
    const cy = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  };

  const startDrawing = (e) => {
    if (isPlayingClip || drawingTool === 'none') return;
    if (e.cancelable) e.preventDefault();
    const p = getCanvasCoords(e);
    setCurrentShape({ type: drawingTool, points: [p], start: p, end: p, color: drawingColor });
  };

  const draw = (e) => {
    if (!currentShape || isPlayingClip || drawingTool === 'none') return;
    if (e.cancelable) e.preventDefault();
    if (!e.touches && e.buttons !== 1) return;
    const p = getCanvasCoords(e);
    if (drawingTool === 'free') setCurrentShape(prev => ({ ...prev, points: [...prev.points, p] }));
    else setCurrentShape(prev => ({ ...prev, end: p }));
  };

  const stopDrawing = () => {
    if (currentShape) setShapes(prev => [...prev, currentShape]);
    setCurrentShape(null);
  };

  // --- EFFETS ---

  useEffect(() => {
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm'];
    let bestType = '';
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) { bestType = type; break; } }
    if (!bestType) bestType = '';
    setSupportedMimeType(bestType);
  }, []);

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(videoInputs);
        if (videoInputs.length > 0 && !selectedDeviceId) {
          const backCamera = videoInputs.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
          setSelectedDeviceId(backCamera ? backCamera.deviceId : videoInputs[0].deviceId);
        }
      } catch (err) { console.error("Info devices:", err); }
    };
    getDevices();
  }, []);

  useEffect(() => {
    if (viewMode === 'live' && selectedDeviceId) {
      startCameraStream(selectedDeviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId, viewMode]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || viewMode !== 'analysis') return;
    canvas.width = containerRef.current?.clientWidth || 800; canvas.height = containerRef.current?.clientHeight || 600;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const render = (s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.beginPath();
      if (s.type === 'free') { if (s.points.length < 2) return; ctx.moveTo(s.points[0].x, s.points[0].y); s.points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); }
      else if (s.type === 'circle') { const r = Math.sqrt(Math.pow(s.end.x - s.start.x, 2) + Math.pow(s.end.y - s.start.y, 2)); ctx.arc(s.start.x, s.start.y, r, 0, 2 * Math.PI); ctx.stroke(); }
      else if (s.type === 'line') { ctx.moveTo(s.start.x, s.start.y); ctx.lineTo(s.end.x, s.end.y); ctx.stroke(); }
      else if (s.type === 'arrow') { const a = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x); ctx.moveTo(s.start.x, s.start.y); ctx.lineTo(s.end.x, s.end.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(s.end.x, s.end.y); ctx.lineTo(s.end.x - 20 * Math.cos(a - Math.PI / 6), s.end.y - 20 * Math.sin(a - Math.PI / 6)); ctx.moveTo(s.end.x, s.end.y); ctx.lineTo(s.end.x - 20 * Math.cos(a + Math.PI / 6), s.end.y - 20 * Math.sin(a + Math.PI / 6)); ctx.stroke(); }
    };
    shapes.forEach(render); if (currentShape) render(currentShape);
  }, [shapes, currentShape, viewMode, containerRef.current?.clientWidth]);

  // --- RENDER ---
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white font-sans overflow-hidden">
      <input type="file" accept="video/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {viewMode === 'home' && (
        <div className="flex flex-col items-center justify-center h-full p-6 space-y-8 bg-slate-900">
          <div className="text-center space-y-2 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-blue-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-900/20"><Camera size={40} className="text-white" /></div>
            <h1 className="text-4xl font-black text-white tracking-tight">CoachReplay</h1>
            <p className="text-slate-400 text-sm font-medium">Analyse vidéo instantanée</p>
          </div>
          <div className="w-full max-w-md space-y-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
            <button onClick={() => enterLiveMode(false)} className="w-full bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-xl flex items-center gap-4 border border-slate-700 group">
              <div className="bg-blue-500/20 p-3 rounded-lg"><Eye size={24} className="text-blue-400" /></div>
              <div className="text-left"><h3 className="font-bold text-lg">Mode Live (Timeshift)</h3><p className="text-xs text-slate-400">Replay immédiat, sans sauvegarde globale.</p></div>
              <ArrowRight className="ml-auto text-slate-500" />
            </button>
            <button onClick={() => enterLiveMode(true)} className="w-full bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-xl flex items-center gap-4 border border-slate-700 group">
              <div className="bg-red-500/20 p-3 rounded-lg"><HardDrive size={24} className="text-red-400" /></div>
              <div className="text-left"><h3 className="font-bold text-lg">Mode Enregistrement</h3><p className="text-xs text-slate-400">Enregistre toute la séance + Clips.</p></div>
              <ArrowRight className="ml-auto text-slate-500" />
            </button>
            <button onClick={triggerFileInput} className="w-full bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-xl flex items-center gap-4 border border-slate-700 group">
              <div className="bg-purple-500/20 p-3 rounded-lg"><Upload size={24} className="text-purple-400" /></div>
              <div className="text-left"><h3 className="font-bold text-lg">Importer une vidéo</h3><p className="text-xs text-slate-400">Analyser un fichier existant.</p></div>
              <ArrowRight className="ml-auto text-slate-500" />
            </button>
          </div>
          <p className="absolute bottom-6 text-xs text-slate-600 font-mono">v1.5.0</p>
        </div>
      )}

      {viewMode !== 'home' && (
        <>
          <div className="h-16 bg-slate-800 flex items-center justify-between px-3 shadow-md z-20 shrink-0 gap-2">
            <div className="flex items-center gap-2 overflow-hidden">
              {viewMode !== 'live' ? (
                <button onClick={() => setViewMode('live')} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 shrink-0"><ChevronLeft size={20} /></button>
              ) : (
                <div className="flex items-center gap-2 max-w-[300px]">
                  <button onClick={goHome} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 shrink-0 mr-2"><Home size={18} /></button>
                  <div className="flex items-center gap-2 bg-slate-900 rounded p-1 border border-slate-600">
                    <div className="bg-blue-600 p-1 rounded shrink-0"><Camera size={14} /></div>
                    <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} className="bg-transparent text-white text-xs py-1 rounded max-w-[120px] truncate focus:outline-none">{videoDevices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || `Cam ${device.deviceId.slice(0, 5)}`}</option>)}</select>
                  </div>
                </div>
              )}
            </div>

            {viewMode === 'live' && (
              <div className={`hidden md:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border ${sessionType === 'rec' ? 'bg-red-900/30 border-red-500/50 text-red-400' : 'bg-blue-900/30 border-blue-500/50 text-blue-400'}`}>
                {sessionType === 'rec' ? <HardDrive size={12} /> : <Eye size={12} />}
                {sessionType === 'rec' ? 'ENREGISTREMENT TOTAL' : 'SESSION LIBRE'}
              </div>
            )}

            <div className="flex items-center gap-3 shrink-0">
              {isRecording && <div className="hidden sm:flex items-center gap-1.5 text-red-500 font-mono text-xs sm:text-sm bg-slate-900/50 px-2 py-1 rounded"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />{formatTime(recordingTime)}</div>}
              {viewMode === 'live' && (
                <button onClick={toggleRecording} className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs sm:text-sm font-bold transition-all ${isRecording ? 'bg-red-600 text-white shadow-lg' : 'bg-white text-slate-900 hover:bg-slate-200'}`}>
                  {isRecording ? <span className="hidden sm:inline">Arrêter</span> : <span>REC</span>}
                  {isRecording ? <Disc size={18} className="animate-spin" /> : <Disc size={18} />}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 relative bg-black overflow-hidden flex flex-col" ref={containerRef}>
            {errorMsg && <div className="absolute top-4 left-4 right-4 z-50 bg-red-600/90 text-white p-2 rounded text-xs text-center flex items-center justify-center gap-2"><AlertTriangle size={16} /> {errorMsg}</div>}

            <div className={`absolute inset-0 flex items-center justify-center ${viewMode === 'live' ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}>
              <video ref={liveVideoRef} autoPlay playsInline muted controls={isTimeShifting} className="w-full h-full object-contain" />
              {isTimeShifting && <div className="absolute top-4 bg-yellow-500/90 text-black px-3 py-1 rounded-full text-xs font-bold z-30 animate-pulse flex items-center gap-2"><RotateCcw size={14} /> DIFFÉRÉ</div>}

              {/* Feedback avec message dynamique */}
              <div id="clip-feedback" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/90 text-black px-6 py-3 rounded-xl font-bold text-xl opacity-0 transition-opacity pointer-events-none z-50 text-center whitespace-nowrap">
                {feedbackMessage || "Clip Sauvegardé !"}
              </div>
              <div id="clip-feedback-error" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-600/90 text-white px-6 py-3 rounded-xl font-bold text-lg opacity-0 transition-opacity pointer-events-none z-50 text-center whitespace-nowrap">
                {feedbackMessage || "Erreur !"}
              </div>

              <div className="absolute bottom-20 left-0 right-0 z-30 flex flex-col items-center gap-4 px-4 pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-4 bg-slate-900/80 p-2 rounded-full backdrop-blur-md border border-slate-700 shadow-xl">
                  {isTimeShifting ? (
                    <button onClick={goBackToLive} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-full text-white text-xs font-bold flex items-center gap-2 animate-in fade-in zoom-in"><Radio size={14} className="animate-pulse" /> DIRECT</button>
                  ) : (
                    <div className="text-[10px] font-bold text-red-500 px-3 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div> LIVE</div>
                  )}
                  <div className="h-6 w-px bg-slate-600 mx-1"></div>
                  <button onClick={() => handleTimeShift(-10)} className="p-2 hover:bg-slate-700 rounded-full text-white flex flex-col items-center"><Rewind size={20} /><span className="text-[9px] font-bold">-10s</span></button>
                  <button onClick={() => handleTimeShift(-5)} className="p-2 hover:bg-slate-700 rounded-full text-white flex flex-col items-center"><SkipBack size={20} /><span className="text-[9px] font-bold">-5s</span></button>
                  <button onClick={() => handleTimeShift(5)} className="p-2 hover:bg-slate-700 rounded-full text-white flex flex-col items-center"><FastForward size={20} /><span className="text-[9px] font-bold">+5s</span></button>
                </div>
                {(isRecording || sessionType === 'free') && !isTimeShifting && (
                  <div className="flex gap-4 pointer-events-auto mt-2">
                    <button onClick={() => createClip(10)} className="w-12 h-12 rounded-full bg-blue-600/90 border border-blue-400 flex items-center justify-center shadow-lg text-white font-bold text-xs hover:scale-105 transition-transform">Save<br />-10s</button>
                    <button onClick={() => createClip(20)} className="w-12 h-12 rounded-full bg-blue-600/90 border border-blue-400 flex items-center justify-center shadow-lg text-white font-bold text-xs hover:scale-105 transition-transform">Save<br />-20s</button>
                  </div>
                )}
              </div>
              <button onClick={() => setViewMode('gallery')} className="absolute bottom-6 left-6 flex items-center gap-2 bg-slate-800/90 hover:bg-slate-700 px-4 py-3 rounded-xl border border-slate-600 shadow-lg transition-colors z-40">
                <div className="relative"><Library size={24} />{clips.length > 0 && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border border-slate-900 shadow-sm">{clips.length}</span>}</div>
                <span className="font-semibold hidden sm:inline">Clips</span>
              </button>
            </div>

            {viewMode === 'gallery' && (
              <div className="absolute inset-0 bg-slate-900 p-4 overflow-y-auto z-20">
                <h2 className="text-xl font-bold mb-4 text-slate-300">Bibliothèque ({clips.length})</h2>
                <div className="mb-4 p-2 bg-slate-800 rounded border border-slate-700 text-[10px] text-slate-400 font-mono flex items-center gap-2"><Info size={12} /> Format: <span className="text-blue-400">{supportedMimeType || "?"}</span></div>
                {clips.length === 0 ? <div className="flex flex-col items-center justify-center h-64 text-slate-500"><Video size={48} className="mb-2 opacity-50" /><p>Aucun clip.</p></div> : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-20">
                    {clips.map((clip, idx) => (
                      <div key={clip.id} onClick={() => openClip(clip)} className="bg-slate-800 rounded-lg p-2 cursor-pointer hover:bg-slate-700 transition-colors border border-slate-700 group relative">
                        <div className="aspect-video bg-black rounded flex items-center justify-center mb-2 relative overflow-hidden border border-slate-900">
                          <video src={clip.url} className="w-full h-full object-cover opacity-60" playsInline muted preload="metadata" onLoadedMetadata={(e) => { e.target.currentTime = 0.1; }} />
                          <div className="absolute inset-0 flex items-center justify-center group-hover:scale-110 transition-transform"><Play size={32} className="text-white fill-white/50" /></div>
                          <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-xs text-white font-mono flex items-center gap-1">{clip.type === 'import' ? <Upload size={10} /> : <Video size={10} />}<span>{clip.duration === 'Import' ? 'Imp.' : `-${clip.duration}s`}</span></div>
                        </div>
                        <button onClick={(e) => downloadClip(e, clip)} className="absolute top-3 right-3 p-1.5 bg-slate-900/80 rounded hover:bg-blue-600 transition-colors text-white z-10" title="Télécharger"><Download size={14} /></button>
                        <div className="flex justify-between items-center px-1"><span className="font-bold text-sm text-slate-200">Clip #{clips.length - idx}</span><span className="text-xs text-slate-400">{clip.timeString}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {viewMode === 'analysis' && activeClip && (
              <div className="absolute inset-0 bg-black z-30 flex flex-col">
                <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden select-none">
                  {playbackError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-20 p-6 text-center">
                      <AlertTriangle size={48} className="text-yellow-500 mb-4" /><h3 className="text-lg font-bold mb-2">Format illisible</h3><p className="text-sm text-slate-400 mb-6">Lecteur intégré incompatible.</p>
                      <button onClick={() => downloadClip(null, activeClip)} className="flex items-center gap-2 bg-blue-600 px-6 py-3 rounded-lg font-bold text-white shadow-lg"><Download size={20} /> Télécharger</button>
                    </div>
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
                      onTimeUpdate={handleVideoTimeUpdate}
                      onError={(e) => { console.error("Erreur lecture:", e); setPlaybackError(true); }}
                    />
                  )}
                  <canvas ref={canvasRef} style={{ touchAction: 'none' }} className={`absolute inset-0 w-full h-full z-10 ${isPlayingClip || drawingTool === 'none' ? 'pointer-events-none' : 'cursor-crosshair'}`} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} />
                </div>
                <div className="bg-slate-900 px-4 py-3 border-t border-slate-800 shrink-0">
                  <div className="flex items-center gap-4">
                    <button onClick={togglePlayPause} className="w-10 h-10 flex items-center justify-center bg-slate-700 rounded-full text-white hover:bg-blue-600 transition-colors">{isPlayingClip ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
                    <input type="range" min="0" max="100" value={progress} onChange={handleSeek} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                  </div>
                </div>
                <div className="bg-slate-800 p-2 safe-area-pb shrink-0 border-t border-slate-700">
                  <div className="flex items-center justify-between gap-4 overflow-x-auto no-scrollbar py-1">
                    <div className="flex bg-slate-700 rounded-lg p-1 shrink-0">
                      <button onClick={() => selectTool('none')} className={`p-2 rounded ${drawingTool === 'none' ? 'bg-slate-500 text-white' : 'text-slate-400'}`} title="Vue"><Hand size={20} /></button>
                      <div className="w-px bg-slate-600 mx-1"></div>
                      <button onClick={() => selectTool('free')} className={`p-2 rounded ${drawingTool === 'free' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><PenTool size={20} /></button>
                      <button onClick={() => selectTool('arrow')} className={`p-2 rounded ${drawingTool === 'arrow' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><ArrowRight size={20} /></button>
                      <button onClick={() => selectTool('circle')} className={`p-2 rounded ${drawingTool === 'circle' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><CircleIcon size={20} /></button>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 px-2 border-l border-r border-slate-600/50">
                      {['#ef4444', '#3b82f6', '#eab308', '#ffffff'].map(c => <button key={c} onClick={() => setDrawingColor(c)} className={`w-8 h-8 rounded-full border-2 transition-transform ${drawingColor === c ? 'border-white scale-110' : 'border-transparent opacity-80'}`} style={{ backgroundColor: c }} />)}
                    </div>
                    <div className="flex gap-2 shrink-0"><button onClick={() => setShapes([])} className="flex items-center gap-1 px-3 py-2 bg-slate-700 rounded text-slate-300 active:bg-slate-600"><Eraser size={16} /><span className="text-xs font-medium">Effacer</span></button></div>
                  </div>
                  {drawingTool !== 'none' && <div className="text-center text-[10px] text-yellow-500 mt-1 uppercase tracking-widest font-bold animate-pulse">{isPlayingClip ? "Mettez en pause pour dessiner" : "Mode Dessin Actif"}</div>}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default App;