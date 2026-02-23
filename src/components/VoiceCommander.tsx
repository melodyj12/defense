import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { VoiceService } from '../services/voiceService';
import { motion, AnimatePresence } from 'motion/react';

export const VoiceCommander: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceServiceRef = useRef<VoiceService | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    voiceServiceRef.current = new VoiceService();
    return () => {
      voiceServiceRef.current?.disconnect();
    };
  }, []);

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    const base64Data = audioQueueRef.current.shift()!;
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 0x7FFF;
      }

      const buffer = audioContextRef.current.createBuffer(1, floatData.length, 24000);
      buffer.getChannelData(0).set(floatData);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => playNextInQueue();
      source.start();
    } catch (err) {
      console.error("Playback error:", err);
      playNextInQueue();
    }
  };

  const toggleVoice = async () => {
    if (isActive) {
      voiceServiceRef.current?.disconnect();
      setIsActive(false);
      setIsSpeaking(false);
      audioQueueRef.current = [];
    } else {
      setIsActive(true);
      await voiceServiceRef.current?.connect({
        onAudioData: (data) => {
          audioQueueRef.current.push(data);
          if (!isPlayingRef.current) {
            playNextInQueue();
          }
        },
        onInterrupted: () => {
          audioQueueRef.current = [];
          // In a real implementation, we'd stop the current source
        },
        onTranscription: (text, isUser) => {
          console.log(`${isUser ? 'User' : 'AI'}: ${text}`);
        }
      });
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={toggleVoice}
        className={`relative p-4 rounded-full shadow-2xl flex items-center justify-center transition-colors ${
          isActive 
            ? 'bg-emerald-500 text-black' 
            : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
        }`}
      >
        <AnimatePresence mode="wait">
          {isActive ? (
            <motion.div
              key="active"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
            >
              {isSpeaking ? <Volume2 className="w-6 h-6 animate-pulse" /> : <Mic className="w-6 h-6" />}
            </motion.div>
          ) : (
            <motion.div
              key="inactive"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
            >
              <MicOff className="w-6 h-6 opacity-50" />
            </motion.div>
          )}
        </AnimatePresence>

        {isActive && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
        )}
      </motion.button>
      
      {isActive && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-full mb-4 right-0 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 w-64 text-sm"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
            <span className="font-bold text-emerald-400 uppercase tracking-widest text-[10px]">
              {isSpeaking ? '正在讲话...' : '正在聆听...'}
            </span>
          </div>
          <p className="text-white/60 leading-relaxed">
            指挥官已上线。请使用中文下达指令。
          </p>
        </motion.div>
      )}
    </div>
  );
};
