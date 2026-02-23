import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

export interface VoiceServiceCallbacks {
  onAudioData: (base64Audio: string) => void;
  onInterrupted: () => void;
  onTranscription: (text: string, isUser: boolean) => void;
  onToolCall?: (name: string, args: any) => void;
}

export class VoiceService {
  private ai: GoogleGenAI;
  private session: any = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: (process.env as any).GEMINI_API_KEY });
  }

  async connect(callbacks: VoiceServiceCallbacks) {
    if (this.session) return;

    this.session = await this.ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        },
        systemInstruction: "你是一个游戏指挥官。始终使用中文识别用户的语音并以中文回复。你可以帮助用户指挥战斗，比如发射导弹。请保持专业、简短且充满战斗氛围。",
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          this.startMic();
        },
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                callbacks.onAudioData(part.inlineData.data);
              }
            }
          }

          if (message.serverContent?.interrupted) {
            callbacks.onInterrupted();
          }

          if (message.serverContent?.turnComplete) {
            // Turn finished
          }

          // Handle transcriptions
          const userTranscription = message.serverContent?.modelTurn?.parts?.find(p => p.text)?.text;
          if (userTranscription) {
            // callbacks.onTranscription(userTranscription, false);
          }
        },
        onclose: () => {
          this.stopMic();
          this.session = null;
        },
        onerror: (err) => {
          console.error("Live API Error:", err);
          this.stopMic();
          this.session = null;
        }
      }
    });
  }

  private async startMic() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.session) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }

        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        this.session.sendRealtimeInput({
          media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (err) {
      console.error("Mic access error:", err);
    }
  }

  private stopMic() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.stopMic();
  }
}
