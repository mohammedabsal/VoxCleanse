import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from './components/ControlPanel';
import TranscriptPanel from './components/TranscriptPanel';
import SummaryPanel from './components/SummaryPanel';
import AudioStreamer from './services/audioStreamer';
import WebSocketService from './services/websocketService';

const API_BASE = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/ws/audio';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const applyCustomFilters = (text, filters) => {
  if (!text) return '';

  let result = String(text);
  Object.entries(filters || {}).forEach(([word, replacement]) => {
    const cleanWord = String(word || '').trim();
    if (!cleanWord) return;
    const normalizedReplacement = replacement == null ? '' : String(replacement).trim();
    const pattern = new RegExp(`\\b${escapeRegex(cleanWord)}\\b`, 'gi');
    result = result.replace(pattern, normalizedReplacement);
  });

  result = result.replace(/\s+/g, ' ').trim();
  if (!result) return '';
  return result[0].toUpperCase() + result.slice(1);
};

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [originalTranscript, setOriginalTranscript] = useState('');
  const [refinedTranscript, setRefinedTranscript] = useState('');
  const [customFilters, setCustomFilters] = useState({});
  const [downloadLinks, setDownloadLinks] = useState({ originalAudio: '', cleanedAudio: '', transcript: '' });
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [inputDevices, setInputDevices] = useState([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState('');
  const [filterWord, setFilterWord] = useState('');
  const [filterReplacement, setFilterReplacement] = useState('');
  const [summaryText, setSummaryText] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summarySourceWordCount, setSummarySourceWordCount] = useState(0);
  const [summaryWordCount, setSummaryWordCount] = useState(0);

  const wsRef = useRef(null);
  const audioStreamerRef = useRef(null);
  const audioPlaybackContextRef = useRef(null);

  const handleWsMessage = useCallback((message) => {
    if (message.type === 'session_started') {
      setSessionId(message.session_id);
      setConnectionStatus('connected');
      return;
    }

    if (message.type === 'config_updated') {
      setRefinedTranscript((prev) => {
        if (typeof message.refined_transcript === 'string') {
          return message.refined_transcript;
        }
        return prev;
      });
      return;
    }

    if (message.type === 'processed') {
      if (message.original_text) {
        setOriginalTranscript((prev) => {
          const updatedOriginal = `${prev} ${message.original_text}`.trim();
          setRefinedTranscript(applyCustomFilters(updatedOriginal, customFilters));
          return updatedOriginal;
        });
      }

      // Optional: play cleaned audio chunk
      if (message.cleaned_audio && message.cleaned_audio.length > 0) {
        playAudioChunk(new Float32Array(message.cleaned_audio));
      }
      return;
    }

    if (message.type === 'session_ended') {
      const originalAudioPath = message.download_urls.original_audio || '';
      const cleanedAudioPath = message.download_urls.cleaned_audio || message.download_urls.audio || '';
      setDownloadLinks({
        originalAudio: originalAudioPath ? `${API_BASE}${originalAudioPath}` : '',
        cleanedAudio: cleanedAudioPath ? `${API_BASE}${cleanedAudioPath}` : '',
        transcript: `${API_BASE}${message.download_urls.transcript}`,
      });
      setConnectionStatus('disconnected');
      return;
    }

    if (message.type === 'error') {
      setError(message.message || 'Unknown WebSocket error');
    }
  }, [customFilters]);

  const handleWsError = useCallback(() => {
    setError('WebSocket connection error');
    setConnectionStatus('error');
  }, []);

  const handleWsClose = useCallback(() => {
    setConnectionStatus('disconnected');
  }, []);

  const connectWebSocket = useCallback(async () => {
    setConnectionStatus('connecting');
    const wsService = new WebSocketService(WS_URL, handleWsMessage, handleWsError, handleWsClose);
    await wsService.connect();
    wsRef.current = wsService;

    // Send current custom filters
    if (Object.keys(customFilters).length > 0) {
      wsService.sendConfig(customFilters);
    }

    return wsService;
  }, [customFilters, handleWsClose, handleWsError, handleWsMessage]);

  const playAudioChunk = (audioChunk) => {
    try {
      if (!audioPlaybackContextRef.current) {
        audioPlaybackContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const context = audioPlaybackContextRef.current;
      const buffer = context.createBuffer(1, audioChunk.length, 16000);
      buffer.copyToChannel(audioChunk, 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
    } catch (e) {
      // Ignore playback errors to avoid interrupting processing
      console.warn('Audio playback warning:', e);
    }
  };

  const startRecording = async () => {
    try {
      setError('');
      setOriginalTranscript('');
      setRefinedTranscript('');
      setDownloadLinks({ originalAudio: '', cleanedAudio: '', transcript: '' });

      const wsService = await connectWebSocket();

      const streamer = new AudioStreamer((audioChunk) => {
        if (wsService.isConnected()) {
          wsService.sendAudioChunk(audioChunk, 16000);
        }
      });

      await streamer.start(selectedInputDevice);
      audioStreamerRef.current = streamer;
      setIsRecording(true);

      // Refresh labels after mic permission is granted.
      const devices = await AudioStreamer.getInputDevices();
      setInputDevices(devices);
    } catch (e) {
      setError(`Failed to start recording: ${e.message}`);
      setIsRecording(false);
      setConnectionStatus('error');
    }
  };

  const stopRecording = () => {
    try {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
        audioStreamerRef.current = null;
      }

      if (wsRef.current && wsRef.current.isConnected()) {
        wsRef.current.endSession();
        // Keep WS open briefly to receive final message
        setTimeout(() => {
          if (wsRef.current) {
            wsRef.current.disconnect();
            wsRef.current = null;
          }
        }, 1000);
      }

      setIsRecording(false);
    } catch (e) {
      setError(`Failed to stop recording: ${e.message}`);
    }
  };

  const handleUpdateFilter = (word, replacement) => {
    const updated = {
      ...customFilters,
      [word]: replacement,
    };

    setCustomFilters(updated);
    setRefinedTranscript(applyCustomFilters(originalTranscript, updated));

    if (wsRef.current && wsRef.current.isConnected()) {
      wsRef.current.sendConfig(updated);
    }
  };

  const handleRemoveFilter = (word) => {
    const updated = { ...customFilters };
    delete updated[word];
    setCustomFilters(updated);
    setRefinedTranscript(applyCustomFilters(originalTranscript, updated));

    if (wsRef.current && wsRef.current.isConnected()) {
      wsRef.current.sendConfig(updated);
    }
  };

  const handleSummarizeTranscript = useCallback(async () => {
    const transcriptText = refinedTranscript.trim();
    if (!transcriptText) {
      setSummaryError('Add transcript text before summarizing.');
      return;
    }

    setIsSummarizing(true);
    setSummaryError('');

    try {
      const response = await fetch(`${API_BASE}/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: transcriptText }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Summarization failed: ${response.statusText}`);
      }

      const result = await response.json();
      setSummaryText(result.summary || '');
      setSummarySourceWordCount(result.source_word_count || 0);
      setSummaryWordCount(result.summary_word_count || 0);
    } catch (e) {
      setSummaryError(e.message || 'Unable to summarize transcript');
      setSummaryText('');
      setSummarySourceWordCount(0);
      setSummaryWordCount(0);
    } finally {
      setIsSummarizing(false);
    }
  }, [refinedTranscript]);

  const handleAddFilter = () => {
    const word = filterWord.trim();
    if (!word) return;

    const replacement = filterReplacement.trim();
    const updated = {
      ...customFilters,
      [word]: replacement || null,
    };

    setCustomFilters(updated);
    setRefinedTranscript(applyCustomFilters(originalTranscript, updated));
    setFilterWord('');
    setFilterReplacement('');

    if (wsRef.current && wsRef.current.isConnected()) {
      wsRef.current.sendConfig(updated);
    }
  };

  const handleFileUpload = async (file) => {
    setIsUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('custom_filters', JSON.stringify(customFilters));

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

      setSessionId(result.session_id);
      const uploadedOriginal = result.original_transcript || '';
      setOriginalTranscript(uploadedOriginal);
      setRefinedTranscript(applyCustomFilters(uploadedOriginal, customFilters));
      const originalAudioPath = result.download_urls.original_audio || '';
      const cleanedAudioPath = result.download_urls.cleaned_audio || result.download_urls.audio || '';
      setDownloadLinks({
        originalAudio: originalAudioPath ? `${API_BASE}${originalAudioPath}` : '',
        cleanedAudio: cleanedAudioPath ? `${API_BASE}${cleanedAudioPath}` : '',
        transcript: `${API_BASE}${result.download_urls.transcript}`,
      });
    } catch (e) {
      setError(`File upload error: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    AudioStreamer.getInputDevices()
      .then((devices) => setInputDevices(devices))
      .catch(() => setInputDevices([]));

    return () => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
      }
      if (wsRef.current) {
        wsRef.current.disconnect();
      }
      if (audioPlaybackContextRef.current) {
        audioPlaybackContextRef.current.close();
      }
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (isUploading) return 'Processing uploaded file...';
    return `Status: ${connectionStatus}`;
  }, [connectionStatus, isUploading]);

  const filterCount = useMemo(() => Object.keys(customFilters).length, [customFilters]);

  const transcriptSummary = useMemo(() => {
    const wordCount = (refinedTranscript || '').trim().split(/\s+/).filter(Boolean).length;
    return `${wordCount} refined words`;
  }, [refinedTranscript]);

  useEffect(() => {
    setSummaryText('');
    setSummaryError('');
    setSummarySourceWordCount(0);
    setSummaryWordCount(0);
  }, [refinedTranscript]);

  return (
    <div className="app-shell">
      <div className="ambient-bg" />
      <header className="hero">
        <p className="eyebrow">AI Speech Enhancement Suite</p>
        <h1>Real-Time Voice Cleanup and Transcript Refinement</h1>
        <p className="subtitle">
          DeepFilterNet denoising + Whisper transcription + professional language polishing
        </p>
        <div className="hero-meta-row">
          <div className="status-chip">{statusLabel}</div>
          <div className="hero-pill">Filters: {filterCount}</div>
          <div className="hero-pill">{transcriptSummary}</div>
        </div>
      </header>

      <main className="layout-shell">
        <section className="top-controls card">
          <div className="section-heading-row">
            <div>
              <h2>Input and Processing Controls</h2>
              <p>Choose your device, run live processing, or upload an audio file for enhancement.</p>
            </div>
          </div>
          <ControlPanel
            isRecording={isRecording}
            onStart={startRecording}
            onStop={stopRecording}
            inputDevices={inputDevices}
            selectedInputDevice={selectedInputDevice}
            onSelectInputDevice={setSelectedInputDevice}
            onFileUpload={handleFileUpload}
            downloadLinks={downloadLinks}
          />
        </section>

        <section className="bottom-layout">
          <section className="bottom-left card">
            <div className="section-heading-row compact">
              <div>
                <h2>Custom Word Filters</h2>
                <p>Define words to remove or replace and apply them to the refined transcript.</p>
              </div>
            </div>

            <div className="control-group filter-section nested">
              <p className="hint">Add words to remove or replace. Example: bro {'>'} (empty to remove)</p>

              <div className="filter-inputs">
                <input
                  type="text"
                  placeholder="Word to filter"
                  value={filterWord}
                  onChange={(e) => setFilterWord(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Replacement (optional)"
                  value={filterReplacement}
                  onChange={(e) => setFilterReplacement(e.target.value)}
                />
                <button className="btn accent" onClick={handleAddFilter}>
                  Add Filter
                </button>
              </div>

              <div className="filter-list">
                {Object.keys(customFilters).length === 0 ? (
                  <span className="placeholder">No custom filters configured</span>
                ) : (
                  Object.entries(customFilters).map(([k, v]) => (
                    <div key={k} className="filter-item">
                      <span>
                        <strong>{k}</strong> {'>'} {v === null ? '(removed)' : v}
                      </span>
                      <button className="mini-btn" onClick={() => handleRemoveFilter(k)}>
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="meta-notes">
              {sessionId && <p className="session-id">Session: {sessionId}</p>}
              {error && <p className="error-text">{error}</p>}
            </div>
          </section>

          <section className="right-column">
            <div className="section-heading-row compact">
              <div>
                <h2>Transcript Workspace</h2>
                <p>Original speech on top, refined output below for instant comparison.</p>
              </div>
            </div>
            <TranscriptPanel
              title="Original Transcript"
              text={originalTranscript}
              variant="original"
            />
            <TranscriptPanel
              title="Refined Transcript"
              text={refinedTranscript}
              variant="refined"
            />

            <SummaryPanel
              summary={summaryText}
              onSummarize={handleSummarizeTranscript}
              isSummarizing={isSummarizing}
              sourceWordCount={summarySourceWordCount}
              summaryWordCount={summaryWordCount}
              error={summaryError}
              disabled={!refinedTranscript.trim()}
            />
          </section>
        </section>
      </main>
    </div>
  );
}

export default App;
