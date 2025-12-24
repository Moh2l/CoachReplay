import React, { useState, useRef, useEffect } from 'react';
import {
  Camera, Disc, PenTool, Play, Pause, ChevronLeft,
  Eraser, Library, Circle as CircleIcon, ArrowRight, Minus,
  Video, Hand, Info, Upload, Download, AlertTriangle,
  RotateCcw, FastForward, Rewind, SkipBack, Radio, Home, HardDrive, Eye, X, Undo
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
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const [isTimeShifting, setIsTimeShifting] = useState(false);
  const [timeShiftUrl, setTimeShiftUrl] = useState(null);

  const [clips, setClips] = useState([]);
  const [activeClip, setActiveClip] = useState(null);

  const [isPlayingClip, setIsPlayingClip] = useState(true);
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
  const mediaHeaderRef = useRef(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [recordingTime, setRecordingTime] = useState(0);

  // Configuration
  const BUFFER_DURATION_MS = 120000;
  const CHUNK_INTERVAL_MS = 1000;

  // --- FONCTIONS LOGIQUES ---

  const showFeedback = (msg, isError = false) => {
    setFeedbackMessage(msg);
    const id = isError ? 'clip-feedback-error' : 'clip-feedback';
    const btn = document.getElementById(id);
    if (btn) {
      btn.style.opacity = 1;
      setTimeout(() => {
        btn.style.opacity = 0;
        setFeedbackMessage('');
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

      chunksBufferRef.current = [];
      mediaHeaderRef.current = null;

      const options = { mimeType: mimeType };
      const recorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) {
          // Capture du Header (premier morceau vital)
          if (!mediaHeaderRef.current) {
            mediaHeaderRef.current = e.data;
          }

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
    if (mediaHeaderRef.current) {
      fullSessionChunksRef.current.push(mediaHeaderRef.current);
    }
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
    if (chunksBufferRef.current.length === 0) {
      showFeedback("Tampon vide !", true);
      return;
    }

    const now = Date.now();
    const safetyBuffer = 3000;
    const startTime = now - (secondsBack * 1000) - safetyBuffer;

    let relevantChunks = chunksBufferRef.current
      .filter(chunk => chunk.timestamp >= startTime)
      .map(c => c.data);

    if (relevantChunks.length === 0) {
      relevantChunks = chunksBufferRef.current.map(c => c.data);
    }

    // Injection du Header manquant
    if (mediaHeaderRef.current && relevantChunks.length > 0) {
      if (relevantChunks[0] !== mediaHeaderRef.current) {
        relevantChunks = [mediaHeaderRef.current, ...relevantChunks];
      }
    }

    if (relevantChunks.length === 0) {
      showFeedback("Erreur données", true);
      return;
    }

    try {
      const blob = new Blob(relevantChunks, { type: supportedMimeType });

      if (blob.size === 0) {
        showFeedback("Erreur: Vide", true);
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
      showFeedback("Pas de retour possible", true);
      return;
    }
    let blobUrl = timeShiftUrl;

    if (!isTimeShifting) {
      try {
        let chunks = chunksBufferRef.current.map(c => c.data);
        if (mediaHeaderRef.current && chunks.length > 0 && chunks[0] !== mediaHeaderRef.current) {
          chunks = [mediaHeaderRef.current, ...chunks];
        }

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
    // La mise à jour du temps est gérée nativement par le lecteur
  };

  // Dessin : Outils et Coordonnées Précises
  const selectTool = (tool) => {
    setDrawingTool(tool);
    if (tool !== 'none') {
      if (analysisVideoRef.current) analysisVideoRef.current.pause();
      setIsPlayingClip(false);
    }
  };

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    // Coordonnées de l'événement (Touch ou Mouse)
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;

    // Calcul du facteur d'échelle
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
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

    // Vérif souris (clic gauche)
    if (!e.touches && e.buttons !== 1) return;

    const p = getCanvasCoords(e);

    if (drawingTool === 'free') {
      setCurrentShape(prev => ({ ...prev, points: [...prev.points, p] }));
    } else {
      setCurrentShape(prev => ({ ...prev, end: p }));
    }
  };

  const stopDrawing = () => {
    if (currentShape) setShapes(prev => [...prev, currentShape]);
    setCurrentShape(null);
  };

  // Fonction Undo
  const undoLastShape = () => {
    setShapes(prev => prev.slice(0, -1));
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

  // Gestion du redimensionnement du Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container || viewMode !== 'analysis') return;

    const updateCanvasSize = () => {
      // On aligne la résolution interne du canvas sur sa taille d'affichage exacte
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    // Initial size
    updateCanvasSize();

    // Observer pour les changements de taille (rotation iPad)
    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });

    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [viewMode]);

  // Boucle de rendu du dessin
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewMode !== 'analysis') return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const render = (s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.beginPath();
      if (s.type === 'free') {
        if (s.points.length < 2) return;
        ctx.moveTo(s.points[0].x, s.points[0].y);
        s.points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }
      else if (s.type === 'circle') {
        const r = Math.sqrt(Math.pow(s.end.x - s.start.x, 2) + Math.pow(s.end.y - s.start.y, 2));
        ctx.arc(s.start.x, s.start.y, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
      else if (s.type === 'line') {
        ctx.moveTo(s.start.x, s.start.y);
        ctx.lineTo(s.end.x, s.end.y);
        ctx.stroke();
      }
      else if (s.type === 'arrow') {
        const a = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x);
        const headlen = 20; // Taille de la pointe
        ctx.moveTo(s.start.x, s.start.y);
        ctx.lineTo(s.end.x, s.end.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.end.x, s.end.y);
        ctx.lineTo(s.end.x - headlen * Math.cos(a - Math.PI / 6), s.end.y - headlen * Math.sin(a - Math.PI / 6));
        ctx.moveTo(s.end.x, s.end.y);
        ctx.lineTo(s.end.x - headlen * Math.cos(a + Math.PI / 6), s.end.y - headlen * Math.sin(a + Math.PI / 6));
        ctx.stroke();
      }
    };

    shapes.forEach(render);
    if (currentShape) render(currentShape);

  }, [shapes, currentShape, viewMode, canvasRef.current?.width, canvasRef.current?.height]);

  // --- RENDER ---
  return (
    // Utilisation de 100dvh pour le plein écran dynamique sur mobile
    <div className="flex flex-col h-[100dvh] bg-black text-white font-sans overflow-hidden">
      <input type="file" accept="video/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* VIEW: HOME */}
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
              <div className="text-left"><h3 className="font-bold text-lg">Mode Live</h3><p className="text-xs text-slate-400">Timeshift & Clips (Tampon 2min)</p></div>
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
          <p className="absolute bottom-6 text-xs text-slate-600 font-mono">v2.5.0 (iOS Optimized)</p>
        </div>
      )}

      {/* VIEW: LIVE & REC */}
      {viewMode === 'live' && (
        <div className="flex-1 relative bg-black flex flex-col h-full">

          {/* ZONE VIDEO */}
          <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">
            <video
              ref={liveVideoRef}
              autoPlay
              playsInline
              webkit-playsinline="true"
              disablePictureInPicture
              controlsList="nodownload noplaybackrate"
              muted
              controls={isTimeShifting}
              className="w-full h-full object-contain"
            />

            {isTimeShifting && <div className="absolute top-4 bg-yellow-500/90 text-black px-4 py-1.5 rounded-full text-sm font-bold z-30 animate-pulse flex items-center gap-2 shadow-lg"><RotateCcw size={16} /> MODE DIFFÉRÉ</div>}
            {errorMsg && <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-red-600/90 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 z-50"><AlertTriangle size={16} /> {errorMsg}</div>}

            <div id="clip-feedback" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/90 text-black px-6 py-4 rounded-2xl font-bold text-xl opacity-0 transition-opacity pointer-events-none z-50 text-center shadow-2xl scale-110">
              {feedbackMessage || "Clip Sauvegardé !"}
            </div>
            <div id="clip-feedback-error" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-600/90 text-white px-6 py-4 rounded-2xl font-bold text-xl opacity-0 transition-opacity pointer-events-none z-50 text-center shadow-2xl">
              {feedbackMessage || "Erreur !"}
            </div>
          </div>

          {/* BARRE DE CONTROLE UNIFIEE (DOCK) */}
          <div className="bg-slate-900 border-t border-slate-800 p-4 safe-area-pb z-40">
            <div className="max-w-4xl mx-auto flex items-center justify-between">

              {/* GAUCHE : Navigation & Caméra */}
              <div className="flex items-center gap-3 w-1/3">
                <button onClick={goHome} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                  <Home size={20} />
                  <span className="text-[9px] mt-1 font-medium">Accueil</span>
                </button>

                <div className="relative group">
                  <div className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-blue-400 hover:bg-slate-700 transition-colors cursor-pointer overflow-hidden">
                    <Camera size={20} />
                    <span className="text-[9px] mt-1 font-medium">Caméra</span>
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => setSelectedDeviceId(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    >
                      {videoDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Caméra ${device.deviceId.slice(0, 5)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* CENTRE : Contrôles Principaux */}
              <div className="flex items-center justify-center gap-4 w-1/3 shrink-0">
                {!isTimeShifting ? (
                  <>
                    <button onClick={() => createClip(10)} className="flex flex-col items-center gap-1 active:scale-95 transition-transform text-slate-300 hover:text-white">
                      <div className="w-10 h-10 rounded-full border border-slate-600 flex items-center justify-center bg-slate-800">
                        <span className="text-[10px] font-bold">-10s</span>
                      </div>
                    </button>

                    <div className="relative">
                      {isRecording && <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-red-600/90 text-white text-[10px] font-mono px-2 py-0.5 rounded-full animate-pulse">{formatTime(recordingTime)}</div>}
                      <button
                        onClick={toggleRecording}
                        className={`w-16 h-16 rounded-full flex items-center justify-center border-4 shadow-lg active:scale-95 transition-all ${isRecording ? 'border-red-500 bg-red-600 text-white' : 'border-white bg-slate-200 text-slate-900 hover:bg-white'}`}
                      >
                        {isRecording ? <div className="w-6 h-6 bg-white rounded-sm" /> : <div className="w-6 h-6 bg-red-600 rounded-full" />}
                      </button>
                    </div>

                    <button onClick={() => createClip(20)} className="flex flex-col items-center gap-1 active:scale-95 transition-transform text-slate-300 hover:text-white">
                      <div className="w-10 h-10 rounded-full border border-slate-600 flex items-center justify-center bg-slate-800">
                        <span className="text-[10px] font-bold">-20s</span>
                      </div>
                    </button>
                  </>
                ) : (
                  // Contrôles Timeshift
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleTimeShift(-5)} className="p-2 bg-slate-800 rounded-full text-white hover:bg-slate-700"><Rewind size={20} /></button>
                    <button onClick={goBackToLive} className="px-4 py-2 bg-red-600 rounded-full text-white font-bold text-xs shadow-lg animate-pulse hover:bg-red-500">DIRECT</button>
                    <button onClick={() => handleTimeShift(5)} className="p-2 bg-slate-800 rounded-full text-white hover:bg-slate-700"><FastForward size={20} /></button>
                  </div>
                )}
              </div>

              {/* DROITE : Galerie & Outils */}
              <div className="flex items-center justify-end gap-3 w-1/3">
                {!isTimeShifting && (
                  <button onClick={() => handleTimeShift(-10)} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-yellow-500 hover:bg-slate-700 transition-colors">
                    <RotateCcw size={20} />
                    <span className="text-[9px] mt-1 font-medium">Replay</span>
                  </button>
                )}

                <button onClick={() => setViewMode('gallery')} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors relative">
                  <Library size={20} />
                  <span className="text-[9px] mt-1 font-medium">Clips</span>
                  {clips.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{clips.length}</span>}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* VIEW: GALERIE */}
      {viewMode === 'gallery' && (
        <div className="flex-1 bg-slate-900 flex flex-col overflow-hidden">
          <div className="h-16 bg-slate-800 flex items-center px-4 shadow-md shrink-0">
            <button onClick={() => setViewMode(sessionType === 'free' || isRecording ? 'live' : 'home')} className="p-2 bg-slate-700 rounded-full text-white mr-4"><ChevronLeft /></button>
            <h2 className="text-lg font-bold text-white">Bibliothèque ({clips.length})</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {clips.length === 0 ? <div className="text-center text-slate-500 mt-20">Aucun clip enregistré.</div> : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pb-20">
                {clips.map((clip, idx) => (
                  <div key={clip.id} onClick={() => openClip(clip)} className="bg-slate-800 rounded-lg p-2 cursor-pointer border border-slate-700 relative group">
                    <div className="aspect-video bg-black rounded flex items-center justify-center mb-2 relative overflow-hidden">
                      <video src={clip.url} className="w-full h-full object-cover opacity-60" playsInline muted preload="metadata" onLoadedMetadata={(e) => { e.target.currentTime = 0.1 }} />
                      <div className="absolute inset-0 flex items-center justify-center"><Play size={32} className="text-white" /></div>
                      <span className="absolute bottom-1 right-1 bg-black/70 px-1 text-xs rounded">{clip.duration === 'Import' ? 'Imp.' : `-${clip.duration}s`}</span>
                    </div>
                    <div className="flex justify-between px-1"><span className="text-sm font-bold">Clip #{clips.length - idx}</span><span className="text-xs text-slate-400">{clip.timeString}</span></div>
                    <button onClick={(e) => downloadClip(e, clip)} className="absolute top-3 right-3 p-1.5 bg-slate-900/80 rounded text-white z-10"><Download size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW: ANALYSE */}
      {viewMode === 'analysis' && activeClip && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col">
          <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black" ref={containerRef}>
            {playbackError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-20 p-6 text-center">
                <AlertTriangle size={48} className="text-yellow-500 mb-4" /><h3 className="text-lg font-bold mb-2">Format illisible</h3>
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
                controls // LECTEUR NATIF ACTIF
                onPlay={() => setIsPlayingClip(true)}
                onPause={() => setIsPlayingClip(false)}
                onTimeUpdate={handleVideoTimeUpdate}
                onError={(e) => { console.error("Erreur lecture:", e); setPlaybackError(true); }}
              />
            )}
            <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full z-10 ${isPlayingClip || drawingTool === 'none' ? 'pointer-events-none' : 'cursor-crosshair'}`} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} />
          </div>

          {/* BARRE D'OUTILS ANALYSE SIMPLIFIEE */}
          <div className="bg-slate-900 border-t border-slate-800 p-2 safe-area-pb">
            <div className="flex items-center justify-between gap-4 overflow-x-auto no-scrollbar py-2">
              <div className="flex bg-slate-800 rounded-lg p-1">
                <button onClick={() => selectTool('none')} className={`p-2 rounded ${drawingTool === 'none' ? 'bg-slate-600 text-white' : 'text-slate-400'}`}><Hand size={20} /></button>
                <button onClick={() => selectTool('free')} className={`p-2 rounded ${drawingTool === 'free' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><PenTool size={20} /></button>
                <button onClick={() => selectTool('arrow')} className={`p-2 rounded ${drawingTool === 'arrow' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><ArrowRight size={20} /></button>
                <button onClick={() => selectTool('circle')} className={`p-2 rounded ${drawingTool === 'circle' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><CircleIcon size={20} /></button>
              </div>

              <div className="flex items-center gap-2">
                {/* Couleurs de base + nouvelles */}
                {['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#000000', '#ffffff'].map(c => (
                  <button
                    key={c}
                    onClick={() => setDrawingColor(c)}
                    className={`w-6 h-6 rounded-full border-2 ${drawingColor === c ? 'border-white scale-110' : 'border-transparent opacity-50'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}

                {/* Sélecteur de couleur personnalisé (Arc-en-ciel) */}
                <label className="relative flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500 border-2 border-slate-600 cursor-pointer hover:scale-110 transition-transform ml-1" title="Autre couleur">
                  <input
                    type="color"
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                    onChange={(e) => setDrawingColor(e.target.value)}
                  />
                </label>
              </div>

              <div className="flex gap-2 border-l border-slate-700 pl-2">
                <button onClick={undoLastShape} className="p-2 bg-slate-800 rounded text-slate-300 hover:text-white" title="Annuler"><Undo size={20} /></button>
                <button onClick={() => setShapes([])} className="p-2 bg-slate-800 rounded text-slate-300 hover:text-white" title="Tout effacer"><Eraser size={20} /></button>
                <button onClick={() => setViewMode('gallery')} className="p-2 bg-red-900/50 text-red-400 rounded hover:bg-red-900"><X size={20} /></button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;