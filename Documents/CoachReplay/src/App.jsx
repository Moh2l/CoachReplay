import React, { useState, useRef, useEffect } from 'react';
import {
  Camera, Disc, PenTool, Play, Pause, ChevronLeft,
  Eraser, Library, Circle as CircleIcon, ArrowRight, Minus,
  Video, Hand, Info, Upload, Download, AlertTriangle,
  RotateCcw, FastForward, Rewind, SkipBack, Radio, Home, HardDrive, Eye, X, Undo,
  Smartphone
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
  const [isPortrait, setIsPortrait] = useState(false);

  // Feedback clips
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const [isTimeShifting, setIsTimeShifting] = useState(false);
  const [timeShiftUrl, setTimeShiftUrl] = useState(null);
  // On stocke les chunks du timeshift actuel pour pouvoir couper dedans
  const [timeShiftChunks, setTimeShiftChunks] = useState([]);

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
  const currentStreamIdRef = useRef(null); // Pour éviter le refresh inutile

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

  // 1. Gestion Enregistrement & Buffer
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
    setShapes([]); // Effacer les dessins quand on revient au live
    setDrawingTool('none'); // Désactiver le dessin
    setTimeShiftChunks([]); // Vider le snapshot

    if (timeShiftUrl) {
      URL.revokeObjectURL(timeShiftUrl);
      setTimeShiftUrl(null);
    }
    // Réattacher le flux live si nécessaire
    if (liveVideoRef.current && stream) {
      liveVideoRef.current.src = "";
      liveVideoRef.current.srcObject = stream;
      liveVideoRef.current.muted = true;
      liveVideoRef.current.play().catch(e => console.error("Reprise Live:", e));
    }
  };

  const startCameraStream = async (deviceId) => {
    if (!deviceId) return;

    // FIX REFRESH: Si on a déjà un flux actif sur le bon device, on ne fait rien
    if (stream && stream.active && currentStreamIdRef.current === deviceId) {
      // Juste s'assurer que la vidéo est attachée
      if (liveVideoRef.current && !liveVideoRef.current.srcObject && !isTimeShifting) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.muted = true;
        liveVideoRef.current.play().catch(e => console.log("Play error", e));
      }
      return;
    }

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
          // FIX ORIENTATION: On n'impose pas de ratio strict si ça cause des problèmes sur iPad
          // Mais on préfère le paysage
          // aspectRatio: { ideal: 1.777 }, 
          frameRate: { ideal: 30 }
        }
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      currentStreamIdRef.current = deviceId; // On mémorise l'ID

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
    // On ne coupe pas le flux ici pour garder la fluidité si on revient, 
    // sauf si on veut vraiment économiser la batterie.
    // Pour l'instant on coupe pour être propre.
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
      currentStreamIdRef.current = null;
    }
    setViewMode('home');
  };

  const createClip = (secondsBack) => {
    let sourceChunks = [];

    // NOUVEAU: Si on est en TimeShift, on clip depuis le snapshot actuel
    if (isTimeShifting && timeShiftChunks.length > 0) {
      // Logique simplifiée: on sauve ce qu'on voit (le buffer figé)
      // Pour être précis il faudrait découper selon le currentTime, mais c'est complexe sans réencodage.
      // On va sauvegarder les X dernières secondes du buffer figé par rapport à la position de lecture ?
      // Pour l'instant, on sauvegarde le snapshot complet ou une portion fixe.
      // Mieux : on utilise la logique standard mais sur le tableau figé.
      sourceChunks = timeShiftChunks;
    } else {
      // Live buffer
      sourceChunks = chunksBufferRef.current.map(c => c.data);
    }

    if (sourceChunks.length === 0) {
      showFeedback("Rien à sauvegarder !", true);
      return;
    }

    // Si on demande un temps spécifique (ex: 10s), on essaie de filtrer
    // Note: Difficile sur le snapshot TimeShift sans timestamps précis alignés.
    // On simplifie : on prend les N derniers chunks du tableau source
    const approxChunksCount = (secondsBack * 1000) / CHUNK_INTERVAL_MS + 5; // +5 marge
    let clipChunks = sourceChunks.slice(-approxChunksCount);

    // Injection Header
    if (mediaHeaderRef.current && clipChunks.length > 0) {
      if (clipChunks[0] !== mediaHeaderRef.current) {
        clipChunks = [mediaHeaderRef.current, ...clipChunks];
      }
    }

    try {
      const blob = new Blob(clipChunks, { type: supportedMimeType });
      if (blob.size === 0) {
        showFeedback("Erreur vide", true);
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
        // On fige le buffer actuel
        const currentDataChunks = chunksBufferRef.current.map(c => c.data);

        // On injecte le header
        let finalChunks = [...currentDataChunks];
        if (mediaHeaderRef.current && finalChunks.length > 0 && finalChunks[0] !== mediaHeaderRef.current) {
          finalChunks = [mediaHeaderRef.current, ...finalChunks];
        }

        setTimeShiftChunks(finalChunks); // Sauvegarde pour le clipping/dessin

        const blob = new Blob(finalChunks, { type: supportedMimeType });
        blobUrl = URL.createObjectURL(blob);
        setTimeShiftUrl(blobUrl);
        setIsTimeShifting(true);
        setShapes([]); // Reset dessins

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
        // On ne force pas le play si l'utilisateur a mis pause pour dessiner
        if (!drawingTool || drawingTool === 'none') {
          liveVideoRef.current.play().catch(e => console.log("Play interrupted"));
        }
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

  // Dessin
  const selectTool = (tool) => {
    setDrawingTool(tool);
    if (tool !== 'none') {
      // Si on active un outil, on met pause
      if (liveVideoRef.current && isTimeShifting) liveVideoRef.current.pause();
      if (analysisVideoRef.current && viewMode === 'analysis') analysisVideoRef.current.pause();
      setIsPlayingClip(false);
    }
  };

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e) => {
    // On autorise le dessin si un outil est sélectionné
    // ET (si on est en analyse OU si on est en timeshift)
    const canDraw = (viewMode === 'analysis' || isTimeShifting) && drawingTool !== 'none';

    if (!canDraw) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.cancelable) e.preventDefault();

    const p = getCanvasCoords(e);
    setCurrentShape({ type: drawingTool, points: [p], start: p, end: p, color: drawingColor });
  };

  const draw = (e) => {
    const canDraw = (viewMode === 'analysis' || isTimeShifting) && drawingTool !== 'none';
    if (!canDraw) return;

    if (e.cancelable) e.preventDefault();
    // if (e.buttons !== 1) return; // Parfois problématique sur certains touch devices

    const p = getCanvasCoords(e);

    if (drawingTool === 'free') {
      setCurrentShape(prev => ({ ...prev, points: [...prev.points, p] }));
    } else {
      setCurrentShape(prev => ({ ...prev, end: p }));
    }
  };

  const stopDrawing = (e) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (currentShape) setShapes(prev => [...prev, currentShape]);
    setCurrentShape(null);
  };

  const undoLastShape = () => {
    setShapes(prev => prev.slice(0, -1));
  };

  // --- EFFETS ---

  useEffect(() => {
    // Check orientation
    const checkOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', checkOrientation);
    checkOrientation();
    return () => window.removeEventListener('resize', checkOrientation);
  }, []);

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

  // Canvas Sizing & Anti-Scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    // S'applique en mode analyse OU en mode live (pour le timeshift)
    if (!canvas || !container) return;

    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver(() => updateCanvasSize());
    resizeObserver.observe(container);

    const preventDefault = (e) => { e.preventDefault(); };
    canvas.addEventListener('touchstart', preventDefault, { passive: false });
    canvas.addEventListener('touchmove', preventDefault, { passive: false });
    canvas.addEventListener('touchend', preventDefault, { passive: false });

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('touchstart', preventDefault);
      canvas.removeEventListener('touchmove', preventDefault);
      canvas.removeEventListener('touchend', preventDefault);
    };
  }, [viewMode, isTimeShifting]);

  // Rendu Dessin
  useEffect(() => {
    const canvas = canvasRef.current;
    // On dessine si on est en analyse OU en timeshift
    if (!canvas || (viewMode !== 'analysis' && !isTimeShifting)) return;

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
        const headlen = 20;
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

  }, [shapes, currentShape, viewMode, isTimeShifting, canvasRef.current?.width, canvasRef.current?.height]);

  // --- COMPOSANT BARRE D'OUTILS (DRY) ---
  const Toolbar = () => (
    <div className="flex items-center justify-between gap-4 overflow-x-auto no-scrollbar py-2">
      <div className="flex bg-slate-800 rounded-lg p-1">
        <button onClick={() => selectTool('none')} className={`p-2 rounded ${drawingTool === 'none' ? 'bg-slate-600 text-white' : 'text-slate-400'}`}><Hand size={20} /></button>
        <button onClick={() => selectTool('free')} className={`p-2 rounded ${drawingTool === 'free' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><PenTool size={20} /></button>
        <button onClick={() => selectTool('arrow')} className={`p-2 rounded ${drawingTool === 'arrow' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><ArrowRight size={20} /></button>
        <button onClick={() => selectTool('circle')} className={`p-2 rounded ${drawingTool === 'circle' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><CircleIcon size={20} /></button>
      </div>

      <div className="flex items-center gap-2">
        {['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#000000', '#ffffff'].map(c => (
          <button key={c} onClick={() => setDrawingColor(c)} className={`w-6 h-6 rounded-full border-2 ${drawingColor === c ? 'border-white scale-110' : 'border-transparent opacity-50'}`} style={{ backgroundColor: c }} />
        ))}
        <label className="relative flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500 border-2 border-slate-600 cursor-pointer">
          <input type="color" className="opacity-0 absolute inset-0 w-full h-full" onChange={(e) => setDrawingColor(e.target.value)} />
        </label>
      </div>

      <div className="flex gap-2 border-l border-slate-700 pl-2">
        <button onClick={undoLastShape} className="p-2 bg-slate-800 rounded text-slate-300 hover:text-white"><Undo size={20} /></button>
        <button onClick={() => setShapes([])} className="p-2 bg-slate-800 rounded text-slate-300 hover:text-white"><Eraser size={20} /></button>
        {viewMode === 'analysis' && <button onClick={() => setViewMode('gallery')} className="p-2 bg-red-900/50 text-red-400 rounded hover:bg-red-900"><X size={20} /></button>}
      </div>
    </div>
  );

  // --- RENDER ---
  return (
    <div className="flex flex-col h-[100dvh] bg-black text-white font-sans overflow-hidden overscroll-none touch-none">
      <input type="file" accept="video/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* ALERT PORTRAIT */}
      {isPortrait && (
        <div className="absolute inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center text-center p-8 backdrop-blur-sm">
          <RotateCcw size={48} className="text-yellow-500 mb-4 animate-spin-slow" />
          <h2 className="text-xl font-bold mb-2">Pivotez votre appareil</h2>
          <p className="text-slate-400">Pour une meilleure expérience, utilisez l'application en mode paysage.</p>
        </div>
      )}

      {/* VIEW: HOME */}
      {viewMode === 'home' && (
        <div className="flex flex-col items-center justify-center h-full p-6 space-y-8 bg-slate-900">
          {/* ... (Home content same as before) ... */}
          <div className="text-center space-y-2 mb-8">
            <div className="bg-blue-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-900/20"><Camera size={40} className="text-white" /></div>
            <h1 className="text-4xl font-black text-white tracking-tight">CoachReplay</h1>
            <p className="text-slate-400 text-sm font-medium">Analyse vidéo instantanée</p>
          </div>
          <div className="w-full max-w-md space-y-4">
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
          <p className="absolute bottom-6 text-xs text-slate-600 font-mono">v3.0.0 (Ultimate Fix)</p>
        </div>
      )}

      {/* VIEW: LIVE & REC */}
      {viewMode === 'live' && (
        <div className="flex-1 relative bg-black flex flex-col h-full border-4 border-black box-border">

          {/* Indicateurs Haut */}
          <div className="absolute top-4 left-4 z-50 flex gap-2">
            {!isTimeShifting ? (
              <div className="bg-red-600 px-3 py-1 rounded-md text-xs font-black tracking-widest shadow-lg animate-pulse flex items-center gap-2 border border-red-400">
                <div className="w-2 h-2 bg-white rounded-full"></div> EN DIRECT
              </div>
            ) : (
              <div className="bg-yellow-500 text-black px-3 py-1 rounded-md text-xs font-black tracking-widest shadow-lg flex items-center gap-2 border border-yellow-300">
                <Pause size={12} fill="black" /> DIFFÉRÉ
              </div>
            )}
          </div>

          {/* ZONE VIDEO */}
          <div className={`relative flex-1 bg-black overflow-hidden flex items-center justify-center ${isTimeShifting ? 'border-2 border-yellow-500/50' : ''}`} ref={containerRef}>
            <video
              ref={liveVideoRef}
              autoPlay
              playsInline
              webkit-playsinline="true"
              disablePictureInPicture
              controlsList="nodownload noplaybackrate"
              muted={!isTimeShifting} // Mute en live, son en différé
              controls={isTimeShifting}
              onPlay={() => { if (isTimeShifting) setIsPlayingClip(true); }}
              onPause={() => { if (isTimeShifting) setIsPlayingClip(false); }}
              className="w-full h-full object-contain"
            />

            {/* CANVAS DESSIN EN MODE DIFFÉRÉ */}
            {isTimeShifting && (
              <canvas
                ref={canvasRef}
                style={{ touchAction: 'none' }}
                className={`absolute inset-0 w-full h-full z-10 ${isPlayingClip || drawingTool === 'none' ? 'pointer-events-none' : 'cursor-crosshair'}`}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerLeave={stopDrawing}
              />
            )}

            {errorMsg && <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-red-600/90 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 z-50"><AlertTriangle size={16} /> {errorMsg}</div>}
            <div id="clip-feedback" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/90 text-black px-6 py-4 rounded-2xl font-bold text-xl opacity-0 transition-opacity pointer-events-none z-50 text-center shadow-2xl scale-110">{feedbackMessage || "Clip Sauvegardé !"}</div>
            <div id="clip-feedback-error" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-600/90 text-white px-6 py-4 rounded-2xl font-bold text-xl opacity-0 transition-opacity pointer-events-none z-50 text-center shadow-2xl">{feedbackMessage || "Erreur !"}</div>
          </div>

          {/* BARRE DE CONTROLE & OUTILS */}
          <div className="bg-slate-900 border-t border-slate-800 safe-area-pb z-40 flex flex-col">

            {/* Si en différé : Barre d'outils dessin */}
            {isTimeShifting && (
              <div className="px-4 pt-2">
                <Toolbar />
              </div>
            )}

            {/* Contrôles Principaux */}
            <div className="p-4 flex items-center justify-between">
              {/* GAUCHE */}
              <div className="flex items-center gap-3 w-1/3">
                <button onClick={goHome} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700">
                  <Home size={20} /><span className="text-[9px] mt-1 font-medium">Accueil</span>
                </button>
                <div className="relative group">
                  <div className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-blue-400 hover:bg-slate-700 cursor-pointer overflow-hidden">
                    <Camera size={20} /><span className="text-[9px] mt-1 font-medium">Caméra</span>
                    <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
                      {videoDevices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* CENTRE */}
              <div className="flex items-center justify-center gap-4 w-1/3 shrink-0">
                {!isTimeShifting ? (
                  <>
                    <button onClick={() => createClip(10)} className="w-12 h-12 rounded-full border border-slate-600 flex items-center justify-center bg-slate-800 text-slate-300 font-bold text-[10px] active:scale-95">-10s</button>
                    <div className="relative">
                      {isRecording && <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-red-600/90 text-white text-[10px] font-mono px-2 py-0.5 rounded-full animate-pulse">{formatTime(recordingTime)}</div>}
                      <button onClick={toggleRecording} className={`w-16 h-16 rounded-full flex items-center justify-center border-4 shadow-lg active:scale-95 transition-all ${isRecording ? 'border-red-500 bg-red-600 text-white' : 'border-white bg-slate-200 text-slate-900 hover:bg-white'}`}>
                        {isRecording ? <div className="w-6 h-6 bg-white rounded-sm" /> : <div className="w-6 h-6 bg-red-600 rounded-full" />}
                      </button>
                    </div>
                    <button onClick={() => createClip(20)} className="w-12 h-12 rounded-full border border-slate-600 flex items-center justify-center bg-slate-800 text-slate-300 font-bold text-[10px] active:scale-95">-20s</button>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleTimeShift(-5)} className="p-2 bg-slate-800 rounded-full text-white hover:bg-slate-700"><Rewind size={20} /></button>
                    <button onClick={goBackToLive} className="px-6 py-2 bg-red-600 rounded-full text-white font-bold text-xs shadow-lg animate-pulse hover:bg-red-500 flex items-center gap-2"><Radio size={12} /> DIRECT</button>
                    <button onClick={() => handleTimeShift(5)} className="p-2 bg-slate-800 rounded-full text-white hover:bg-slate-700"><FastForward size={20} /></button>
                  </div>
                )}
              </div>

              {/* DROITE */}
              <div className="flex items-center justify-end gap-3 w-1/3">
                {!isTimeShifting && (
                  <button onClick={() => handleTimeShift(-10)} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-yellow-500 hover:bg-slate-700">
                    <RotateCcw size={20} /><span className="text-[9px] mt-1 font-medium">Replay</span>
                  </button>
                )}
                {isTimeShifting && (
                  <button onClick={() => createClip(0)} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white hover:bg-blue-500 shadow-lg active:scale-95">
                    <Camera size={20} /><span className="text-[9px] mt-1 font-medium">Photo</span>
                  </button>
                )}
                <button onClick={() => setViewMode('gallery')} className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 relative">
                  <Library size={20} /><span className="text-[9px] mt-1 font-medium">Clips</span>
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
                      <span className="absolute bottom-1 right-1 bg-black/70 px-1 text-xs rounded">{clip.duration === 'Import' ? 'Imp.' : clip.duration === 0 ? 'Img' : `-${clip.duration}s`}</span>
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
                controls
                onPlay={() => setIsPlayingClip(true)}
                onPause={() => setIsPlayingClip(false)}
                onError={(e) => { console.error("Erreur lecture:", e); setPlaybackError(true); }}
              />
            )}
            <canvas
              ref={canvasRef}
              style={{ touchAction: 'none' }}
              className={`absolute inset-0 w-full h-full z-10 ${isPlayingClip || drawingTool === 'none' ? 'pointer-events-none' : 'cursor-crosshair'}`}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
            />
          </div>

          {/* BARRE D'OUTILS ANALYSE */}
          <div className="bg-slate-900 border-t border-slate-800 p-2 safe-area-pb">
            <Toolbar />
          </div>
        </div>
      )}

    </div>
  );
};

export default App;