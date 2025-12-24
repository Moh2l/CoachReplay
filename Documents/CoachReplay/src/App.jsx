import React, { useState, useRef, useEffect } from 'react';
import {
  Camera, Disc, PenTool, Play, Pause, ChevronLeft,
  Eraser, Library, Circle as CircleIcon, ArrowRight, Minus,
  Settings, Save, Video, Monitor, RefreshCw, Hand, Info, ScreenShare
} from 'lucide-react';

const App = () => {
  // --- ÉTATS ---
  // Système
  const [stream, setStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [viewMode, setViewMode] = useState('live'); // 'live', 'gallery', 'analysis'
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [supportedMimeType, setSupportedMimeType] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isScreenSharing, setIsScreenSharing] = useState(false); // Nouvel état

  // Données
  const [clips, setClips] = useState([]);
  const [activeClip, setActiveClip] = useState(null);

  // Outils d'analyse
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
  const [recordingTime, setRecordingTime] = useState(0);

  // Configuration
  const BUFFER_DURATION_MS = 120000;
  const CHUNK_INTERVAL_MS = 500;

  // --- 1. INITIALISATION MATÉRIEL ---

  useEffect(() => {
    const types = [
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm;codecs=h264',
      'video/webm'
    ];

    let bestType = '';
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        bestType = type;
        break;
      }
    }
    if (!bestType) bestType = 'video/webm';
    setSupportedMimeType(bestType);
  }, []);

  // Lister les caméras
  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(videoInputs);

        if (videoInputs.length > 0 && !selectedDeviceId) {
          const backCamera = videoInputs.find(d =>
            d.label.toLowerCase().includes('back') ||
            d.label.toLowerCase().includes('arrière') ||
            d.label.toLowerCase().includes('environment')
          );
          setSelectedDeviceId(backCamera ? backCamera.deviceId : videoInputs[0].deviceId);
        }
      } catch (err) {
        console.error("Erreur énumération devices:", err);
        setErrorMsg("Accès caméra refusé.");
      }
    };
    getDevices();
  }, []);

  // Fonction pour démarrer la caméra (extraite pour pouvoir être appelée quand on arrête le partage d'écran)
  const startCameraStream = async (deviceId) => {
    if (!deviceId) return;

    // Si on enregistre, on empêche le changement brutal
    if (isRecording) {
      if (!confirm("Changer de source arrêtera l'enregistrement en cours. Continuer ?")) return;
      toggleRecording(); // Stop recording
    }

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
      setIsScreenSharing(false); // On repasse en mode caméra

      if (liveVideoRef.current) liveVideoRef.current.srcObject = mediaStream;

      if (supportedMimeType) {
        startBuffering(mediaStream, supportedMimeType);
      }
      setErrorMsg('');
    } catch (err) {
      console.error("Erreur accès caméra:", err);
      setErrorMsg(`Erreur caméra: ${err.name}`);
    }
  };

  // Effet pour changement de caméra via le menu déroulant
  useEffect(() => {
    if (selectedDeviceId && !isScreenSharing) {
      startCameraStream(selectedDeviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  // --- NOUVEAU : GESTION PARTAGE D'ÉCRAN ---
  const startScreenShare = async () => {
    if (isRecording) {
      if (!confirm("Lancer le partage d'écran arrêtera l'enregistrement en cours. Continuer ?")) return;
      toggleRecording();
    }

    setErrorMsg(''); // Reset errors

    try {
      // Options : vidéo + audio système si possible
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: true
      });

      // Arrêter la caméra actuelle
      if (stream) stream.getTracks().forEach(t => t.stop());

      setStream(screenStream);
      setIsScreenSharing(true);

      if (liveVideoRef.current) liveVideoRef.current.srcObject = screenStream;

      if (supportedMimeType) {
        startBuffering(screenStream, supportedMimeType);
      }

      // Gérer l'arrêt via la barre native du navigateur "Arrêter le partage"
      screenStream.getVideoTracks()[0].onended = () => {
        setIsScreenSharing(false);
        // Revenir à la caméra sélectionnée
        if (selectedDeviceId) {
          startCameraStream(selectedDeviceId);
        }
      };

    } catch (err) {
      console.error("Erreur partage écran:", err);

      // Gestion spécifique de l'erreur de permission policy (iframe/sandbox)
      if (err.name === 'NotAllowedError' && err.message.includes('permissions policy')) {
        setErrorMsg("Le partage d'écran est bloqué dans cet environnement de prévisualisation. Veuillez déployer l'application (Vercel/Local) pour utiliser cette fonction.");
      } else if (err.name === 'NotAllowedError') {
        // L'utilisateur a cliqué sur "Annuler"
        console.log("Partage d'écran annulé par l'utilisateur");
      } else {
        setErrorMsg(`Erreur partage écran: ${err.message}`);
      }
    }
  };


  // --- 2. GESTION ENREGISTREMENT & BUFFER ---
  const startBuffering = (mediaStream, mimeType) => {
    try {
      // Si un recorder existe déjà (et qu'il est actif), on l'arrête proprement
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      const options = { mimeType: mimeType };
      const recorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const now = Date.now();
          chunksBufferRef.current.push({ data: e.data, timestamp: now });

          const cutoff = now - BUFFER_DURATION_MS;
          // Nettoyage intelligent : ne pas le faire à chaque frame pour perf
          if (chunksBufferRef.current.length > 0 && chunksBufferRef.current.length % 50 === 0) {
            chunksBufferRef.current = chunksBufferRef.current.filter(c => c.timestamp > cutoff);
          }

          if (isRecording) {
            fullSessionChunksRef.current.push(e.data);
          }
        }
      };

      recorder.start(CHUNK_INTERVAL_MS);
    } catch (e) {
      console.error("Erreur MediaRecorder start:", e);
      setErrorMsg(`Erreur Recorder: ${e.message}`);
    }
  };

  // --- 3. CONTRÔLE SESSION ---
  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
      saveFullSession();
    } else {
      fullSessionChunksRef.current = [];
      setRecordingTime(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    }
  };

  const saveFullSession = () => {
    if (fullSessionChunksRef.current.length === 0) return;
    try {
      const blob = new Blob(fullSessionChunksRef.current, { type: supportedMimeType });
      const ext = supportedMimeType.includes('mp4') ? 'mp4' : 'webm';
      const source = isScreenSharing ? 'screen' : 'camera';
      downloadBlob(blob, `session-${source}-${new Date().toISOString()}.${ext}`);
    } catch (e) {
      console.error("Erreur sauvegarde:", e);
      alert("Erreur sauvegarde.");
    }
  };

  // --- 4. CRÉATION DE CLIPS ---
  const createClip = (secondsBack) => {
    const now = Date.now();
    const startTime = now - (secondsBack * 1000);

    let relevantChunks = chunksBufferRef.current
      .filter(chunk => chunk.timestamp >= startTime)
      .map(c => c.data);

    if (relevantChunks.length === 0) {
      const chunksNeeded = (secondsBack * 1000) / CHUNK_INTERVAL_MS;
      relevantChunks = chunksBufferRef.current.slice(-chunksNeeded).map(c => c.data);
    }

    if (relevantChunks.length === 0) {
      const btn = document.getElementById('clip-feedback-error');
      if (btn) {
        btn.style.opacity = 1;
        setTimeout(() => btn.style.opacity = 0, 2000);
      }
      return;
    }

    try {
      const blob = new Blob(relevantChunks, { type: supportedMimeType });
      if (blob.size === 0) return;

      const url = URL.createObjectURL(blob);

      const newClip = {
        id: Date.now(),
        url: url,
        duration: secondsBack,
        size: (blob.size / 1024 / 1024).toFixed(2),
        type: isScreenSharing ? 'screen' : 'camera', // Marquer le type de source
        timeString: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };

      setClips(prev => [newClip, ...prev]);

      const btn = document.getElementById('clip-feedback');
      if (btn) {
        btn.style.opacity = 1;
        setTimeout(() => btn.style.opacity = 0, 1500);
      }
    } catch (e) {
      console.error("Erreur création clip:", e);
    }
  };

  // --- 5. LOGIQUE DE DESSIN ---
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
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e) => {
    if (isPlayingClip || drawingTool === 'none') return;
    if (e.cancelable) e.preventDefault();
    const { x, y } = getCanvasCoords(e);

    if (drawingTool === 'free') {
      setCurrentShape({ type: 'free', points: [{ x, y }], color: drawingColor });
    } else {
      setCurrentShape({ type: drawingTool, start: { x, y }, end: { x, y }, color: drawingColor });
    }
  };

  const draw = (e) => {
    if (!currentShape || isPlayingClip || drawingTool === 'none') return;
    if (e.cancelable) e.preventDefault();
    if (!e.touches && e.buttons !== 1) return;
    const { x, y } = getCanvasCoords(e);

    if (drawingTool === 'free') {
      setCurrentShape(prev => ({ ...prev, points: [...prev.points, { x, y }] }));
    } else {
      setCurrentShape(prev => ({ ...prev, end: { x, y } }));
    }
  };

  const stopDrawing = () => {
    if (!currentShape) return;
    setShapes(prev => [...prev, currentShape]);
    setCurrentShape(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewMode !== 'analysis') return;

    canvas.width = containerRef.current?.clientWidth || 800;
    canvas.height = containerRef.current?.clientHeight || 600;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const renderShape = (shape) => {
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = 4;
      ctx.beginPath();

      if (shape.type === 'free') {
        if (shape.points.length < 2) return;
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        shape.points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }
      else if (shape.type === 'circle') {
        const radius = Math.sqrt(Math.pow(shape.end.x - shape.start.x, 2) + Math.pow(shape.end.y - shape.start.y, 2));
        ctx.beginPath();
        ctx.arc(shape.start.x, shape.start.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      }
      else if (shape.type === 'line') {
        ctx.moveTo(shape.start.x, shape.start.y);
        ctx.lineTo(shape.end.x, shape.end.y);
        ctx.stroke();
      }
      else if (shape.type === 'arrow') {
        const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
        const headlen = 20;
        ctx.moveTo(shape.start.x, shape.start.y);
        ctx.lineTo(shape.end.x, shape.end.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(shape.end.x, shape.end.y);
        ctx.lineTo(shape.end.x - headlen * Math.cos(angle - Math.PI / 6), shape.end.y - headlen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(shape.end.x, shape.end.y);
        ctx.lineTo(shape.end.x - headlen * Math.cos(angle + Math.PI / 6), shape.end.y - headlen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      }
    };

    shapes.forEach(renderShape);
    if (currentShape) renderShape(currentShape);

  }, [shapes, currentShape, viewMode, containerRef.current?.clientWidth, containerRef.current?.clientHeight]);

  // --- 6. GESTION DU LECTEUR ---
  const openClip = (clip) => {
    setActiveClip(clip);
    setViewMode('analysis');
    setShapes([]);
    setIsPlayingClip(true);
    setDrawingTool('none');
  };

  const handleVideoTimeUpdate = () => {
    if (analysisVideoRef.current) {
      const vid = analysisVideoRef.current;
      const pct = (vid.currentTime / vid.duration) * 100;
      setProgress(isNaN(pct) ? 0 : pct);
    }
  };

  const handleSeek = (e) => {
    const pct = parseFloat(e.target.value);
    if (analysisVideoRef.current && Number.isFinite(analysisVideoRef.current.duration)) {
      analysisVideoRef.current.currentTime = (pct / 100) * analysisVideoRef.current.duration;
      setProgress(pct);
    }
  };

  const togglePlayPause = () => {
    if (analysisVideoRef.current) {
      if (isPlayingClip) {
        analysisVideoRef.current.pause();
        setIsPlayingClip(false);
      } else {
        analysisVideoRef.current.play();
        setIsPlayingClip(true);
        setDrawingTool('none');
      }
    }
  };

  // --- RENDER ---
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white font-sans overflow-hidden">

      {/* HEADER */}
      <div className="h-16 bg-slate-800 flex items-center justify-between px-3 shadow-md z-20 shrink-0 gap-2">
        <div className="flex items-center gap-2 overflow-hidden">
          {viewMode !== 'live' ? (
            <button onClick={() => setViewMode('live')} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 shrink-0">
              <ChevronLeft size={20} />
            </button>
          ) : (
            <div className="flex items-center gap-2 max-w-[300px]">
              {/* Bouton Partage Ecran */}
              <button
                onClick={startScreenShare}
                className={`p-2 rounded-lg shrink-0 transition-colors ${isScreenSharing ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                title="Partager l'écran"
              >
                <Monitor size={18} />
              </button>

              {/* Sélecteur Caméra */}
              <div className={`flex items-center gap-2 bg-slate-900 rounded p-1 border ${isScreenSharing ? 'border-slate-700 opacity-50' : 'border-slate-600'}`}>
                <div className="bg-blue-600 p-1 rounded shrink-0">
                  <Camera size={14} />
                </div>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setIsScreenSharing(false); // Force exit screen share
                    setSelectedDeviceId(e.target.value);
                  }}
                  disabled={isScreenSharing}
                  className="bg-transparent text-white text-xs py-1 rounded max-w-[120px] sm:max-w-[200px] truncate focus:outline-none"
                >
                  {videoDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Caméra ${device.deviceId.slice(0, 5)}...`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {isRecording && (
            <div className="hidden sm:flex items-center gap-1.5 text-red-500 font-mono text-xs sm:text-sm bg-slate-900/50 px-2 py-1 rounded">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {formatTime(recordingTime)}
            </div>
          )}

          {viewMode === 'live' && (
            <button
              onClick={toggleRecording}
              className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs sm:text-sm font-bold transition-all ${isRecording
                  ? 'bg-red-600 text-white shadow-red-900/50 shadow-lg'
                  : 'bg-white text-slate-900 hover:bg-slate-200'
                }`}
            >
              {isRecording ? <span className="hidden sm:inline">Arrêter</span> : <span>REC</span>}
              {isRecording ? <Disc size={18} className="animate-spin" /> : <Disc size={18} />}
            </button>
          )}
        </div>
      </div>

      {/* CONTENU PRINCIPAL */}
      <div className="flex-1 relative bg-black overflow-hidden flex flex-col" ref={containerRef}>

        {errorMsg && (
          <div className="absolute top-4 left-4 right-4 z-50 bg-red-600/90 text-white p-2 rounded text-xs text-center">
            {errorMsg}
          </div>
        )}

        {/* VUE 1: LIVE CAM */}
        <div className={`absolute inset-0 flex items-center justify-center ${viewMode === 'live' ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}>
          <video
            ref={liveVideoRef}
            autoPlay playsInline muted
            className="w-full h-full object-contain pointer-events-none"
          />

          {isScreenSharing && viewMode === 'live' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-green-600/90 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 z-20">
              <ScreenShare size={14} /> PARTAGE D'ÉCRAN ACTIF
            </div>
          )}

          <div id="clip-feedback" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/90 text-black px-6 py-3 rounded-xl font-bold text-xl opacity-0 transition-opacity pointer-events-none z-50">
            Clip Sauvegardé !
          </div>
          <div id="clip-feedback-error" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-600/90 text-white px-6 py-3 rounded-xl font-bold text-lg opacity-0 transition-opacity pointer-events-none z-50 text-center">
            Tampon vide !
          </div>

          {isRecording && (
            <div className="absolute bottom-24 left-0 right-0 flex justify-center gap-4 sm:gap-8 px-4 z-30">
              {[10, 20, 30].map(sec => (
                <button
                  key={sec}
                  onClick={() => createClip(sec)}
                  className="flex flex-col items-center gap-1 active:scale-95 transition-transform"
                >
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-blue-600/90 border-2 border-blue-400 flex items-center justify-center shadow-lg backdrop-blur-sm hover:bg-blue-500">
                    <span className="font-bold text-lg sm:text-xl text-white">-{sec}s</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setViewMode('gallery')}
            className="absolute bottom-6 left-6 flex items-center gap-2 bg-slate-800/90 hover:bg-slate-700 px-4 py-3 rounded-xl border border-slate-600 shadow-lg transition-colors z-40"
          >
            <div className="relative">
              <Library size={24} />
              {clips.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border border-slate-900 shadow-sm">
                  {clips.length}
                </span>
              )}
            </div>
            <span className="font-semibold hidden sm:inline">Clips</span>
          </button>
        </div>

        {/* VUE 2: GALERIE */}
        {viewMode === 'gallery' && (
          <div className="absolute inset-0 bg-slate-900 p-4 overflow-y-auto z-20">
            <h2 className="text-xl font-bold mb-4 text-slate-300">Bibliothèque ({clips.length})</h2>
            <div className="mb-4 p-2 bg-slate-800 rounded border border-slate-700 text-[10px] text-slate-400 font-mono flex items-center gap-2">
              <Info size={12} /> Format: <span className="text-blue-400">{supportedMimeType || "?"}</span>
            </div>

            {clips.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <Video size={48} className="mb-2 opacity-50" />
                <p>Aucun clip. Enregistrez une session pour créer des clips.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-20">
                {clips.map((clip, idx) => (
                  <div key={clip.id} onClick={() => openClip(clip)} className="bg-slate-800 rounded-lg p-2 cursor-pointer hover:bg-slate-700 transition-colors border border-slate-700 group">
                    <div className="aspect-video bg-black rounded flex items-center justify-center mb-2 relative overflow-hidden border border-slate-900">
                      <video
                        src={clip.url}
                        className="w-full h-full object-cover opacity-60"
                        playsInline
                        muted
                        preload="metadata"
                        onLoadedMetadata={(e) => { e.target.currentTime = 0; }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Play size={32} className="text-white fill-white/50" />
                      </div>
                      <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-xs text-white font-mono flex items-center gap-1">
                        {clip.type === 'screen' ? <Monitor size={10} /> : <Video size={10} />}
                        <span>-{clip.duration}s</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center px-1">
                      <span className="font-bold text-sm text-slate-200">Clip #{clips.length - idx}</span>
                      <span className="text-xs text-slate-400">{clip.timeString}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VUE 3: ANALYSE */}
        {viewMode === 'analysis' && activeClip && (
          <div className="absolute inset-0 bg-black z-30 flex flex-col">
            <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden select-none">
              <video
                ref={analysisVideoRef}
                src={activeClip.url}
                className="absolute inset-0 w-full h-full object-contain"
                playsInline
                webkit-playsinline="true"
                loop
                autoPlay
                onTimeUpdate={handleVideoTimeUpdate}
              />
              <canvas
                ref={canvasRef}
                style={{ touchAction: 'none' }}
                className={`absolute inset-0 w-full h-full z-10 ${isPlayingClip || drawingTool === 'none' ? 'pointer-events-none' : 'cursor-crosshair'}`}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>

            <div className="bg-slate-900 px-4 py-3 border-t border-slate-800 shrink-0">
              <div className="flex items-center gap-4">
                <button onClick={togglePlayPause} className="w-10 h-10 flex items-center justify-center bg-slate-700 rounded-full text-white hover:bg-blue-600 transition-colors">
                  {isPlayingClip ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                <input
                  type="range"
                  min="0" max="100"
                  value={progress}
                  onChange={handleSeek}
                  className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            </div>

            <div className="bg-slate-800 p-2 safe-area-pb shrink-0 border-t border-slate-700">
              <div className="flex items-center justify-between gap-4 overflow-x-auto no-scrollbar py-1">
                <div className="flex bg-slate-700 rounded-lg p-1 shrink-0">
                  <button onClick={() => selectTool('none')} className={`p-2 rounded ${drawingTool === 'none' ? 'bg-slate-500 text-white' : 'text-slate-400'}`} title="Mode Vue">
                    <Hand size={20} />
                  </button>
                  <div className="w-px bg-slate-600 mx-1"></div>
                  <button onClick={() => selectTool('free')} className={`p-2 rounded ${drawingTool === 'free' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>
                    <PenTool size={20} />
                  </button>
                  <button onClick={() => selectTool('arrow')} className={`p-2 rounded ${drawingTool === 'arrow' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>
                    <ArrowRight size={20} />
                  </button>
                  <button onClick={() => selectTool('circle')} className={`p-2 rounded ${drawingTool === 'circle' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>
                    <CircleIcon size={20} />
                  </button>
                </div>
                <div className="flex items-center gap-2 shrink-0 px-2 border-l border-r border-slate-600/50">
                  {['#ef4444', '#3b82f6', '#eab308', '#ffffff'].map(c => (
                    <button
                      key={c}
                      onClick={() => setDrawingColor(c)}
                      className={`w-8 h-8 rounded-full border-2 transition-transform ${drawingColor === c ? 'border-white scale-110' : 'border-transparent opacity-80'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setShapes([])} className="flex items-center gap-1 px-3 py-2 bg-slate-700 rounded text-slate-300 active:bg-slate-600">
                    <Eraser size={16} />
                    <span className="text-xs font-medium">Effacer</span>
                  </button>
                </div>
              </div>
              {drawingTool !== 'none' && (
                <div className="text-center text-[10px] text-yellow-500 mt-1 uppercase tracking-widest font-bold animate-pulse">
                  {isPlayingClip ? "Mettez en pause pour dessiner" : "Mode Dessin Actif"}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// Helper function
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

export default App;